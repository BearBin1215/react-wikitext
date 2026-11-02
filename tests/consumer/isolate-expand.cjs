const assert = require("node:assert/strict");

const expandApi = require("react-wikitext/expand");
assert.equal(typeof expandApi.expandWikitext, "function");
assert.equal(typeof expandApi.WikitextExpandError, "function");
assert.equal(typeof expandApi.WikitextError, "function");
assert.equal(expandApi.prepareWikitext, undefined);

const cache = Object.keys(require.cache).map((file) => file.replace(/\\/gu, "/"));
assert.equal(
  cache.some((file) => file.includes("wikiparser-node")),
  true,
  "expand must load the parser",
);
assert.equal(
  cache.some((file) => /\/node_modules\/(?:react|react-dom)\//u.test(file)),
  false,
  "expand must not load React",
);
console.log("expand isolation passed.");
