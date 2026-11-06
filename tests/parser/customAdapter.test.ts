import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  type WikitextParserAdapter,
  type WikitextPoint,
  type WikitextPrimitive,
  type WikitextSyntaxNode,
  type WikitextSyntaxRoot,
} from "@/ast";

/**
 * 有限语法 adapter：只识别 `== 标题 ==`、`[[目标|标签]]` 与普通段落。
 * 语法树使用 LF 源码的 UTF-16 range，position 与 range 必须一致。
 */
function createLimitedAdapter(): WikitextParserAdapter {
  let source = "";
  let nextId = 0;
  const point = (offset: number): WikitextPoint => {
    const before = source.slice(0, offset);
    const lastBreak = before.lastIndexOf("\n");
    return {
      line: before.split("\n").length,
      column: offset - lastBreak,
      offset,
    };
  };
  const node = (
    type: string,
    start: number,
    end: number,
    children: WikitextSyntaxNode[] = [],
    props: Record<string, WikitextPrimitive> = {},
  ): WikitextSyntaxNode => ({
    id: String(nextId++),
    type,
    range: [start, end],
    position: { start: point(start), end: point(end) },
    props,
    attributes: [],
    children,
  });
  const text = (start: number, end: number): WikitextSyntaxNode =>
    node("text", start, end, [], { data: source.slice(start, end) });

  const inline = (start: number, end: number): WikitextSyntaxNode[] => {
    const slice = source.slice(start, end);
    const children: WikitextSyntaxNode[] = [];
    let cursor = 0;
    const pattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(slice))) {
      if (match.index > cursor) {
        children.push(text(start + cursor, start + match.index));
      }
      const linkStart = start + match.index;
      const targetStart = linkStart + 2;
      const targetEnd = targetStart + match[1]!.length;
      const textStart = targetEnd + 1;
      children.push(
        node(
          "link",
          linkStart,
          linkStart + match[0].length,
          [
            node("link-target", targetStart, targetEnd, [text(targetStart, targetEnd)]),
            ...(match[2] === undefined
              ? []
              : [
                  node("link-text", textStart, textStart + match[2].length, [
                    text(textStart, textStart + match[2].length),
                  ]),
                ]),
          ],
          { target: match[1]! },
        ),
      );
      cursor = match.index + match[0].length;
    }
    if (cursor < slice.length) {
      children.push(text(start + cursor, end));
    }
    return children;
  };

  return {
    name: "limited-wikitext",
    version: "1.0.0",
    parse(input) {
      source = input;
      nextId = 0;
      const children: WikitextSyntaxNode[] = [];
      let paragraphStart = -1;
      let offset = 0;
      const flushParagraph = (end: number): void => {
        if (paragraphStart >= 0) {
          children.push(...inline(paragraphStart, end));
          paragraphStart = -1;
        }
      };
      for (const line of source.split("\n")) {
        const lineStart = offset;
        const lineEnd = offset + line.length;
        const heading = /^(={1,6})\s*(.*?)\s*\1\s*$/u.exec(line);
        if (heading) {
          flushParagraph(lineStart);
          const titleStart = lineStart + heading[1]!.length;
          const title = heading[2] ?? "";
          const leading = /^\s*/u.exec(source.slice(titleStart))?.[0].length ?? 0;
          const start = titleStart + leading;
          children.push(
            node(
              "heading",
              lineStart,
              lineEnd,
              [
                node("heading-title", start, start + title.length, [
                  text(start, start + title.length),
                ]),
              ],
              { level: heading[1]!.length },
            ),
          );
        } else if (line.trim() === "") {
          // 段落 token 覆盖末尾空行，让归一化按 "\\n\\n" 切分段落。
          flushParagraph(lineEnd + 1);
        } else if (paragraphStart < 0) {
          paragraphStart = lineStart;
        }
        offset = lineEnd + 1;
      }
      flushParagraph(source.length);
      return node("root", 0, source.length, children) as WikitextSyntaxRoot;
    },
  };
}

const SOURCE = [
  "== Demo ==",
  "",
  "Plain [[Target page|label]] text.",
  "",
  "Second paragraph.",
].join("\n");

describe("custom adapter integration", () => {
  it("runs parse → prepare → view through /ast without the default parser", async () => {
    const original = (globalThis as { Parser?: unknown }).Parser;
    (globalThis as { Parser?: unknown }).Parser = undefined;
    vi.resetModules();
    try {
      const ast = await import("@/ast");
      const hast = await import("@/hast");
      const view = await import("@/view");
      const parser = ast.createWikitextParser(createLimitedAdapter());
      const document = parser.parse(SOURCE, { pageName: "Adapter demo" });
      expect(document.meta.parser).toBe("limited-wikitext");
      expect(document.meta.parserVersion).toBe("1.0.0");
      expect(document.ast.children.map((child) => child.type)).toEqual([
        "heading",
        "paragraph",
        "paragraph",
      ]);
      const prepared = hast.prepareWikitext(document);
      const html = renderToStaticMarkup(createElement(view.WikitextView, { document: prepared }));
      expect(html).toContain("<h2");
      expect(html).toContain("Demo");
      expect(html).toContain('class="wikitext-link"');
      expect(html).toContain("label");
      expect((globalThis as { Parser?: unknown }).Parser).toBeUndefined();
    } finally {
      vi.resetModules();
      if (original !== undefined) {
        (globalThis as { Parser?: unknown }).Parser = original;
      }
    }
  });
});
