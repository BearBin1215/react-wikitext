import { describe, expect, it } from "vitest";
import { renderView as render } from "../helpers/parse";

describe("tables", () => {
  it("renders caption, implicit header row, and explicit rows", () => {
    const html = render('{| class="wikitable"\n|+ Caption\n! H1 !! H2\n|-\n| a || b\n|}');
    expect(html).toContain('<table class="wikitext-table wikitable"');
    expect(html).toContain('<caption class="wikitext-table__caption">Caption</caption>');
    expect(html.match(/<tr class="wikitext-table__row">/gu)).toHaveLength(2);
    expect(html).toContain('<th class="wikitext-table__cell" scope="col">H1</th>');
    expect(html).toContain('<td class="wikitext-table__cell">a</td>');
  });

  it("renders a bare table with a classed tbody", () => {
    const html = render("{|\n| a\n|}");
    expect(html).toContain('<table class="wikitext-table"');
    expect(html).toContain('<tbody class="wikitext-table__body">');
  });

  it("sanitizes table and cell attributes", () => {
    const html = render(
      '{|\n|-\n! scope="col" colspan="2" | H\n|-\n| style="color:red" class="cell" | a\n|}',
    );
    expect(html).toContain('scope="col"');
    expect(html).toMatch(/colspan="2"/iu);
    expect(html).toContain('class="wikitext-table__cell cell"');
    expect(html).toContain("color:red");
  });

  it("preserves MediaWiki-compatible layout attributes", () => {
    const html = render(
      '{| border="1" align="center" cellpadding="2" cellspacing="3"\n|-\n| align="right" valign="top" bgcolor="#eee" width="10" nowrap data-sort-value="v" colspan="2" | x\n|}',
    );
    expect(html).toContain('border="1"');
    expect(html).toContain('align="center"');
    expect(html).toMatch(/cellpadding="2"/iu);
    expect(html).toMatch(/cellspacing="3"/iu);
    expect(html).toContain('align="right"');
    expect(html).toContain('valign="top"');
    expect(html).toContain('bgcolor="#eee"');
    expect(html).toContain('width="10"');
    expect(html).toContain('nowrap=""');
    expect(html).toContain('data-sort-value="v"');
  });

  it("renders inline content inside cells", () => {
    const html = render("{|\n|-\n| [[A|label]]\n|}");
    expect(html).toContain('<td class="wikitext-table__cell">');
    expect(html).toContain('<span class="wikitext-link" title="A"');
    expect(html).toContain("label");
  });

  it("keeps multiple cells on one line separate", () => {
    const html = render("{|\n|-\n| a || b || c\n|}");
    expect(html.match(/<td /gu)).toHaveLength(3);
  });

  it("does not copy cell attributes onto implicit rows", () => {
    const html = render('{|\n! scope="col" | H\n|-\n| a\n|}');
    expect(html).not.toMatch(/<tr[^>]*scope=/u);
    expect(html).toContain('scope="col"');
  });

  it("promotes captions found inside a row", () => {
    const html = render("{|\n|-\n| a\n|+ cap\n|}");
    expect(html).toContain('<caption class="wikitext-table__caption">cap</caption>');
    expect(html).not.toContain(">cap</td>");
  });

  it("renders block content inside cells", () => {
    const html = render("{|\n| cell\n* item\n* item2\n|}");
    expect(html).toContain('<p class="wikitext-paragraph">cell</p>');
    expect(html).toContain('<ul class="wikitext-list wikitext-list--ul">');
    expect(html.match(/<li /gu)).toHaveLength(2);
    expect(html).not.toContain("* item");
  });

  it("does not let a cell list consume the next cell", () => {
    const html = render("{|\n| list\n* a\n| b\n|}");
    expect(html.match(/<li /gu)).toHaveLength(1);
    expect(html).toContain('<td class="wikitext-table__cell">b</td>');
  });

  it("degrades parser-flattened nested tables without inventing structure", () => {
    const html = render("{|\n| a\n| {|\n| inner\n|}\n|}");
    expect(html).toContain("Nested table not supported");
    expect(html).not.toContain('<table class="wikitext-table"');
    expect(html).toContain("| inner");
  });

  it("renders nested HTML tables", () => {
    const html = render("<table><tr><td><table><tr><td>inner</td></tr></table></td></tr></table>");
    expect(html.match(/<table class="wikitext-html-block wikitext-html-table"/gu)).toHaveLength(2);
    expect(html).toContain("inner");
  });

  it("pads ragged rows with filler cells", () => {
    const html = render("{|\n| A\n|-\n| B || C\n|}");
    expect(html).toContain(
      '<td class="wikitext-table__cell">A</td><td class="wikitext-table__cell wikitext-table__cell--filler"></td>',
    );
    expect(html.match(/wikitext-table__cell--filler/gu)).toHaveLength(1);
  });

  it("clamps rowspan to the remaining rows", () => {
    const html = render('{|\n| rowspan="5" | A || B\n|-\n| C\n|}');
    expect(html).toMatch(/rowspan="2"/iu);
    expect(html).not.toMatch(/rowspan="5"/iu);
    expect(html).not.toContain("wikitext-table__cell--filler");
  });

  it("clamps colspan to the free run before an occupied column", () => {
    const html = render(
      '{|\n| rowspan="2" | A\n| rowspan="2" | B\n| C\n| rowspan="3" | D\n|-\n| colspan="3" | X\n|}',
    );
    expect(html).toMatch(/colspan="1"/iu);
    expect(html).not.toMatch(/colspan="3"/iu);
    expect(html).toMatch(/rowspan="2"/iu);
    expect(html).not.toContain("wikitext-table__cell--filler");
  });

  it("keeps a spanned table rectangular without adding gaps", () => {
    const html = render(
      '{|\n! colspan="6" | Shopping\n|-\n| rowspan="2" | A || B || C || D || colspan="2" | E\n|-\n| F || colspan="2" | G || H || I\n|}',
    );
    expect(html).toMatch(/colspan="6"/iu);
    expect(html).toMatch(/rowspan="2"/iu);
    expect(html).not.toContain("wikitext-table__cell--filler");
  });

  it("fills free columns around a rowspan from an earlier row", () => {
    const html = render('{|\n| A || X || rowspan="2" | B\n|-\n| C\n|}');
    expect(html).toContain(
      '<td class="wikitext-table__cell">C</td><td class="wikitext-table__cell wikitext-table__cell--filler"></td>',
    );
  });

  it("pads ragged HTML table rows", () => {
    const html = render("<table><tr><td>A</td></tr><tr><td>B</td><td>C</td></tr></table>");
    expect(html).toContain('<td class="wikitext-table__cell--filler"></td>');
    expect(html.match(/wikitext-table__cell--filler/gu)).toHaveLength(1);
  });
});
