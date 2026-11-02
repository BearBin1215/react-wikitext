import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * CJS 产物不应引用 Node 内置模块：浏览器 bundler 走 require 条件时无法解析 `node:*`。
 * 这条检查覆盖 vfile 等打包依赖在 CJS 分支上误取 Node 条件的情况。
 */
const NODE_BUILTIN = /require\("node:[a-z_/]+"\)/gu;
const dist = new URL("../../dist/", import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/u, "");
const files = readdirSync(dist).filter((file) => file.endsWith(".cjs"));

if (files.length === 0) {
  throw new Error("dist/*.cjs is empty; run `pnpm build` first.");
}

const offenders = [];
for (const file of files) {
  const code = readFileSync(join(dist, file), "utf8");
  for (const match of code.matchAll(NODE_BUILTIN)) {
    offenders.push(`${file}: ${match[0]}`);
  }
}

if (offenders.length > 0) {
  console.error(offenders.join("\n"));
  throw new Error("CJS output references Node built-ins; force browser resolution in tsdown.");
}

console.log(`CJS external check passed (${files.length} files).`);
