const assert = require("node:assert/strict");

const unifiedApi = require("react-wikitext/unified");
assert.equal(typeof unifiedApi.createWikitextProcessor, "function");
const cache = Object.keys(require.cache).map((file) => file.replace(/\\/gu, "/"));
assert.equal(
  cache.some((file) => file.includes("wikiparser-node")),
  false,
  "unified must not load the parser",
);
assert.equal(
  cache.some((file) => file.includes("/node_modules/react/")),
  false,
  "unified must not load React",
);
console.log("unified isolation passed.");
