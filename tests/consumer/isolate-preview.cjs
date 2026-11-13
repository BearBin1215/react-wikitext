const assert = require("node:assert/strict");

const previewApi = require("react-wikitext/preview");
assert.equal(typeof previewApi.useWikitextPreview, "function");
assert.equal(typeof previewApi.createWikitextWorkerExecutor, "function");
assert.equal(previewApi.prepareWikitext, undefined);
assert.equal(previewApi.createWikitextCompiler, undefined);

const cache = Object.keys(require.cache).map((file) => file.replace(/\\/gu, "/"));
assert.equal(
  cache.some((file) => file.includes("wikiparser-node")),
  false,
  "preview must not load the default parser",
);
console.log("preview isolation passed.");
