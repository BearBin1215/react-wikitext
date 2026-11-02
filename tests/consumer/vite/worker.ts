import { prepareWikitext } from "react-wikitext/hast";
import { expandWikitext } from "react-wikitext/expand";
import { createWikiparser } from "react-wikitext/parse";
import { summarize } from "./hast";

const SOURCE = "== Worker ==\n{{Hello|name=Ada}} and [[B|link]].";

async function run(): Promise<void> {
  const parser = createWikiparser();
  const expanded = await expandWikitext(SOURCE, {
    parser,
    pageName: "Consumer worker",
    templates: { "Template:Hello": "Hello {{{name|world}}}!" },
  });
  const prepared = prepareWikitext(expanded.document);
  postMessage({
    type: "result",
    parser: expanded.document.meta.parser,
    expansionStatus: expanded.expansion.status,
    recordCount: expanded.expansion.records.length,
    ...summarize(prepared.hast),
  });
}

run().catch((error: unknown) => {
  postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
});
