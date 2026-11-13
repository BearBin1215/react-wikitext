import { prepareWikitext } from "react-wikitext/hast";
import { createTemplateTableProvider, createWikitextCompiler } from "react-wikitext/expand";
import { createWikiparser } from "react-wikitext/parse";
import { summarize } from "./hast.js";

const SOURCE = "== Worker ==\n{{Hello|name=Ada}} and [[B|link]].";

async function run() {
  const compiler = createWikitextCompiler({
    parser: createWikiparser(),
    provider: createTemplateTableProvider({
      key: "consumer:webpack-worker",
      revision: "v1",
      templates: { "Template:Hello": "Hello {{{name|world}}}!" },
    }),
  });
  const compilation = await compiler.compile(
    { key: "worker", revision: "1", text: SOURCE },
    { pageName: "Consumer worker" },
  );
  const prepared = prepareWikitext(compilation.snapshot);
  await compiler.dispose();
  postMessage({
    type: "result",
    parser: compilation.snapshot.meta.parser,
    expansionStatus: compilation.status,
    recordCount: compilation.snapshot.graph.invocations.length,
    ...summarize(prepared.hast),
  });
}

run().catch((error) => {
  postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
});
