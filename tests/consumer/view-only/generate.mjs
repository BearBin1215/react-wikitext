import { writeFileSync } from "node:fs";
import { prepareWikitext, serializeWikitextRenderDocument } from "react-wikitext/hast";
import { parseWikitext } from "react-wikitext/parse";

const document = parseWikitext("== Head ==\n[[A|label]]");
const prepared = prepareWikitext(document, {
  resolveLink: () => ({ href: "/wiki/A" }),
});
const snapshot = serializeWikitextRenderDocument(prepared);
writeFileSync(new URL("./snapshot.json", import.meta.url), JSON.stringify(snapshot));
console.log("view-only snapshot generated.");
