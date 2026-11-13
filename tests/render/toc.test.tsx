import { renderToStaticMarkup } from "react-dom/server";
import type { Root } from "hast";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  prepareWikitext,
  restoreWikitextRenderSnapshot,
  serializeWikitextRenderSnapshot,
} from "@/hast";
import { WikitextView } from "@/view";
import { parse, prepare, renderView } from "../helpers/parse";

const FOUR_HEADINGS = "== A ==\n=== A1 ===\n== B ==\n== C ==";

function tocOf(html: string): string {
  const dom = new JSDOM(html);
  return dom.window.document.querySelector(".wikitext-toc")?.outerHTML ?? "";
}

describe("table of contents", () => {
  it("auto-generates a nested TOC for four or more headings", () => {
    const html = renderView(FOUR_HEADINGS);
    const toc = tocOf(html);
    expect(toc).not.toBe("");
    expect(toc).toContain("Contents");
    expect(toc).toContain('href="#A"');
    expect(toc).toContain('href="#A1"');
    expect(toc).toContain('href="#B"');
    expect(toc).toContain('href="#C"');
    expect(toc).toContain('role="list"');
    expect(toc).toContain("toclevel-1");
    expect(toc).toContain("toclevel-2");
    expect(toc).toContain('class="tocnumber wikitext-toc__number">1</span>');
    expect(toc).toContain('class="tocnumber wikitext-toc__number">1.1</span>');
    expect(html.indexOf('class="toc wikitext-toc"')).toBeLessThan(html.indexOf('id="A"'));
  });

  it("keeps a TOC when __TOC__ sits inside another element", () => {
    const sources = [
      `<div>__TOC__</div>\n\n${FOUR_HEADINGS}`,
      `* item __TOC__\n\n${FOUR_HEADINGS}`,
      `'''a __TOC__ b'''\n\n${FOUR_HEADINGS}`,
    ];
    for (const source of sources) {
      const html = renderView(source);
      expect(html.match(/class="toc wikitext-toc"/gu)).toHaveLength(1);
      expect(html).toContain('href="#A"');
    }
  });

  it("generates an automatic TOC for headings wrapped in a block element", () => {
    const html = renderView(`<div>\n== A ==\n</div>\n=== B ===\n== C ==\n== D ==`);
    expect(html.match(/class="toc wikitext-toc"/gu)).toHaveLength(1);
    expect(html).toContain('href="#A"');
  });

  it("does not auto-generate a TOC below the heading threshold", () => {
    expect(renderView("== A ==\n== B ==\n== C ==")).not.toContain("wikitext-toc");
  });

  it("places an explicit TOC at its source position", () => {
    const html = renderView("lead\n\n__TOC__\n\n== A ==\n== B ==");
    expect(html).toContain('class="toc wikitext-toc"');
    expect(html.indexOf("lead")).toBeLessThan(html.indexOf('class="toc wikitext-toc"'));
    expect(html.indexOf('class="toc wikitext-toc"')).toBeLessThan(html.indexOf('id="A"'));
  });

  it("lets __NOTOC__ suppress automatic and explicit TOCs", () => {
    expect(renderView(`${FOUR_HEADINGS}\n\n__NOTOC__`)).not.toContain("wikitext-toc");
    expect(renderView(`__TOC__\n\n${FOUR_HEADINGS}\n\n__NOTOC__`)).not.toContain("wikitext-toc");
  });

  it("ignores magic words inside unexpanded templates", () => {
    expect(renderView("{{T|__TOC__|__NOTOC__}}\n\n== A ==\n== B ==")).not.toContain("wikitext-toc");
  });

  it("does not treat source data attributes as TOC markers", () => {
    const html = renderView('<table data-wikitext-toc="toc"><tr><td>x</td></tr></table>');
    expect(html).toContain("wikitext-html-table");
    expect(html).not.toContain("wikitext-toc");
  });

  it("uses the MediaWiki 1.43 TOC container and toggle markup", () => {
    const html = renderView(FOUR_HEADINGS);
    expect(html).toContain(
      'id="toc" class="toc wikitext-toc" role="navigation" aria-labelledby="mw-toc-heading"',
    );
    expect(html).toContain('id="toctogglecheckbox" class="toctogglecheckbox"');
    expect(html).toContain('<div class="toctitle wikitext-toc__title">');
    expect(html).toContain('<h2 id="mw-toc-heading">Contents</h2>');
    expect(html).toContain('<span class="toctogglespan">');
    expect(html).toContain('class="toctogglelabel"');
    expect(html).toContain('for="toctogglecheckbox"');
    expect(html).toContain('data-hide="hide"');
    expect(html).toContain('data-show="show"');
    expect(html).toContain('aria-label="Toggle table of contents"');
  });

  it("maps the TOC controls and labelledby through the instance prefix", () => {
    const html = renderView(
      "__TOC__\n\n== A ==\n== B ==",
      { idPrefix: "inst-" },
      { headingIdStrategy: "instance" },
    );
    expect(html).toContain('id="inst-toc"');
    expect(html).toContain('aria-labelledby="inst-mw-toc-heading"');
    expect(html).toContain('id="inst-mw-toc-heading"');
    expect(html).toContain('id="inst-toctogglecheckbox"');
    expect(html).toContain('for="inst-toctogglecheckbox"');
  });

  it("maps TOC links through the instance prefix", () => {
    const html = renderView(
      "__TOC__\n\n== A ==\n== B ==",
      { idPrefix: "inst-" },
      { headingIdStrategy: "instance" },
    );
    expect(html).toContain('href="#inst-A"');
    expect(html).toContain('id="inst-A"');
  });

  it("renders plain TOC labels when heading ids are disabled", () => {
    const html = renderView("__TOC__\n\n== A ==\n== B ==", {}, { headingIdStrategy: "none" });
    const toc = tocOf(html);
    expect(toc).toContain('class="wikitext-toc__link"');
    expect(toc).not.toContain("<a");
  });

  it("keeps a TOC after serializing and restoring the render document", () => {
    const prepared = prepare(FOUR_HEADINGS, { headingIdStrategy: "mediawiki" });
    const restored = restoreWikitextRenderSnapshot(serializeWikitextRenderSnapshot(prepared));
    const html = renderToStaticMarkup(<WikitextView snapshot={restored} />);
    expect(html.match(/class="toc wikitext-toc"/gu)).toHaveLength(1);
    expect(html).toContain('href="#A"');
    expect(restored.headings).toEqual(prepared.headings);
    expect(html).toContain('<h2 id="mw-toc-heading">Contents</h2>');
    expect(html).not.toContain('<h2 id="mw-toc-heading"><span class="mw-headline"');
  });

  it("keeps the configured columns after restoring a snapshot", () => {
    const prepared = prepare(FOUR_HEADINGS, {
      headingIdStrategy: "mediawiki",
      toc: { columns: 3 },
    });
    const restored = restoreWikitextRenderSnapshot(serializeWikitextRenderSnapshot(prepared));
    const html = renderToStaticMarkup(<WikitextView snapshot={restored} />);
    expect(html).toContain("wikitext-toc--columns-3");
  });

  it("honors the toc option for thresholds, columns and disabling", () => {
    expect(renderView(FOUR_HEADINGS)).toContain("wikitext-toc");
    expect(renderView(FOUR_HEADINGS, {}, { toc: { minHeadings: 5 } })).not.toContain(
      "wikitext-toc",
    );
    expect(renderView("== A ==\n== B ==", {}, { toc: { minHeadings: 2 } })).toContain(
      "wikitext-toc",
    );
    expect(renderView(FOUR_HEADINGS, {}, { toc: { columns: 3 } })).toContain(
      "wikitext-toc--columns-3",
    );
    expect(renderView(`__TOC__\n\n${FOUR_HEADINGS}`, {}, { toc: false })).not.toContain(
      "wikitext-toc",
    );
  });

  it("supports __FORCETOC__ without the default threshold", () => {
    expect(renderView("== A ==\n== B ==\n__FORCETOC__")).toContain("wikitext-toc");
  });

  it("uses the final heading list for the automatic TOC threshold", () => {
    const document = prepareWikitext(parse("== A ==\n== B =="), {
      headingIdStrategy: "mediawiki",
      rehypePlugins: [
        () => (tree: Root) => {
          for (const text of ["C", "D"]) {
            tree.children.push({
              type: "element",
              tagName: "h2",
              properties: { className: ["wikitext-heading"] },
              children: [{ type: "text", value: text }],
            });
          }
        },
      ],
    });
    const html = renderToStaticMarkup(<WikitextView snapshot={document} />);
    expect(html).toContain("wikitext-toc");
    expect(html).toContain('href="#C"');
    expect(html).toContain('href="#D"');
  });
});
