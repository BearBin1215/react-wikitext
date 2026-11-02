import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const dist = join(root, "dist");
const pages = ["index.html", "parse.html", "worker.html"];
for (const page of pages) {
  const path = join(dist, page);
  try {
    statSync(path);
  } catch {
    throw new Error(`Vite consumer did not emit ${page}.`);
  }
}

const assets = join(dist, "assets");
const files = readdirSync(assets);
const jsFiles = files.filter((file) => file.endsWith(".js"));
const cssFiles = files.filter((file) => file.endsWith(".css"));
if (jsFiles.length === 0) {
  throw new Error("Vite consumer produced no JS assets.");
}
if (cssFiles.length === 0) {
  throw new Error("Vite consumer produced no CSS assets.");
}

const source = jsFiles.map((file) => readFileSync(join(assets, file), "utf8")).join("\n");
if (/from\s+["']react["']/u.test(source)) {
  throw new Error("Vite consumer left React as an unbundled import.");
}

// 解析器是否保留与可用由浏览器执行结果验证；压缩后不应再用字符串出现与否代替执行。
console.log(
  JSON.stringify(
    {
      pages,
      jsAssets: jsFiles,
      cssAssets: cssFiles,
      jsBytes: jsFiles.reduce((total, file) => total + statSync(join(assets, file)).size, 0),
      bundler: "vite (minify: true, target: es2022)",
    },
    null,
    2,
  ),
);
console.log("Vite consumer build passed.");
