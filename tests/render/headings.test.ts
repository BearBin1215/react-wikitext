import { describe, expect, it } from "vitest";
import type { WikitextHeadingIdStrategy } from "@/ast/model";
import { prepare, renderView } from "../helpers/parse";

function headingIds(source: string, strategy: WikitextHeadingIdStrategy = "instance") {
  return prepare(source, { headingIdStrategy: strategy }).headings.map((heading) => heading.id);
}

describe("heading ids", () => {
  it("generates MediaWiki-style logical anchors", () => {
    expect(headingIds("== Hello world ==\n=== 中文 标题 ===")).toEqual([
      "Hello_world",
      "中文_标题",
    ]);
  });

  it("deduplicates repeated headings", () => {
    expect(headingIds("== Same ==\n== Same ==\n== Same ==")).toEqual(["Same", "Same_2", "Same_3"]);
  });

  it("deduplicates heading ids case-insensitively", () => {
    expect(headingIds("== A ==\n== a ==")).toEqual(["A", "a_2"]);
  });

  it("collects raw HTML headings and renders them as headings", () => {
    expect(headingIds("<h2>HTML</h2>\n\n== Wiki ==")).toEqual(["HTML", "Wiki"]);
    const html = renderView("<h2>HTML</h2>");
    expect(html).toContain('class="wikitext-html-block wikitext-html-h2 wikitext-heading"');
    expect(html).toContain('id="HTML"');
  });

  it("strips link and quote markup from ids", () => {
    expect(headingIds("== [[Target|Label]] '''bold''' ==")).toEqual(["Label_bold"]);
  });

  it("falls back to section numbers for empty headings", () => {
    expect(headingIds("== ==\n== ==")).toEqual(["section-1", "section-2"]);
  });

  it("supports the none strategy", () => {
    const headings = prepare("== A ==", { headingIdStrategy: "none" }).headings;
    expect(headings[0]?.id).toBeUndefined();
    expect(headings[0]?.text).toBe("A");
    expect(headings[0]?.level).toBe(2);
  });

  it("escapes fragment-sensitive characters in heading ids", () => {
    expect(headingIds("== A#B ==\n== 50% ==\n== Q? ==\n== A/B ==")).toEqual([
      "A.23B",
      "50.25",
      "Q.3F",
      "A.2FB",
    ]);
    expect(renderView("__TOC__\n\n== A#B ==\n== B ==")).toContain('href="#A.23B"');
  });
});
