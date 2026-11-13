const assert = require("node:assert/strict");

const expandApi = require("react-wikitext/expand");
assert.equal(expandApi.expandWikitext, undefined);
assert.equal(typeof expandApi.createWikitextCompiler, "function");
assert.equal(typeof expandApi.createTemplateTableProvider, "function");
assert.equal(typeof expandApi.WikitextExpandError, "function");
assert.equal(typeof expandApi.WikitextError, "function");
assert.equal(expandApi.prepareWikitext, undefined);

const cache = Object.keys(require.cache).map((file) => file.replace(/\\/gu, "/"));
assert.equal(
  cache.some((file) => file.includes("wikiparser-node")),
  false,
  "expand must not load the default parser; the host injects a parser instance",
);
assert.equal(
  cache.some((file) => /\/node_modules\/(?:react|react-dom)\//u.test(file)),
  false,
  "expand must not load React",
);
console.log("expand isolation passed.");
