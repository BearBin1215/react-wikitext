import type { VFile } from "vfile";
import { describe, expect, it } from "vitest";
import type { Root, RootContent } from "hast";
import {
  findNodeById,
  flattenNodes,
  type WikitextDocument,
  type WikitextNode,
  type WikitextRoot,
} from "@/ast";
import { WikitextPrepareError } from "@/hast";
import { createWikiparser } from "@/parse";
import { createWikitextProcessor, getWikitextDocument, getWikitextRenderDocument } from "@/unified";

const parser = createWikiparser();

function firstText(root: WikitextRoot): string | undefined {
  for (const node of flattenNodes(root)) {
    if (node.type === "text") {
      return node.value;
    }
  }
  return undefined;
}

function collectHastNodeIds(root: Root): string[] {
  const ids: string[] = [];
  const visit = (node: Root | RootContent): void => {
    if (node.type === "root") {
      for (const child of node.children) {
        visit(child);
      }
      return;
    }
    if (node.type !== "element") {
      return;
    }
    const id = (node.data as { wikitext?: { id?: string } } | undefined)?.wikitext?.id;
    if (id !== undefined) {
      ids.push(id);
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
  return ids;
}

describe("wikitext processor", () => {
  it("runs semantic and HAST plugins, then sanitizes the result", () => {
    const processor = createWikitextProcessor({ parser });
    processor.useHast(() => (tree: Root) => {
      // 模拟真实高亮插件生成的结构，并顺带注入不安全的属性。
      for (const child of tree.children) {
        if (child.type === "element" && child.tagName === "p") {
          child.children = [
            {
              type: "element",
              tagName: "span",
              properties: { className: ["hljs-string"], onClick: "alert(1)" },
              children: [{ type: "text", value: "highlighted" }],
            },
          ];
        }
      }
    });

    const prepared = processor.runSync("== H ==\ntext");
    expect(prepared.headings[0]?.id).toBe("H");

    const paragraph = prepared.hast.children.find(
      (node) => node.type === "element" && node.tagName === "p",
    );
    expect(paragraph?.type).toBe("element");
    if (paragraph?.type !== "element") {
      return;
    }
    const span = paragraph.children[0];
    expect(span?.type).toBe("element");
    if (span?.type !== "element") {
      return;
    }
    expect(span.properties.className).toEqual(["hljs-string"]);
    expect(span.properties.onClick).toBeUndefined();
  });

  it("creates a source link with resolver data from options", () => {
    const prepared = createWikitextProcessor({
      parser,
      resolveLink: () => ({ href: "/wiki/A" }),
    }).runSync("[[A|B]]");
    expect(JSON.stringify(prepared.hast)).toContain("/wiki/A");
    expect(prepared.ast.type).toBe("root");
  });

  it("requires an explicit parser", () => {
    expect(() => createWikitextProcessor({} as never)).toThrow(WikitextPrepareError);
  });

  it("adopts a replaced working tree and keeps the parsed snapshot intact", () => {
    let original: WikitextDocument | undefined;
    const processor = createWikitextProcessor({ parser });
    processor.useWikitext(() => (tree: WikitextRoot, file: VFile) => {
      original = getWikitextDocument(file);
      const next = structuredClone(tree);
      for (const node of flattenNodes(next)) {
        if (node.type === "text") {
          (node as { value: string }).value = "after";
        }
      }
      return next;
    });
    const prepared = processor.runSync("before");
    expect(firstText(prepared.ast)).toBe("after");
    expect(original).toBeDefined();
    expect(firstText(original!.ast)).toBe("before");
  });

  it("isolates the parsed snapshot from in-place plugin edits", () => {
    let metaBefore: string | undefined;
    let diagnosticsBefore: unknown;
    let original: WikitextDocument | undefined;
    const processor = createWikitextProcessor({ parser });
    processor.useWikitext(() => (tree: WikitextRoot, file: VFile) => {
      original = getWikitextDocument(file);
      metaBefore = JSON.stringify(original!.meta);
      diagnosticsBefore = structuredClone(original!.diagnostics);
      for (const node of flattenNodes(tree)) {
        if (node.type === "text") {
          (node as { value: string }).value = "after";
        }
      }
    });
    const prepared = processor.runSync("before");
    expect(firstText(prepared.ast)).toBe("after");
    expect(firstText(original!.ast)).toBe("before");
    expect(JSON.stringify(original!.meta)).toBe(metaBefore);
    expect(original!.diagnostics).toEqual(diagnosticsBefore);
  });

  it("validates the plugin tree and reassigns ids before conversion", () => {
    const processor = createWikitextProcessor({ parser });
    processor.useWikitext(() => (tree: WikitextRoot) => {
      const first = tree.children[0];
      if (first) {
        (tree as unknown as { children: WikitextNode[] }).children.unshift(structuredClone(first));
      }
    });
    const prepared = processor.runSync("one\n\ntwo");
    const ids = flattenNodes(prepared.ast).map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const node of flattenNodes(prepared.ast)) {
      expect(findNodeById(prepared, node.id)).toBe(node);
    }
    for (const id of collectHastNodeIds(prepared.hast)) {
      expect(findNodeById(prepared, id)).toBeDefined();
    }
  });

  it("rejects invalid or over-budget working trees before conversion", () => {
    const nonRoot = createWikitextProcessor({ parser });
    nonRoot.useWikitext(
      () => () => ({ type: "paragraph", id: "0", children: [] }) as unknown as WikitextRoot,
    );
    expect(() => nonRoot.runSync("x")).toThrow(WikitextPrepareError);

    const badChildren = createWikitextProcessor({ parser });
    badChildren.useWikitext(
      () => () => ({ type: "root", id: "0", children: [42] }) as unknown as WikitextRoot,
    );
    expect(() => badChildren.runSync("x")).toThrow(WikitextPrepareError);

    let deepNode = { type: "text", id: "deep", value: "x" } as WikitextNode;
    for (let index = 0; index < 1_100; index++) {
      deepNode = {
        type: "paragraph",
        id: `p-${index}`,
        children: [deepNode],
      } as unknown as WikitextNode;
    }
    const tooDeep = createWikitextProcessor({ parser });
    tooDeep.useWikitext(
      () => () => ({ type: "root", id: "0", children: [deepNode] }) as unknown as WikitextRoot,
    );
    try {
      tooDeep.runSync("x");
      throw new Error("expected the over-budget tree to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(WikitextPrepareError);
      expect((error as WikitextPrepareError).stage).toBe("wikitext");
    }
  });

  it("tags wiki and rehype messages with their own stages", () => {
    const processor = createWikitextProcessor({ parser });
    processor.useWikitext(() => (tree: WikitextRoot, file: VFile) => {
      void tree;
      file.message("wiki warning", { ruleId: "WIKI_RULE" });
    });
    processor.useHast(() => (tree: Root, file: VFile) => {
      void tree;
      file.message("rehype warning", { ruleId: "REHYPE_RULE" });
    });
    const prepared = processor.runSync("text");
    const wiki = prepared.diagnostics.filter((diagnostic) => diagnostic.code === "WIKI_RULE");
    const rehype = prepared.diagnostics.filter((diagnostic) => diagnostic.code === "REHYPE_RULE");
    expect(wiki).toHaveLength(1);
    expect(wiki[0]?.stage).toBe("wikitext");
    expect(rehype).toHaveLength(1);
    expect(rehype[0]?.stage).toBe("rehype");
  });

  it("starts each run with fresh state", () => {
    const processor = createWikitextProcessor({ parser });
    processor.useWikitext(() => (tree: WikitextRoot, file: VFile) => {
      void tree;
      file.message("once", { ruleId: "EACH_RUN" });
    });
    processor.runSync("first");
    const second = processor.runSync("second");
    expect(second.source).toBe("second");
    expect(firstText(second.ast)).toBe("second");
    expect(second.diagnostics.filter((diagnostic) => diagnostic.code === "EACH_RUN")).toHaveLength(
      1,
    );
    expect(second.meta.parser).toBe(parser.name);
  });

  it("exposes the rendered snapshot through typed VFile readers", () => {
    let parsed: WikitextDocument | undefined;
    let rendered: ReturnType<typeof getWikitextRenderDocument>;
    const processor = createWikitextProcessor({ parser });
    processor.useHast(() => (tree: Root, file: VFile) => {
      void tree;
      parsed = getWikitextDocument(file);
      rendered = getWikitextRenderDocument(file);
    });
    processor.runSync("text");
    expect(parsed?.ast.type).toBe("root");
    // 快照在最终阶段才写入，HAST 插件阶段还读不到。
    expect(rendered).toBeUndefined();
  });

  it("supports async plugins and rejects them on the sync path", async () => {
    const processor = createWikitextProcessor({ parser });
    processor.useHast(() => async (tree: Root) => {
      await Promise.resolve();
      tree.children.push({
        type: "element",
        tagName: "span",
        properties: {},
        children: [{ type: "text", value: "async" }],
      });
    });
    expect(() => processor.runSync("text")).toThrow(/runSync/u);
    const prepared = await processor.run("text");
    expect(JSON.stringify(prepared.hast)).toContain("async");
  });

  it("allows custom semantic nodes through handlers", () => {
    const processor = createWikitextProcessor({
      parser,
      handlers: {
        callout: () => ({
          type: "element",
          tagName: "span",
          properties: {},
          children: [{ type: "text", value: "handled" }],
        }),
      },
    });
    processor.useWikitext(() => (tree: WikitextRoot) => {
      (tree as unknown as { children: WikitextNode[] }).children.push({
        type: "callout",
        id: "callout",
        children: [{ type: "text", id: "callout-text", value: "note" }],
      } as unknown as WikitextNode);
    });
    const prepared = processor.runSync("x");
    expect(JSON.stringify(prepared.hast)).toContain("handled");
  });

  it("accepts empty plugin lists", () => {
    const processor = createWikitextProcessor({
      parser,
      wikitextPlugins: [],
      rehypePlugins: [],
    });
    expect(() => processor.runSync("x")).not.toThrow();
  });
});
