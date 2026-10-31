import { describe, expect, it } from "vitest";
import { configWithHtmlTags } from "../helpers/configs";
import { renderView as render, renderViewWithConfig } from "../helpers/parse";

describe("lists", () => {
  it("renders nested unordered and ordered lists with inline content", () => {
    const html = render("* a [[L]]\n** b\n*# c\n* d");
    expect(html).toContain('<ul class="wtr-list wtr-list--ul">');
    expect(html).toContain('<ol class="wtr-list wtr-list--ol">');
    expect(html).toContain("wtr-link");
    expect(html.match(/<li /gu)).toHaveLength(4);
    expect(html).not.toContain("* a");
  });

  it("attaches continuation lines to the current item", () => {
    const html = render("* first\ncontinued here\n* second");
    expect(html).toContain("first continued here");
    expect(html.match(/<li /gu)).toHaveLength(2);
  });

  it("renders definition lists and splits term from definition", () => {
    const html = render("; term : def\n: indented");
    expect(html).toContain('<dl class="wtr-list wtr-list--dl">');
    expect(html).toContain('<dt class="wtr-list__item">term</dt>');
    expect(html).toContain('<dd class="wtr-list__item">def</dd>');
    expect(html).toContain('<dd class="wtr-list__item">indented</dd>');
  });

  it("splits definition terms at a top-level colon without requiring spaces", () => {
    const html = render(";name:Definition");
    expect(html).toContain('<dt class="wtr-list__item">name</dt>');
    expect(html).toContain('<dd class="wtr-list__item">Definition</dd>');
    expect(html).not.toContain("nameDefinition");
  });

  it("ignores definition colons inside URLs and HTML attributes", () => {
    const html = render(';http://example.com/ :definition\n\n; <span title="a:b">x</span> : def');
    expect(html).toContain('href="http://example.com/"');
    expect(html).toContain('<dd class="wtr-list__item">definition</dd>');
    expect(html).toContain('<span title="a:b">x</span>');
    expect(html).toContain('<dd class="wtr-list__item">def</dd>');
  });

  it("ends a list at a blank line and keeps the rest of the text token", () => {
    const html = render("* item\n\nparagraph\n\nsecond paragraph");
    expect(html.match(/<li /gu)).toHaveLength(1);
    expect(html).toContain('<p class="wtr-paragraph">paragraph</p>');
    expect(html).toContain('<p class="wtr-paragraph">second paragraph</p>');
  });

  it("ends a list at a heading", () => {
    const html = render("* item\n== Heading ==\ntext");
    expect(html).toContain('<h2 class="wtr-heading"');
    expect(html).toContain("Heading");
  });

  it("renders nested lists inside the previous item", () => {
    const html = render("* parent\n** child");
    expect(html.indexOf('<li class="wtr-list__item">parent')).toBeGreaterThan(-1);
    expect(
      html.indexOf('<ul class="wtr-list wtr-list--ul"><li class="wtr-list__item">child</li></ul>'),
    ).toBeGreaterThan(html.indexOf("parent"));
  });

  it("ignores definition colons inside link text", () => {
    const html = render("; [[A : B|term]] : def");
    expect(html.match(/title="A : B"/gu)).toHaveLength(1);
    expect(html).toContain('<dd class="wtr-list__item">def</dd>');
  });

  it("renders mixed nested lists and definition lists", () => {
    const html = render("; term : def\n: indent\n; term2\n: def2\n* a\n*# b\n*; term3 : def3");
    expect(html).toContain('<dl class="wtr-list wtr-list--dl">');
    expect(html).toContain('<dt class="wtr-list__item">term</dt>');
    expect(html).toContain('<dd class="wtr-list__item">def</dd>');
    expect(html).toContain('<dd class="wtr-list__item">def2</dd>');
    expect(html).toContain('<ol class="wtr-list wtr-list--ol">');
    expect(html).toContain('<dd class="wtr-list__item">def3</dd>');
    expect(html).not.toContain("*; term3");
  });

  it("ends a list before a table and keeps the table", () => {
    const html = render("* item\n{|\n| a\n|}");
    expect(html).toContain('<ul class="wtr-list wtr-list--ul">');
    expect(html).toContain('<table class="wtr-table"');
    expect(html).not.toContain("* item");
  });

  it("renders unclassifiable lines after a list as paragraphs", () => {
    const html = render("* item\n| stray");
    expect(html).toContain('<li class="wtr-list__item">item</li>');
    expect(html).toContain('<p class="wtr-paragraph">| stray</p>');
  });
});

describe("list item block HTML", () => {
  const scriptConfig = configWithHtmlTags(["script"]);

  it("renders same-line block HTML inside a list item", () => {
    const html = render("* item <div>block</div> tail");
    expect(html).toMatch(
      /item <div class="wtr-html-block wtr-html-div"[^>]*>block<\/div> tail<\/li>/u,
    );
    expect(html).not.toContain("wtr-unknown");
  });

  it("renders same-line HTML tables inside a list item", () => {
    const html = render("* item <table><tr><td>a</td><td>b</td></tr></table> tail\n* next");
    expect(html).toContain('<table class="wtr-html-block wtr-html-table"');
    expect(html.match(/<td /gu)).toHaveLength(2);
    expect(html.match(/<li /gu)).toHaveLength(2);
    expect(html).not.toContain("wtr-unknown");
  });

  it("keeps nested inline HTML inside the block child", () => {
    const html = render("* item <div><span>x</span></div>");
    expect(html).toMatch(/<div class="wtr-html-block wtr-html-div"[^>]*><span>x<\/span><\/div>/u);
    expect(html).not.toContain("wtr-unknown");
  });

  it("supports block HTML on a continuation line", () => {
    const html = render("* first\nsecond <div>block</div>");
    expect(html).toContain("first second");
    expect(html).toMatch(/<div class="wtr-html-block wtr-html-div"[^>]*>block<\/div>/u);
  });

  it("keeps multi-line block HTML unsupported in list items", () => {
    const html = render("* item <div>\ntext</div>");
    expect(html).toContain("Unsupported node: html");
    expect(html).not.toContain("wtr-html-div");
  });

  it("does not let block HTML escape an unclosed banned tag", () => {
    const html = renderViewWithConfig("* a <script>secret <div>x</div>", scriptConfig);
    expect(html).toContain("Blocked HTML: script");
    expect(html).not.toContain("secret");
    expect(html).not.toContain("wtr-html-div");
  });

  it("keeps banned suppression across continuation lines", () => {
    const html = renderViewWithConfig("* a <script>\nsecret <div>x</div>", scriptConfig);
    expect(html).toContain("Blocked HTML: script");
    expect(html).not.toContain("secret");
    expect(html).not.toContain("wtr-html-div");
  });

  it("renders block HTML after a closed banned tag", () => {
    const html = renderViewWithConfig("* a <script>x</script> <div>ok</div>", scriptConfig);
    expect(html).toContain("Blocked HTML: script");
    expect(html).not.toContain(">x<");
    expect(html).toMatch(/<div class="wtr-html-block wtr-html-div"[^>]*>ok<\/div>/u);
  });

  it("keeps preformatted HTML on a list line", () => {
    const html = render("* item <pre>raw  x</pre>");
    expect(html).toContain('<pre class="wtr-ext-pre"');
    expect(html).toContain("raw  x");
  });
});
