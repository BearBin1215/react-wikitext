import { defineConfig } from "tsdown";

const subpaths = [
  "index",
  "ast",
  "parse",
  "expand",
  "hast",
  "unified",
  "view",
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
    /^(?:index|view|devtools)\.(?:js|cjs)$/u.test(fileName) ? '"use client";' : undefined,
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
  copy: [
    { from: "src/styles/tokens.css", to: "dist" },
    { from: "src/styles/view.css", to: "dist", rename: "styles.css" },
    { from: "src/styles/devtools.css", to: "dist" },
  ],
});
