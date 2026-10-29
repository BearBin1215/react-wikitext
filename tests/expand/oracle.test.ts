import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { MEDIAWIKI_CONFIG } from "@/configs";
import { normalizeConfig } from "@/configs/config";
import { expandWikitext } from "@/expand";

interface NodeParser {
  templates: Map<string, string>;
  parse(
    source: string,
    include: boolean,
    maxStage: number,
    config: unknown,
    page: string,
  ): { expand(): { toString(): string } };
}

const require = createRequire(import.meta.url);
const Parser = (require("wikiparser-node") as { default: NodeParser }).default;

const TEMPLATES: Record<string, string> = {
  "Template:Echo": "{{{1}}}",
  "Template:Outer": "[{{{p}}}]",
  "Template:Inner": "inner({{{1|}}})",
  "Template:List": "* item",
  "Template:Default": "{{{x|fallback}}}",
  "Template:Head": "==H==",
  "Template:ArgBody": "x{{{1}}}",
  "Template:Two": "[{{{1}}}] [{{{b}}}]",
  "Template:Mixed": "<includeonly>a<noinclude>b</noinclude>c</includeonly>",
  "Template:OpenNoinclude": "a<noinclude>b",
  "Template:NestedNoinclude": "a<noinclude>b<noinclude>c</noinclude>d</noinclude>e",
  "Template:OnlyInNoinclude": "a<noinclude>b<onlyinclude>c</onlyinclude>d</noinclude>e",
  "Template:SpaceTag": "a< noinclude>b",
  "Template:InvalidClose": "a<noinclude>x</noinclude/>b",
  "Template:NestedOnly": "<onlyinclude>x<onlyinclude>y</onlyinclude>z</onlyinclude>",
  "Template:MultipleOnly": "<onlyinclude>a</onlyinclude>x<onlyinclude>b</onlyinclude>",
};

function oracleExpand(source: string): string {
  return Parser.parse(source, false, 11, normalizeConfig(MEDIAWIKI_CONFIG), "Demo")
    .expand()
    .toString();
}

afterEach(() => {
  Parser.templates.clear();
});

describe("upstream expansion oracle", () => {
  it("matches on fixtures with agreed semantics", async () => {
    for (const [title, source] of Object.entries(TEMPLATES)) {
      Parser.templates.set(title, source);
    }
    const fixtures = [
      "{{Echo|a}}",
      "{{Echo|a{{!}}b}}",
      "{{Echo|first|1=second}}",
      "{{Echo|1=first|second}}",
      "prefix{{List}}",
      "line\n{{List}}",
      "{{Outer|p={{Inner|x}}}}",
      "{{Default}}",
      "{{Default|x=}}",
      "{{Default|x=1}}",
      "{{#if:1|ok|no}}",
      "{{#if: |a|b}}",
      "{{#if:&nbsp;|a|b}}",
      "{{#if:&#32;|a|b}}",
      "{{#if:<nowiki></nowiki>|a|b}}",
      "{{#ifeq:01|1|y|n}}",
      "{{#iferror:fine|err|ok}}",
      "{{#iferror:fine|err}}",
      '{{#iferror:<nowiki><span class="error">x</span></nowiki>|err|ok}}',
      "{{#switch:a|a|b|c}}",
      "{{#switch:a|a|b|c=C}}",
      "{{#switch:a|a|b|#default=d}}",
      "{{#switch:x|a|b}}",
      "{{#switch:a|a}}",
      "{{#switch:a|a|{{Missing}}=b}}",
      "{{#switch:x|{{Missing}}|y}}",
      "{{#switch:x|{{Missing}}|#default|d}}",
      "{{#iferror:x<nowiki>y</nowiki>}}",
      "{{#iferror:<nowiki>x</nowiki>}}",
      "{{Two|1=v|{{Missing}}=x}}",
      "{{Mixed}}",
      "{{OpenNoinclude}}",
      "{{NestedNoinclude}}",
      "{{OnlyInNoinclude}}",
      "{{SpaceTag}}",
      "{{InvalidClose}}",
      "{{NestedOnly}}",
      "{{MultipleOnly}}",
      "prefix{{Head}}",
      "{{ArgBody|* item}}",
      "{{ArgBody|{{List}}}}",
      "{{ArgBody|{{Head}}}}",
      "{{!}}{{=}}",
    ];
    const results = await Promise.all(
      fixtures.map((source) => expandWikitext(source, { templates: TEMPLATES })),
    );
    for (const [index, source] of fixtures.entries()) {
      expect(results[index]?.document.source, source).toBe(oracleExpand(source));
    }
  });
});
