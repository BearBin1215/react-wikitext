import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  prepareWikitext,
  restoreWikitextRenderSnapshot,
  serializeWikitextRenderSnapshot,
} from "@/hast";
import { WikitextFragment, WikitextView } from "@/view";
import { ZH_CONFIG } from "../helpers/configs";
import { parse, renderViewWithConfig } from "../helpers/parse";

function render(
  source: string,
  props: Parameters<typeof renderViewWithConfig>[2] = {},
  prepareOptions: Parameters<typeof renderViewWithConfig>[3] = {},
): string {
  return renderViewWithConfig(source, ZH_CONFIG, props, prepareOptions);
}

function listPart(html: string): string {
  const index = html.indexOf('class="mw-references-wrap wikitext-references');
  return index === -1 ? "" : html.slice(index);
}

function textOf(html: string): string {
  return new JSDOM(html).window.document.body.textContent ?? "";
}

describe("references", () => {
  it("numbers refs in document order and renders their content at the end", () => {
    const html = render(
      "a<ref>first [[L]]</ref>b<ref>second {{T}}</ref>",
      {},
      { resolveLink: () => ({ href: "/wiki/L" }) },
    );
    const list = listPart(html);
    expect(html).toContain('aria-label="Reference 1"');
    expect(html).toContain('href="#cite_note-1"');
    expect(html).toContain('href="#cite_note-2"');
    expect(html).toContain('title="first [[L]]"');
    expect(textOf(html)).toContain("[1]");
    expect(textOf(html)).toContain("[2]");
    expect(list).toContain('id="cite_note-1"');
    expect(list).toContain('id="cite_note-2"');
    expect(list).toContain('class="references wikitext-references__list"');
    expect(html).toContain('id="cite_ref-1"');
    expect(html).toContain('class="reference wikitext-ref"');
    expect(list).toContain('role="doc-endnotes"');
    expect(list).toContain('class="mw-references-wrap wikitext-references"');
    expect(list).toContain('class="mw-cite-backlink"');
    expect(list).toContain('class="reference-text"');
    expect(list.indexOf("first")).toBeLessThan(list.indexOf("second"));
    expect(list).toContain('href="/wiki/L"');
    expect(list).toContain("Template not expanded: T");
    expect(html.indexOf('class="mw-references-wrap wikitext-references')).toBeGreaterThan(
      html.indexOf("second"),
    );
  });

  it("reuses named refs and renders groups separately", () => {
    const html = render(
      '<ref name="a">x</ref><ref name="a"/><ref name="a">y</ref><ref group="g">z</ref>',
    );
    const dom = new JSDOM(html);
    expect(html.match(/class="wikitext-references__item"/gu)).toHaveLength(2);
    expect(dom.window.document.querySelectorAll(".wikitext-references")).toHaveLength(2);
    expect(html).toContain('data-wikitext-references="g"');
    expect(textOf(html)).toContain("[1]");
    expect(textOf(html)).toContain("[g 1]");
    expect(html.match(/href="#cite_note-a-1"/gu)).toHaveLength(3);
    expect(html).toContain('href="#cite_note-2"');
    expect(html).toContain('id="cite_note-a-1"');
    expect(html).toContain('id="cite_ref-a_1-0"');
    expect(html).toContain('id="cite_ref-a_1-1"');
    expect(html).not.toContain(">y<");
  });

  it("treats references tags as no-ops", () => {
    const html = render("a<ref>x</ref><references/>\n<references>ignored</references>");
    expect(html).not.toContain("Unsupported node");
    expect(html).not.toContain("ignored");
    expect(listPart(html).match(/class="wikitext-references__item"/gu)).toHaveLength(1);
  });

  it("omits the reference list when there are no refs", () => {
    const html = render("<references/>");
    expect(html).not.toContain("wikitext-references");
    expect(html).not.toContain("Unsupported node");
  });

  it("numbers self-closing refs and adds a backlink", () => {
    const html = render('<ref name="empty"/>');
    expect(textOf(html)).toContain("[1]");
    expect(listPart(html)).toContain('id="cite_note-empty-1"');
    expect(listPart(html)).toContain('role="doc-backlink"');
    expect(listPart(html)).toContain('class="mw-cite-backlink"');
    expect(listPart(html)).toContain('class="reference-text"');
  });

  it("passes the number to a custom reference component", () => {
    const html = render('<ref name="r">note</ref>', {
      semanticComponents: {
        reference: ({ node, number }) => <span data-reference={node.name} data-number={number} />,
      },
    });
    expect(html).toContain('data-reference="r"');
    expect(html).toContain('data-number="1"');
    expect(html).toContain('id="cite_note-r-1"');
  });

  it("uses labels for the accessible link name", () => {
    const html = render("<ref>x</ref>", {}, { labels: { reference: "引用" } });
    expect(html).toContain('aria-label="引用 1"');
  });

  it("maps note ids and links through the instance prefix", () => {
    const html = render("<ref>x</ref>", { idPrefix: "inst-" }, { headingIdStrategy: "instance" });
    expect(html).toContain('href="#inst-cite_note-1"');
    expect(html).toContain('id="inst-cite_note-1"');
  });

  it("renders block content inside reference notes", () => {
    const html = render("<ref>\n* a\n* b\n</ref>");
    const list = listPart(html);
    expect(list).toContain('class="wikitext-list wikitext-list--ul"');
    expect(list.match(/<li[^>]*class="wikitext-list__item"/gu)).toHaveLength(2);
    expect(html).not.toContain("Unsupported node");
  });

  it("adds the MediaWiki responsive columns class above ten entries", () => {
    const source = Array.from({ length: 11 }, (_, index) => `<ref>n${index}</ref>`).join("");
    const html = render(`a${source}`);
    expect(html).toContain("mw-references-columns");
    expect(html.match(/class="reference-text"/gu)).toHaveLength(11);
  });

  it("keeps distinct note ids across groups", () => {
    const html = render('<ref group="来源">a</ref><ref group="资料">b</ref>');
    const ids = [...html.matchAll(/id="(cite_note-[^"]+)"/gu)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(2);
  });

  it("ignores classes from source HTML when identifying reference structures", () => {
    const html = render(
      'a<ref>x</ref>\n<ol class="references wikitext-references__list"><li class="wikitext-references__item">fake</li></ol>',
    );
    expect(html.match(/id="cite_note-1"/gu)).toHaveLength(1);
  });

  it("keeps inline references markers out of paragraphs", () => {
    const html = render("a<ref>x</ref> b<references/> c");
    expect(html).not.toMatch(/<p[^>]*><div/u);
    expect(html).toContain("mw-references-wrap");
  });

  it("places the reference list at the references marker", () => {
    const html = render('a<ref name="n">x</ref>\n<references/>\nb<ref name="n"/>\n[[Category:C]]');
    expect(html).not.toContain("wikitext-references-placeholder");
    expect(html.indexOf("wikitext-categories")).toBeGreaterThan(
      html.indexOf("wikitext-references"),
    );
    expect(html).toContain('href="#cite_note-n-1"');
    expect(html).toContain('id="cite_ref-n_1-0"');
    expect(html).toContain('id="cite_ref-n_1-1"');
    expect(html).toContain('role="doc-backlink"');
  });

  it("restores reference ids after re-sanitizing", () => {
    const prepared = prepareWikitext(parse("<ref>x</ref>", { config: ZH_CONFIG }), {
      headingIdStrategy: "mediawiki",
    });
    const restored = restoreWikitextRenderSnapshot(serializeWikitextRenderSnapshot(prepared));
    const html = renderToStaticMarkup(<WikitextView snapshot={restored} />);
    expect(html).toContain('href="#cite_note-1"');
    expect(html).toContain('id="cite_note-1"');
  });

  it("lets WikitextFragment render ref content", () => {
    const document = prepareWikitext(parse("<ref>note [[L]]</ref>", { config: ZH_CONFIG }), {
      resolveLink: () => ({ href: "/wiki/L" }),
    });
    const html = renderToStaticMarkup(
      <WikitextView
        snapshot={document}
        idPrefix=""
        semanticComponents={{
          reference: ({ node }) => (
            <span data-fragment-ref="true">
              <WikitextFragment nodes={node.children} />
            </span>
          ),
        }}
      />,
    );
    expect(html).toContain('data-fragment-ref="true"');
    const fragment = /<span data-fragment-ref="true">([\s\S]*?)<\/span>/u.exec(html)?.[1] ?? "";
    expect(fragment).toContain("note");
    expect(fragment).toContain('href="/wiki/L"');
  });
});
