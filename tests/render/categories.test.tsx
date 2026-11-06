import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { restoreWikitextRenderDocument, serializeWikitextRenderDocument } from "@/hast";
import { WikitextView } from "@/view";
import { prepare, renderView } from "../helpers/parse";

function categoryFooter(html: string): string {
  const start = html.indexOf('class="catlinks wikitext-categories"');
  return start < 0 ? "" : html.slice(start);
}

describe("category footer", () => {
  it("renders categories at the bottom without entering the body", () => {
    const html = renderView(
      "before [[Category:Alpha]] after\n[[Category:Beta|Sort key]]\n[[分类:中文]]",
    );
    const footer = categoryFooter(html);
    expect(footer).not.toBe("");
    expect(footer).toContain("Categories:");
    expect(footer).toContain('title="Category:Alpha"');
    expect(footer).toContain('title="Category:Beta"');
    expect(footer).toContain('title="Category:中文"');
    expect(footer).toContain(">Alpha<");
    expect(footer).toContain(">Beta<");
    expect(footer).toContain(">中文<");
    expect(footer).not.toContain("Sort key");
    const dom = new JSDOM(html);
    const paragraph = dom.window.document.querySelector("p.wikitext-paragraph");
    expect(paragraph?.textContent).toContain("before");
    expect(paragraph?.textContent).toContain("after");
    expect(dom.window.document.querySelectorAll(".wikitext-categories__item")).toHaveLength(3);
  });

  it("does not render categories from unexpanded template parameters", () => {
    const html = renderView("{{T|[[Category:Hidden]]}}");
    expect(html).not.toContain("catlinks");
  });

  it("uses labels for the footer heading", () => {
    const html = renderView("[[Category:Alpha]]", {}, { labels: { categories: "分类" } });
    expect(html).toContain("分类:");
  });

  it("keeps the footer after serializing and restoring the render document", () => {
    const prepared = prepare("[[Category:Alpha]]");
    const restored = restoreWikitextRenderDocument(serializeWikitextRenderDocument(prepared));
    const html = renderToStaticMarkup(<WikitextView document={restored} idPrefix="" />);
    expect(categoryFooter(html)).toContain('title="Category:Alpha"');
  });
});
