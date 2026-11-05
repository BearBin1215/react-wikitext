const assert = require("node:assert/strict");
const { flattenNodes } = require("react-wikitext/ast");
const { MEDIAWIKI_CONFIG } = require("react-wikitext/configs");
const { expandWikitext } = require("react-wikitext/expand");
const { parseWikitext } = require("react-wikitext/parse");

const document = parseWikitext("== Head ==\ntext");
assert.equal(document.ast.type, "root");
assert.equal(
  flattenNodes(document.ast).some((node) => node.type === "heading"),
  true,
);
assert.ok(MEDIAWIKI_CONFIG.ext.includes("ref"));

void expandWikitext("{{T}}", { templates: { "Template:T": "expanded" } })
  .then((expanded) => {
    assert.equal(expanded.document.source, "expanded");
    assert.equal(expanded.expansion.status, "complete");
    console.log(`Node ${process.versions.node} CJS parse and expand passed.`);
    return undefined;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
