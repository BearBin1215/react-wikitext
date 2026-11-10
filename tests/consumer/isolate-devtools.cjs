const assert = require("node:assert/strict");

const devtools = require("react-wikitext/devtools");
assert.equal(typeof devtools.AstTree, "function");
assert.equal(typeof devtools.NodeInspector, "function");
assert.equal(typeof devtools.snapshotSelection, "function");
assert.equal(typeof devtools.restoreSelectedId, "function");
assert.equal(typeof devtools.getNodeRange, "function");
assert.equal(devtools.WikitextView, undefined);
assert.equal(devtools.prepareWikitext, undefined);

const cache = Object.keys(require.cache).map((file) => file.replace(/\\/gu, "/"));
assert.equal(
  cache.some((file) => file.includes("wikiparser-node")),
  false,
  "devtools must not load the parser",
);
assert.equal(
  cache.some((file) => file.includes("/node_modules/react/")),
  true,
  "devtools must load React",
);
console.log("devtools isolation passed.");
