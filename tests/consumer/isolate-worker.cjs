const assert = require("node:assert/strict");

const workerApi = require("react-wikitext/worker");
assert.equal(typeof workerApi.createWikitextWorkerHandler, "function");
assert.equal(typeof workerApi.attachWikitextWorker, "function");
assert.equal(workerApi.useWikitextPreview, undefined);

const cache = Object.keys(require.cache).map((file) => file.replace(/\\/gu, "/"));
assert.equal(
  cache.some((file) => /\/node_modules\/(?:react|react-dom)\//u.test(file)),
  false,
  "worker must not load React",
);
console.log("worker isolation passed.");
