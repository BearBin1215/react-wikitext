import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import ts from "typescript";

const distDir = fileURLToPath(new URL("../../../dist/", import.meta.url));
const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8"),
);
const viewEntry = resolve(
  distDir,
  packageJson.exports["./view"].import.default.replace(/^\.\/dist\//u, ""),
);

function staticSpecifiers(fileName, code) {
  const sourceFile = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const specifiers = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
      return;
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) {
        specifiers.push(argument.text);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function traceEntry(entryFile) {
  const files = new Set();
  const external = new Set();
  const pending = [entryFile];
  while (pending.length > 0) {
    const file = pending.pop();
    if (files.has(file)) {
      continue;
    }
    files.add(file);
    for (const specifier of staticSpecifiers(file, readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) {
        external.add(specifier);
        continue;
      }
      const resolved = resolve(dirname(file), specifier);
      if (resolved.startsWith(distDir)) {
        pending.push(resolved);
      }
    }
  }
  return { files: [...files], external: [...external] };
}

const trace = traceEntry(viewEntry);
const forbiddenLibraryCode =
  /createHastSanitizeSchema|hast-util-sanitize|wikiparser-node|from\s+["']entities["']/u;
for (const file of trace.files) {
  if (forbiddenLibraryCode.test(readFileSync(file, "utf8"))) {
    throw new Error(`view entry reached sanitizer or parser code: ${file}`);
  }
}
for (const specifier of trace.external) {
  if (/^(?:entities|hast-util-sanitize|wikiparser-node)(?:\/|$)/u.test(specifier)) {
    throw new Error(`view entry kept a forbidden external import: ${specifier}`);
  }
}

const outputDir = fileURLToPath(new URL("./dist/", import.meta.url));
const assetsDir = join(outputDir, "assets");
for (const page of ["index.html"]) {
  try {
    statSync(join(outputDir, page));
  } catch {
    throw new Error(`view-only consumer did not emit ${page}.`);
  }
}
const files = readdirSync(assetsDir);
const jsFiles = files.filter((file) => file.endsWith(".js"));
const cssFiles = files.filter((file) => file.endsWith(".css"));
if (jsFiles.length === 0) {
  throw new Error("view-only consumer produced no JS assets.");
}
if (cssFiles.length === 0) {
  throw new Error("view-only consumer produced no CSS assets.");
}

let rawBytes = 0;
let gzipBytes = 0;
const bundleText = jsFiles
  .map((file) => {
    const path = join(assetsDir, file);
    const content = readFileSync(path);
    rawBytes += statSync(path).size;
    gzipBytes += gzipSync(content).length;
    return content.toString("utf8");
  })
  .join("\n");
// 压缩后不再用字符串出现与否判断 parser/sanitizer 是否被打入；
// 入口追踪与浏览器执行（globalThis.Parser 未初始化）共同验证隔离。
if (/from\s+["']react["']|require\(["']react["']\)/u.test(bundleText)) {
  throw new Error("view-only bundle left React as an unbundled import.");
}

console.log(
  JSON.stringify(
    {
      entryFiles: trace.files.map((file) => file.slice(distDir.length)),
      externalImports: trace.external,
      jsAssets: jsFiles,
      cssAssets: cssFiles,
      exportsUsed: ["WikitextView"],
      includesReact: bundleText.includes("__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS"),
      bundler: "vite (minify: true, target: es2022)",
      rawBytes,
      gzipBytes,
    },
    null,
    2,
  ),
);
console.log("view-only consumer passed.");
