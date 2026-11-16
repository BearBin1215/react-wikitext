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
  // `dist/vendor/expr.js` 是独立的 #expr 求值器，不是 parser；其余 wikiparser-node 文件都不应加载。
  cache.some((file) => file.includes("wikiparser-node") && !file.includes("/dist/vendor/")),
  false,
  "expand must not load the default parser; the host injects a parser instance",
);
assert.equal(
  cache.some((file) => /\/node_modules\/(?:react|react-dom)\//u.test(file)),
  false,
  "expand must not load React",
);
console.log("expand isolation passed.");
