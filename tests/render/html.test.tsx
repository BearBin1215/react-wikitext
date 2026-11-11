import { describe, expect, it } from "vitest";
import type { ParserConfig } from "@/configs";
import { configWithHtmlTags } from "../helpers/configs";
import { renderView, renderViewWithConfig } from "../helpers/parse";

function render(source: string, config?: ParserConfig): string {
  return config ? renderViewWithConfig(source, config) : renderView(source);
}

describe("inline HTML pairing", () => {
  it("pairs inline tags into real elements", () => {
    const html = render("<b>bold</b> and <i>italic</i>");
    expect(html).toContain("<b>bold</b>");
    expect(html).toContain("<i>italic</i>");
  });

  it("auto-closes interleaved tags by nearest match", () => {
    const html = render("<b><i>x</b></i>");
    expect(html).toContain("<b><i>x</i></b>");
  });

  it("auto-closes unclosed inline tags at the block boundary", () => {
    const html = render("<b>unclosed");
    expect(html).toContain("<b>unclosed</b>");
  });

  it("renders void tags without children", () => {
    const html = render("a<br>b<wbr>c");
    expect(html).toContain("<br/>");
    expect(html).toContain("<wbr/>");
  });

  it("keeps whitelisted attributes and safe style declarations, drops events and ids", () => {
    const html = render(
      '<span class="a b" title="a&amp;b" dir="rtl" style="color:red;position:fixed;background-image:url(https://example.com/x.png)" onclick="x" id="q">x</span>',
    );
    expect(html).toContain('class="a b"');
    expect(html).toContain('title="a&amp;b"');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("color:red");
    expect(html).not.toContain("position");
    expect(html).not.toContain("url(");
    expect(html).not.toContain("onclick=");
    expect(html).not.toContain('id="q"');
    expect(html).toContain(">x</span>");
  });

  it("drops meta and link tags", () => {
    const html = render('<meta name="x"><link rel="stylesheet" href="x">text');
    expect(html).not.toContain("<meta");
    expect(html).not.toContain("<link");
    expect(html).toContain("text");
  });

  it("renders unknown configured tags as source cards instead of elements", () => {
    const html = render("<tt>code</tt>");
    expect(html).not.toContain("<tt>");
    expect(html).toContain("Unsupported node: html");
    expect(html).toContain("code");
  });
});

describe("block HTML pairing", () => {
  it("wraps blockquote text content in a paragraph like MediaWiki", () => {
    const html = render("<blockquote>quoted</blockquote>");
    expect(html).toContain('<blockquote class="wikitext-html-block wikitext-html-blockquote"');
    expect(html).toContain('<p class="wikitext-paragraph">quoted</p></blockquote>');
  });
  it("renders block div and nested paragraph without wrapping paragraphs twice", () => {
    const html = render('<div class="box"><p>para <b>b</b></p></div>');
    expect(html).toContain('<div class="wikitext-html-block wikitext-html-div box"');
    expect(html).toContain('<p class="wikitext-html-block wikitext-html-p"');
    expect(html).toContain("<b>b</b>");
    expect(html.match(/<p /gu)).toHaveLength(1);
  });

  it("renders block tables with rows and cells", () => {
    const html = render('<table><tr><td class="c">a</td><td>b</td></tr></table>');
    expect(html).toContain('<table class="wikitext-html-block wikitext-html-table"');
    expect(html).toContain('<tr class="wikitext-html-block wikitext-html-tr"');
    expect(html).toContain('<td class="wikitext-html-block wikitext-html-td c"');
    expect(html.match(/<td /gu)).toHaveLength(2);
  });

  it("auto-closes unclosed block HTML", () => {
    const html = render("<div>text");
    expect(html).toContain('<div class="wikitext-html-block wikitext-html-div"');
    expect(html).toContain("text");
  });

  it("closes unclosed block HTML at a blank line", () => {
    const html = render("before\n<div>one\n\ntwo");
    expect(html).toContain(
      '<div class="wikitext-html-block wikitext-html-div" data-node-id="0.1">one</div>',
    );
    expect(html).toContain('<p class="wikitext-paragraph">two</p>');
  });

  it("skips banned tag content and self-closing tags", () => {
    const config = configWithHtmlTags(["script"]);
    const html = render("== <script>leak</script>After ==\n\n== <script/>Tail ==", config);
    expect(html).not.toContain(">leak");
    expect(html).toContain("Blocked HTML: script");
    expect(html).toContain("After");
    expect(html).toContain("Tail");
  });

  it("keeps block HTML out of paragraphs", () => {
    const html = render("before\n<div>inside</div>\nafter");
    expect(html).toContain('<p class="wikitext-paragraph">before</p>');
    expect(html).toContain('<p class="wikitext-paragraph">after</p>');
    expect(html).not.toMatch(/<p[^>]*><div/gu);
  });

  it("drops banned tags as a pair when configured", () => {
    const config = configWithHtmlTags(["script", "iframe"]);
    const html = render('<script>alert(1)</script>\n<iframe src="x"></iframe>\nvisible', config);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
    expect(html).toContain("Blocked HTML: script");
    expect(html).toContain("Blocked HTML: iframe");
    expect(html).toContain("visible");
  });
});
