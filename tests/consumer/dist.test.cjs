const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");

const parseApi = require("react-wikitext/parse");
assert.equal(typeof parseApi.parseWikitext, "function");
assert.equal(parseApi.normalizeConfig, undefined);
assert.equal(parseApi.collectHeadings, undefined);
assert.equal(parseApi.createWikiparserAdapter, undefined);
assert.equal(parseApi.normalizeSource, undefined);

const expandApi = require("react-wikitext/expand");
assert.equal(typeof expandApi.expandWikitext, "function");
assert.equal(typeof expandApi.WikitextExpandError, "function");
assert.equal(typeof expandApi.WikitextError, "function");

const document = parseApi.parseWikitext("text {{Tpl}}");
assert.equal(document.ast.type, "root");

const ast = require("react-wikitext/ast");
const nodes = ast.flattenNodes(document.ast);
assert.equal(
  nodes.some((node) => node.type === "template"),
  true,
);
assert.equal(typeof ast.WikitextError, "function");
assert.equal(ast.WikitextExpandError, undefined);
assert.equal(ast.WikitextPrepareError, undefined);

const devtools = require("react-wikitext/devtools");
assert.equal(typeof devtools.AstTree, "function");
assert.equal(typeof devtools.NodeInspector, "function");
assert.equal(typeof devtools.findAstTreeNode, "function");
assert.equal(typeof devtools.getNodeRange, "function");
assert.equal(typeof devtools.getNodeSource, "function");
assert.equal(typeof devtools.isSyntaxNode, "function");
assert.equal(devtools.WikitextView, undefined);

const hast = require("react-wikitext/hast");
assert.equal(typeof hast.prepareWikitext, "function");
assert.equal(hast.collectHeadings, undefined);
assert.equal(hast.resolvePrepareSettings, undefined);
assert.equal(hast.resolveWikitextLabels, undefined);
assert.equal(typeof hast.WikitextError, "function");
const prepared = hast.prepareWikitext(document);
assert.equal(Array.isArray(prepared.headings), true);

const unifiedApi = require("react-wikitext/unified");
assert.equal(typeof unifiedApi.createWikitextProcessor, "function");
assert.equal(unifiedApi.wikitextFinalize, undefined);
assert.equal(unifiedApi.wikitextParse, undefined);

const root = require("react-wikitext");
assert.equal(typeof root.Wikitext, "function");
assert.equal(typeof root.WikitextView, "function");
assert.equal(root.expandWikitext, undefined);
assert.equal(root.RenderErrorBoundary, undefined);
assert.equal(root.createHastIndex, undefined);
assert.equal(root.createSemanticIndex, undefined);
assert.equal(root.WikitextViewContext, undefined);

const configs = require("react-wikitext/configs");
assert.equal(typeof configs.MEDIAWIKI_CONFIG, "object");
assert.equal(configs.MINIMUM_CONFIG, undefined);
assert.equal(configs.normalizeConfig, undefined);
assert.equal(configs.MEDIAWIKI_CONFIG_SOURCE, undefined);

const dist = join(__dirname, "../../dist");
for (const file of [
  "index.js",
  "index.cjs",
  "ast.js",
  "parse.js",
  "expand.js",
  "expand.cjs",
  "hast.js",
  "unified.js",
  "view.js",
  "configs.js",
  "devtools.js",
  "devtools.cjs",
  "styles.css",
  "tokens.css",
  "devtools.css",
]) {
  assert.equal(existsSync(join(dist, file)), true, `${file} should exist in dist`);
}

const packageJson = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"));
assert.equal(packageJson.peerDependencies.react, ">=18.2 <20");
assert.equal(packageJson.peerDependencies["react-dom"], ">=18.2 <20");
assert.equal(packageJson.exports["./tokens.css"], "./dist/tokens.css");
assert.equal(packageJson.exports["./devtools"].import.default, "./dist/devtools.js");
assert.equal(packageJson.exports["./devtools"].require.default, "./dist/devtools.cjs");
assert.equal(packageJson.exports["./devtools.css"], "./dist/devtools.css");

let resolveCalls = 0;
expandApi
  .expandWikitext("{{T}}", {
    templates: new Map([["Template:T", "hello"]]),
    resolveTemplate: () => {
      resolveCalls += 1;
      return "remote";
    },
  })
  .then((expanded) => {
    assert.equal(expanded.document.source, "hello");
    assert.equal(expanded.expansion.status, "complete");
    assert.equal(resolveCalls, 0, "table entries must win over the callback");
    console.log("CJS consumer smoke passed.");
    return undefined;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
