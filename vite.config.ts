import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));
const playgroundSrc = resolve(repoRoot, "playground/src");

const librarySource = (path: string) => resolve(repoRoot, "src", path);
const libraryDist = (path: string) => resolve(repoRoot, "dist", path);

// 上游 bundle 引用了未随包发布的 source map，开发服务器每次加载都会报错；这里只在内存中去掉注释。
function stripMissingSourceMap(): Plugin {
  return {
    name: "strip-missing-source-map",
    enforce: "pre",
    load(id) {
      const [file] = id.split("?");
      if (!file || !file.replace(/\\/g, "/").endsWith("/wikiparser-node/bundle/bundle.min.js")) {
        return;
      }
      const code = readFileSync(file, "utf8").replace(/\n?\/\/# sourceMappingURL=.*\s*$/, "");
      return { code, map: null };
    },
  };
}

const sourceAliases = [
  { find: /^react-wikitext$/u, replacement: librarySource("index.ts") },
  { find: /^react-wikitext\/ast$/u, replacement: librarySource("ast/index.ts") },
  { find: /^react-wikitext\/parse$/u, replacement: librarySource("parse/index.ts") },
  { find: /^react-wikitext\/expand$/u, replacement: librarySource("expand/index.ts") },
  { find: /^react-wikitext\/hast$/u, replacement: librarySource("hast/index.ts") },
  { find: /^react-wikitext\/unified$/u, replacement: librarySource("unified/index.ts") },
  { find: /^react-wikitext\/view$/u, replacement: librarySource("view/index.ts") },
  { find: /^react-wikitext\/configs$/u, replacement: librarySource("configs/index.ts") },
  { find: /^react-wikitext\/devtools$/u, replacement: librarySource("devtools/index.ts") },
  { find: /^react-wikitext\/styles\.css$/u, replacement: librarySource("styles/view.css") },
  { find: /^react-wikitext\/devtools\.css$/u, replacement: librarySource("styles/devtools.css") },
];

const distAliases = [
  { find: /^react-wikitext$/u, replacement: libraryDist("index.js") },
  { find: /^react-wikitext\/ast$/u, replacement: libraryDist("ast.js") },
  { find: /^react-wikitext\/parse$/u, replacement: libraryDist("parse.js") },
  { find: /^react-wikitext\/expand$/u, replacement: libraryDist("expand.js") },
  { find: /^react-wikitext\/hast$/u, replacement: libraryDist("hast.js") },
  { find: /^react-wikitext\/unified$/u, replacement: libraryDist("unified.js") },
  { find: /^react-wikitext\/view$/u, replacement: libraryDist("view.js") },
  { find: /^react-wikitext\/configs$/u, replacement: libraryDist("configs.js") },
  { find: /^react-wikitext\/devtools$/u, replacement: libraryDist("devtools.js") },
  { find: /^react-wikitext\/styles\.css$/u, replacement: libraryDist("styles.css") },
  { find: /^react-wikitext\/devtools\.css$/u, replacement: libraryDist("devtools.css") },
];

export default defineConfig(({ mode }) => ({
  root: "playground",
  server: {
    host: "127.0.0.1",
    fs: {
      allow: [repoRoot],
    },
  },
  plugins: [stripMissingSourceMap(), react()],
  resolve: {
    alias: [
      ...(mode === "dist" ? distAliases : sourceAliases),
      { find: /^@pg\//u, replacement: `${playgroundSrc}/` },
    ],
  },
  optimizeDeps: {
    // 浏览器包没有 ESM 导出；预打包会合成不存在的 default，导致命名空间导入报错。
    exclude: ["wikiparser-node/bundle/bundle.min.js"],
  },
}));
