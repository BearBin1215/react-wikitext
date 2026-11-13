const assert = require("node:assert/strict");
const { flattenNodes } = require("react-wikitext/ast");
const { MEDIAWIKI_CONFIG } = require("react-wikitext/configs");
const { createTemplateTableProvider, createWikitextCompiler } = require("react-wikitext/expand");
const { createWikiparser, parseWikitext } = require("react-wikitext/parse");

const document = parseWikitext("== Head ==\ntext");
assert.equal(document.ast.type, "root");
assert.equal(
  flattenNodes(document.ast).some((node) => node.type === "heading"),
  true,
);
assert.ok(MEDIAWIKI_CONFIG.ext.includes("ref"));

const compiler = createWikitextCompiler({
  parser: createWikiparser(),
  provider: createTemplateTableProvider({
    key: "consumer:node",
    revision: "v1",
    templates: { "Template:T": "expanded" },
  }),
});
compiler
  .compile({ key: "page", revision: "1", text: "{{T}}" })
  .then(async (compilation) => {
    assert.equal(compilation.snapshot.source, "expanded");
    assert.equal(compilation.status, "complete");
    await compiler.dispose();
    console.log(`Node ${process.versions.node} CJS parse and expand passed.`);
    return undefined;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
