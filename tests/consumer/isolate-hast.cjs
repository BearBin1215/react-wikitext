const assert = require("node:assert/strict");

const hast = require("react-wikitext/hast");
assert.equal(typeof hast.prepareWikitext, "function");
assert.equal(hast.collectHeadings, undefined);
assert.equal(hast.resolvePrepareSettings, undefined);
assert.equal(hast.resolveWikitextLabels, undefined);
assert.equal(typeof hast.WikitextError, "function");
const cache = Object.keys(require.cache).map((file) => file.replace(/\\/gu, "/"));
assert.equal(
  cache.some((file) => file.includes("wikiparser-node")),
  false,
  "hast must not load the parser",
);
assert.equal(
  cache.some((file) => file.includes("/node_modules/react/")),
  false,
  "hast must not load React",
);
console.log("hast isolation passed.");
