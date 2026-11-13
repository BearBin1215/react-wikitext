import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WikitextView } from "@/view";
import { prepare } from "../helpers/parse";

function attributeOf(html: string, tag: string, name: string): string | undefined {
  const pattern = new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`, "u");
  return pattern.exec(html)?.[1];
}

describe("source attributes", () => {
  it("omits all source attributes by default", () => {
    const html = renderToStaticMarkup(createElement(WikitextView, { snapshot: prepare("text") }));
    expect(html).not.toContain("data-wikitext-");
  });

  it("annotates block nodes and their direct source range", () => {
    const snapshot = prepare("== Head ==\n\nbody");
    const html = renderToStaticMarkup(
      createElement(WikitextView, { snapshot, sourceAttributes: "block" }),
    );
    expect(attributeOf(html, "h2", "data-wikitext-snapshot")).toBe(snapshot.id);
    expect(attributeOf(html, "h2", "data-wikitext-node")).toBeTruthy();
    expect(attributeOf(html, "h2", "data-wikitext-source")).toBe(snapshot.activeSourceId);
    expect(attributeOf(html, "h2", "data-wikitext-start")).toBe("0");
    // 标题范围包含 token 的尾部换行；断言它来自真实来源而不是固定长度。
    expect(Number(attributeOf(html, "h2", "data-wikitext-end"))).toBeGreaterThan(0);
  });

  it("leaves inline elements untouched in block mode", () => {
    const snapshot = prepare("'''strong''' text");
    const block = renderToStaticMarkup(
      createElement(WikitextView, { snapshot, sourceAttributes: "block" }),
    );
    expect(block).toContain("data-wikitext-node");
    expect(block.match(/data-wikitext-node/gu)?.length).toBe(1);
  });

  it("annotates every semantic element in all mode", () => {
    const snapshot = prepare("'''strong'''");
    const all = renderToStaticMarkup(
      createElement(WikitextView, { snapshot, sourceAttributes: "all" }),
    );
    const nodes = all.match(/data-wikitext-node/gu)?.length ?? 0;
    expect(nodes).toBeGreaterThan(1);
  });

  it("does not fabricate ranges for generated structures", () => {
    const snapshot = prepare("[[Category:Docs]]\ntext");
    const html = renderToStaticMarkup(
      createElement(WikitextView, { snapshot, sourceAttributes: "all" }),
    );
    // 分类页脚由库生成：只有快照与节点身份，没有源码范围。
    const toc = renderToStaticMarkup(
      createElement(WikitextView, {
        snapshot: prepare("== A ==\n\n== B ==\n\n== C ==\n\n== D =="),
        sourceAttributes: "all",
      }),
    );
    // 生成的目录容器没有语义节点，因此不输出任何源码定位属性。
    const tocTag = /<div\b[^>]*wikitext-toc[^>]*>/u.exec(toc)?.[0];
    expect(tocTag).toBeDefined();
    expect(tocTag).not.toContain("data-wikitext-node");

    // 分类项本身有真实来源，页脚容器没有。
    const footerTag = /<div\b[^>]*wikitext-categories\b[^>]*>/u.exec(html)?.[0];
    expect(footerTag).toBeDefined();
    expect(footerTag).not.toContain("data-wikitext-start=");
  });

  it("keeps the same snapshot identity for multiple instances", () => {
    const snapshot = prepare("== A ==");
    const first = renderToStaticMarkup(
      createElement(WikitextView, { snapshot, sourceAttributes: "block", idPrefix: "one-" }),
    );
    const second = renderToStaticMarkup(
      createElement(WikitextView, { snapshot, sourceAttributes: "block", idPrefix: "two-" }),
    );
    expect(attributeOf(first, "h2", "data-wikitext-snapshot")).toBe(snapshot.id);
    expect(attributeOf(second, "h2", "data-wikitext-snapshot")).toBe(snapshot.id);
    expect(first).toContain('id="one-A"');
    expect(second).toContain('id="two-A"');
  });
});
