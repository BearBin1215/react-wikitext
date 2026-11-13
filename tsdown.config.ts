import { readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { Features, transform } from "lightningcss";
import { defineConfig } from "tsdown";

const cssArtifacts = [
  { from: "src/styles/tokens.css", to: "dist/tokens.css" },
  { from: "src/styles/view.css", to: "dist/styles.css" },
  { from: "src/styles/devtools.css", to: "dist/devtools.css" },
] as const;

function copyEntry({ from, to }: (typeof cssArtifacts)[number]) {
  const target = dirname(to);
  const name = basename(to);
  return basename(from) === name ? { from, to: target } : { from, to: target, rename: name };
}

let cssQueue = Promise.resolve();

// copy 负责放入 dist 并让 watch 监听源码；双格式构建会并发触发本钩子，
// 这里从源码读取并串行写出，避免两个构建同时截断同一文件。
function flattenCss(): Promise<void> {
  const run = cssQueue
    .then(() =>
      Promise.all(
        cssArtifacts.map(async ({ from, to }) => {
          const code = await readFile(from);
          const flattened = transform({
            filename: from,
            code,
            include: Features.Nesting,
          });
          // 原子替换，避免与 copy 或中断的构建交错时留下截断文件。
          const temporary = `${to}.tmp`;
          await writeFile(temporary, flattened.code);
          await rename(temporary, to);
        }),
      ),
    )
    .then(() => undefined);
  cssQueue = run.catch(() => {});
  return run;
}

const subpaths = [
  "index",
  "ast",
  "parse",
  "expand",
  "hast",
  "unified",
  "view",
  "preview",
  "worker",
  "configs",
  "devtools",
] as const;

function subpathExports() {
  return Object.fromEntries(
    subpaths.map((name) => {
      const base = name === "index" ? "." : `./${name}`;
      return [
        base,
        {
          import: {
            types: `./dist/${name}.d.ts`,
            default: `./dist/${name}.js`,
          },
          require: {
            types: `./dist/${name}.d.cts`,
            default: `./dist/${name}.cjs`,
          },
        },
      ];
    }),
  );
}

export default defineConfig({
  // 依赖包含仅有 main 字段的 CJS 工具（style-to-js）；browser 解析同时服务 ESM/CJS 产物。
  platform: "browser",
  target: "es2022",
  entry: {
    index: "src/index.ts",
    ast: "src/ast/index.ts",
    parse: "src/parse/index.ts",
    expand: "src/expand/index.ts",
    hast: "src/hast/index.ts",
    unified: "src/unified/index.ts",
    view: "src/view/index.ts",
    preview: "src/preview/index.ts",
    worker: "src/worker/index.ts",
    configs: "src/configs/index.ts",
    devtools: "src/devtools/index.ts",
  },
  format: ["esm", "cjs"],
  // 统一按浏览器条件解析，避免 CJS 产物取到 vfile 的 `#minproc`/`#minpath`/`#minurl` Node 分支，
  // 从而在 `dist/*.cjs` 中产生 `require("node:process")` 这类浏览器无法解析的依赖。
  inputOptions: {
    // tsdown 默认把 CJS 格式按 node 平台解析，会让 vfile 取到 `#minproc`/`#minpath`/`#minurl`
    // 的 Node 分支，于是 `dist/*.cjs` 出现 `require("node:process")`。这里显式覆盖为 browser。
    platform: "browser",
  },
  dts: {
    tsconfig: "./tsconfig.build.json",
  },
  // 根入口、/view 与 /devtools 会调用 React hooks；在入口产物顶部声明 client 组件边界。
  banner: ({ fileName }) =>
    /^(?:index|view|preview|worker|devtools)\.(?:js|cjs)$/u.test(fileName)
      ? '"use client";'
      : undefined,
  sourcemap: true,
  exports: {
    customExports(pkg) {
      Object.assign(pkg, subpathExports());
      pkg["./styles.css"] = "./dist/styles.css";
      pkg["./tokens.css"] = "./dist/tokens.css";
      pkg["./devtools.css"] = "./dist/devtools.css";
      pkg["./package.json"] = "./package.json";
      return pkg;
    },
  },
  deps: {
    neverBundle: ["react", "react-dom", /^react\//, /^wikiparser-node(\/|$)/],
    // unified/hast 工具是 ESM-only；CJS 产物需要连同传递依赖一起打包。
    alwaysBundle: [
      "entities",
      "unified",
      "vfile",
      "hast-util-sanitize",
      "hast-util-to-jsx-runtime",
    ],
  },
  copy: cssArtifacts.map(copyEntry),
  // copy 在 build:done 之前执行，并让 watch 模式监听源码样式。
  hooks: {
    "build:done": flattenCss,
  },
});
