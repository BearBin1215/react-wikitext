import type { Root } from "hast";
import type { VFile } from "vfile";
import { describe, expect, it } from "vitest";
import type { WikitextNode, WikitextRoot } from "@/ast";
import { prepareWikitext, prepareWikitextAsync, type WikitextPrepareOptions } from "@/hast";
import { createWikiparser } from "@/parse";
import { createWikitextProcessor, type WikitextProcessorOptions } from "@/unified";
import { countFillers, sparseTableSource } from "../helpers/sparseTables";

const parser = createWikiparser();
const source = "== H ==\n[[A|label]] [[File:X.png|thumb|caption]]";

function wikiPlugin() {
  return (tree: WikitextRoot, file: VFile) => {
    (tree as unknown as { children: WikitextNode[] }).children.push({
      type: "callout",
      id: "callout",
      children: [{ type: "text", id: "callout-text", value: "note" }],
    } as unknown as WikitextNode);
    file.message("wiki warning", { ruleId: "WIKI_RULE" });
  };
}

function rehypePlugin() {
  return (tree: Root, file: VFile) => {
    tree.children.push({
      type: "element",
      tagName: "span",
      properties: { className: ["extra"] },
      children: [{ type: "text", value: "extra" }],
    });
    file.message("rehype warning", { ruleId: "REHYPE_RULE" });
  };
}

const settings = {
  resolveLink: () => ({ href: "/wiki/A" }),
  resolveImage: () => ({ src: "https://example.com/x.png" }),
  labels: { filePlaceholder: "FILE" },
  headingIdStrategy: "mediawiki",
  handlers: {
    callout: () => ({
      type: "element",
      tagName: "span",
      properties: { className: ["callout"] },
      children: [{ type: "text", value: "handled" }],
    }),
  },
} satisfies Omit<WikitextPrepareOptions, "wikitextPlugins" | "rehypePlugins">;

const prepareOptions: WikitextPrepareOptions = {
  ...settings,
  wikitextPlugins: [wikiPlugin],
  rehypePlugins: [rehypePlugin],
};

const processorOptions: WikitextProcessorOptions = {
  parser,
  ...settings,
  wikitextPlugins: [wikiPlugin],
  rehypePlugins: [rehypePlugin],
};

describe("pipeline equivalence", () => {
  it("produces comparable results through sync, async and processor pipelines", async () => {
    const document = parser.parse(source);
    const original = JSON.parse(JSON.stringify(document));
    const sync = prepareWikitext(document, prepareOptions);
    const async = await prepareWikitextAsync(document, prepareOptions);
    const processor = createWikitextProcessor(processorOptions);
    const processedSync = processor.runSync(source);
    const processedAsync = await processor.run(source);

    for (const result of [async, processedSync, processedAsync]) {
      expect(result.ast).toEqual(sync.ast);
      expect(result.hast).toEqual(sync.hast);
      expect(result.headings).toEqual(sync.headings);
      expect(result.meta).toEqual(sync.meta);
      expect(result.diagnostics).toEqual(sync.diagnostics);
    }
    expect(JSON.parse(JSON.stringify(document))).toEqual(original);
  });

  it("applies filler fallback identically through every entry", async () => {
    const document = parser.parse(sparseTableSource());
    const sync = prepareWikitext(document);
    const async = await prepareWikitextAsync(document);
    const processor = createWikitextProcessor({ parser });
    const processedSync = processor.runSync(document.source);
    const processedAsync = await processor.run(document.source);

    expect(countFillers(sync.hast)).toBe(0);
    for (const result of [async, processedSync, processedAsync]) {
      expect(result.hast).toEqual(sync.hast);
      expect(result.diagnostics).toEqual(sync.diagnostics);
    }
  });

  it("sanitizes plugin output after the final HAST plugin", () => {
    const processor = createWikitextProcessor({
      parser,
      headingIdStrategy: "none",
    });
    processor.useHast(() => (tree: Root) => {
      tree.children.push({
        type: "element",
        tagName: "img",
        properties: { src: "https://evil.example/x.png", alt: "leak" },
        children: [],
      });
    });
    const renderDocument = processor.runSync("== H ==");
    expect(renderDocument.meta.headingIdStrategy).toBe("none");
    expect(renderDocument.headings[0]?.id).toBeUndefined();
    expect(JSON.stringify(renderDocument.hast)).not.toContain("evil.example");
    expect(renderDocument.diagnostics).toContainEqual(
      expect.objectContaining({ code: "UNAUTHORIZED_IMAGE", stage: "finalize" }),
    );
  });
});
