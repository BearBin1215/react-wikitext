const assert = require("node:assert/strict");

const view = require("react-wikitext/view");
assert.equal(typeof view.WikitextView, "function");
assert.equal(typeof view.WikitextFragment, "function");
assert.equal(view.RenderErrorBoundary, undefined);
assert.equal(view.createHastIndex, undefined);
assert.equal(view.createSemanticIndex, undefined);
assert.equal(view.WikitextViewContext, undefined);
assert.equal(
  Object.keys(require.cache).some((file) => file.includes("wikiparser-node")),
  false,
  "view must not load the parser",
);
console.log("view isolation passed.");
