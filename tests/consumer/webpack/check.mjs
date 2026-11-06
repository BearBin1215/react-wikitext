import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("./dist/", import.meta.url));
const files = readdirSync(dist);
const pages = ["index.html", "parse.html", "worker-page.html"];
for (const page of pages) {
  try {
    statSync(join(dist, page));
  } catch {
    throw new Error(`webpack consumer did not emit ${page}.`);
  }
}

const jsFiles = files.filter((file) => file.endsWith(".js"));
const cssFiles = files.filter((file) => file.endsWith(".css"));
if (jsFiles.length === 0) {
  throw new Error("webpack consumer produced no JS assets.");
}
if (cssFiles.length === 0) {
  throw new Error("webpack consumer produced no CSS assets.");
}

const source = jsFiles.map((file) => readFileSync(join(dist, file), "utf8")).join("\n");
if (/require\(["']react["']\)/u.test(source) || /from\s+["']react["']/u.test(source)) {
  throw new Error("webpack consumer left React as an unbundled import.");
}

const css = cssFiles.map((file) => readFileSync(join(dist, file), "utf8")).join("\n");
if (!css.includes("wikitext-view")) {
  throw new Error("webpack consumer did not bundle the stylesheet entry.");
}

// 解析器保留与执行结果由浏览器用例验证；压缩后的产物不再用字符串出现与否判断。
console.log(
  JSON.stringify(
    {
      pages,
      jsAssets: jsFiles,
      cssAssets: cssFiles,
      jsBytes: jsFiles.reduce((total, file) => total + statSync(join(dist, file)).size, 0),
      bundler: "webpack (mode: production, minimize: true)",
    },
    null,
    2,
  ),
);
console.log("webpack consumer build passed.");
