import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseWikitext } from "../../../dist/parse.js";
import { prepareWikitext } from "../../../dist/hast.js";
import { WikitextView } from "../../../dist/view.js";

const OUT = resolve("test-results/budget");
const DIAGNOSTIC = "TABLE_FILLER_BUDGET_EXCEEDED";

function sparseSource(tables = 45) {
  const wide = `| ${Array.from({ length: 100 }, (_, index) => `h${index}`).join(" || ")}`;
  const sparse = Array.from({ length: 10 }, () => "|-\n| y").join("\n");
  const table = `{| class="wikitable"\n|-\n${wide}\n${sparse}\n|}`;
  return Array.from({ length: tables }, () => table).join("\n\n");
}

function countNodes(node) {
  if (!node || typeof node !== "object") {
    return 0;
  }
  const children = Array.isArray(node.children) ? node.children : [];
  return 1 + children.reduce((total, child) => total + countNodes(child), 0);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const source = sparseSource();
const started = performance.now();
const document = prepareWikitext(parseWikitext(source));
const prepareMs = performance.now() - started;
const diagnostics = document.diagnostics.filter((item) => item.code === DIAGNOSTIC);
if (diagnostics.length !== 45) {
  throw new Error(`Expected 45 filler diagnostics, received ${diagnostics.length}.`);
}

const html = renderToStaticMarkup(createElement(WikitextView, { document }));
const tokens = readFileSync(resolve("dist/tokens.css"), "utf8");
const styles = readFileSync(resolve("dist/styles.css"), "utf8").replace(
  /@import\s+["']\.\/tokens\.css["'];?/u,
  "",
);
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Budget regression</title>
<style>${tokens}
${styles}</style>
<style>
html, body { margin: 0; padding: 0; }
body { padding: 16px; font-family: system-ui, sans-serif; }
main { overflow: auto; max-width: 100%; max-height: 70vh; border: 1px solid #ccc; }
</style>
</head>
<body>
<main>${html}</main>
</body>
</html>`;
mkdirSync(resolve(OUT, "site"), { recursive: true });
writeFileSync(resolve(OUT, "site/index.html"), page);
writeFileSync(
  resolve(OUT, "report.json"),
  `${JSON.stringify(
    {
      sourceChars: source.length,
      diagnostics: diagnostics.length,
      nodes: countNodes(document.hast),
      prepareMs: Math.round(prepareMs),
    },
    null,
    2,
  )}\n`,
);
