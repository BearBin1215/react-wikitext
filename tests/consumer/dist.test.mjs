import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import * as rootModule from "react-wikitext";
import { WikitextView } from "react-wikitext";
import * as ast from "react-wikitext/ast";
import * as configs from "react-wikitext/configs";
import * as devtools from "react-wikitext/devtools";
import * as expand from "react-wikitext/expand";
import * as hast from "react-wikitext/hast";
import * as parseApi from "react-wikitext/parse";

assert.equal(typeof WikitextView, "function");
assert.equal(typeof rootModule.Wikitext, "function");
assert.equal("expandWikitext" in rootModule, false);
assert.equal("RenderErrorBoundary" in rootModule, false);
assert.equal("createHastIndex" in rootModule, false);
assert.equal("createSemanticIndex" in rootModule, false);
assert.equal("WikitextViewContext" in rootModule, false);

assert.equal(typeof parseApi.parseWikitext, "function");
assert.equal("createWikiparserAdapter" in parseApi, false);
assert.equal("normalizeSource" in parseApi, false);
assert.equal(typeof hast.prepareWikitext, "function");
assert.equal("collectHeadings" in hast, false);
assert.equal("resolvePrepareSettings" in hast, false);
assert.equal("resolveWikitextLabels" in hast, false);
assert.equal("WikitextError" in hast, true);
assert.equal(typeof hast.sanitizeHref, "function");
assert.equal("normalizeConfig" in configs, false);
assert.equal("MEDIAWIKI_CONFIG_SOURCE" in configs, false);
assert.equal(typeof ast.flattenNodes, "function");
assert.equal(typeof ast.WikitextError, "function");
assert.equal("WikitextExpandError" in ast, false);
assert.equal("WikitextPrepareError" in ast, false);
assert.equal("WikitextError" in expand, true);
assert.equal(typeof devtools.AstTree, "function");
assert.equal(typeof devtools.NodeInspector, "function");
assert.equal(typeof devtools.getNodeRange, "function");
assert.equal(typeof devtools.getNodeSource, "function");
assert.equal(typeof devtools.snapshotSelection, "function");
assert.equal("WikitextView" in devtools, false);
assert.equal("AstTree" in rootModule, false);

const expanded = await expand.expandWikitext("{{T}}", {
  templates: { "Template:T": "hello" },
});
assert.equal(expanded.document.source, "hello");
assert.equal(expanded.expansion.status, "complete");

const document = parseApi.parseWikitext("== Head ==\n[[A|label]]");
assert.equal(document.ast.type, "root");
assert.equal(
  ast.flattenNodes(document.ast).some((node) => node.type === "link"),
  true,
);
const prepared = hast.prepareWikitext(document);
assert.equal(prepared.headings[0]?.id, "Head");
assert.equal(hast.sanitizeHref("javascript:alert(1)"), null);

const require = createRequire(import.meta.url);
const unified = require("react-wikitext/unified");
assert.equal(typeof unified.createWikitextProcessor, "function");
assert.equal(unified.wikitextParse, undefined);

const indexSource = readFileSync(new URL("../../dist/index.js", import.meta.url), "utf8");
assert.equal(indexSource.startsWith('"use client";'), true, "root entry must be client-safe");
const viewSource = readFileSync(new URL("../../dist/view.js", import.meta.url), "utf8");
assert.equal(viewSource.startsWith('"use client";'), true, "/view entry must be client-safe");
const astSource = readFileSync(new URL("../../dist/ast.js", import.meta.url), "utf8");
assert.equal(astSource.startsWith('"use client";'), false, "/ast must stay server-safe");
const devtoolsSource = readFileSync(new URL("../../dist/devtools.js", import.meta.url), "utf8");
assert.equal(
  devtoolsSource.startsWith('"use client";'),
  true,
  "/devtools entry must be client-safe",
);
assert.equal(
  devtoolsSource.includes("wikiparser-node"),
  false,
  "/devtools must not load the parser",
);
assert.equal(indexSource.includes('from "entities"'), false, "entities must be bundled");
assert.match(indexSource, /from "react"/u, "root chunk should keep React external");

console.log("ESM consumer smoke passed.");
