const assert = require("node:assert/strict");

const parseApi = require("react-wikitext/parse");
assert.equal(typeof parseApi.parseWikitext, "function");
assert.equal(parseApi.createWikiparserAdapter, undefined);
assert.equal(parseApi.normalizeSource, undefined);
const reactModules = Object.keys(require.cache).filter((file) =>
  file.replace(/\\/gu, "/").includes("/node_modules/react/"),
);
assert.deepEqual(reactModules, [], "parse subpath must not load React");
console.log("parse isolation passed.");
