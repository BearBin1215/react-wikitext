const assert = require("node:assert/strict");

const ast = require("react-wikitext/ast");
assert.equal(typeof ast.flattenNodes, "function");
assert.equal(typeof ast.WikitextError, "function");
assert.equal(ast.WikitextExpandError, undefined);
assert.equal(ast.WikitextPrepareError, undefined);
const cache = Object.keys(require.cache).map((file) => file.replace(/\\/gu, "/"));
assert.equal(
  cache.some((file) => file.includes("wikiparser-node")),
  false,
  "ast must not load the parser",
);
assert.equal(
  cache.some((file) => file.includes("/node_modules/react/")),
  false,
  "ast must not load React",
);
console.log("ast isolation passed.");
