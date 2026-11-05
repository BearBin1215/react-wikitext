import assert from "node:assert/strict";
import { flattenNodes } from "react-wikitext/ast";
import { MEDIAWIKI_CONFIG } from "react-wikitext/configs";
import { expandWikitext } from "react-wikitext/expand";
import { parseWikitext } from "react-wikitext/parse";

const document = parseWikitext("== Head ==\ntext");
assert.equal(document.ast.type, "root");
assert.equal(
  flattenNodes(document.ast).some((node) => node.type === "heading"),
  true,
);
assert.ok(MEDIAWIKI_CONFIG.ext.includes("ref"));
const expanded = await expandWikitext("{{T}}", { templates: { "Template:T": "expanded" } });
assert.equal(expanded.document.source, "expanded");
assert.equal(expanded.expansion.status, "complete");
console.log(`Node ${process.versions.node} ESM parse and expand passed.`);
