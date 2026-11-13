import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { WikitextView } from "react-wikitext";
import { createTemplateTableProvider, createWikitextCompiler } from "react-wikitext/expand";
import { prepareWikitext } from "react-wikitext/hast";
import { createWikiparser, parseWikitext } from "react-wikitext/parse";
// oxlint-disable-next-line import/no-unassigned-import -- webpack CSS entry
import "react-wikitext/styles.css";

const doc = parseWikitext("== Head ==\n[[A|label]]");
const prepared = prepareWikitext(doc);
const compiler = createWikitextCompiler({
  parser: createWikiparser(),
  provider: createTemplateTableProvider({
    key: "consumer:webpack",
    revision: "v1",
    templates: { "Template:T": "text" },
  }),
});
void compiler.compile({ key: "page", revision: "1", text: "{{T}}" });
const root = globalThis.document.getElementById("root");
if (!root) {
  throw new Error("missing root");
}
createRoot(root).render(createElement(WikitextView, { snapshot: prepared }));
