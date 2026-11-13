import assert from "node:assert/strict";

import { flattenNodes } from "react-wikitext/ast";
import { MEDIAWIKI_CONFIG } from "react-wikitext/configs";
import { createTemplateTableProvider, createWikitextCompiler } from "react-wikitext/expand";
import { createWikiparser, parseWikitext } from "react-wikitext/parse";

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
const compilation = await compiler.compile({ key: "page", revision: "1", text: "{{T}}" });
assert.equal(compilation.snapshot.source, "expanded");
assert.equal(compilation.status, "complete");
await compiler.dispose();
console.log(`Node ${process.versions.node} ESM parse and expand passed.`);
