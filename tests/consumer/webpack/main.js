import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { WikitextView } from "react-wikitext";
import { expandWikitext } from "react-wikitext/expand";
import { prepareWikitext } from "react-wikitext/hast";
import { parseWikitext } from "react-wikitext/parse";
// oxlint-disable-next-line import/no-unassigned-import -- webpack CSS entry
import "react-wikitext/styles.css";

const doc = parseWikitext("== Head ==\n[[A|label]]");
const prepared = prepareWikitext(doc);
void expandWikitext("{{T}}", { templates: { "Template:T": "text" } });
const root = globalThis.document.getElementById("root");
if (!root) {
  throw new Error("missing root");
}
createRoot(root).render(createElement(WikitextView, { document: prepared }));
