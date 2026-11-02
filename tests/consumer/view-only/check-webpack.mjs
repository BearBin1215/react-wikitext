import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("./dist-webpack/", import.meta.url));
const files = readdirSync(dist);
for (const page of ["index.html", "bundle.js"]) {
  try {
    statSync(join(dist, page));
  } catch {
    throw new Error(`webpack view-only consumer did not emit ${page}.`);
  }
}
const jsFiles = files.filter((file) => file.endsWith(".js"));
const cssFiles = files.filter((file) => file.endsWith(".css"));
if (cssFiles.length === 0) {
  throw new Error("webpack view-only consumer produced no CSS assets.");
}

// 解析器隔离由浏览器执行结果验证：页面上的 globalThis.Parser 必须保持未初始化。
console.log(
  JSON.stringify(
    {
      pages: ["index.html"],
      jsAssets: jsFiles,
      cssAssets: cssFiles,
      bundler: "webpack (mode: production, minimize: true)",
    },
    null,
    2,
  ),
);
console.log("webpack view-only consumer build passed.");
