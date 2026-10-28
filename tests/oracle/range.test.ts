import { describe, expect, it } from "vitest";
import type { ParserConfig } from "@/configs";
import { MINIMUM_CONFIG } from "../helpers/configs";
import { compareRanges } from "../helpers/parse";
import { ZH_CONFIG } from "../helpers/configs";

function formatDifferences(differences: ReturnType<typeof compareRanges>): string {
  return differences
    .map(
      (diff) =>
        `${diff.path} <${diff.type}> expected [${diff.expected.join("-")}] actual [${diff.actual.join("-")}]${diff.zeroLength ? " (zero-length)" : ""}`,
    )
    .join("\n");
}

describe("range reconstruction against Node json() oracle", () => {
  const cases: Array<{ name: string; source: string; config?: ParserConfig }> = [
    { name: "empty source", source: "" },
    { name: "plain text with paragraphs", source: "first line\nsecond line\n\nsecond paragraph" },
    { name: "heading and trail", source: "== Head ==\ntext" },
    { name: "quotes", source: "''italic'' '''bold''' '''''both''''' unfinished '''" },
    { name: "internal links", source: "[[A]] [[B|label]] [[C#section|deep]]" },
    { name: "templates and parameters", source: "{{Tpl|a=1|{{Nested|x}}|positional}}" },
    { name: "lists", source: "* one\n** nested\n*# mixed\n; term : definition\n: indent\n" },
    {
      name: "table with implicit header row",
      source: '{| class="wikitable"\n|+ Caption\n! H1 !! H2\n|-\n| a || b\n|}',
    },
    {
      name: "table with explicit rows",
      source: '{| class="wikitable"\n|-\n! H1\n! H2\n|-\n| a\n| b\n|}',
    },
    {
      name: "html open close and void",
      source: '<div class="x"><b>hi</b><br><span title="t">there</span></div>',
    },
    { name: "self-closing html tags", source: "<br/> <br /> <span/> <span /> <div/>x</div>" },
    { name: "self-closing extension tag", source: '<ref name="x"/>', config: ZH_CONFIG },
    {
      name: "file parameters",
      source: "[[File:x.png|thumb|alt=a|[[b]]|caption=Cap text|link=Target|200px]]",
      config: ZH_CONFIG,
    },
    { name: "empty quoted attributes", source: '<div class="">x</div>' },
    {
      name: "extension tags",
      source: '<ref name="r">note [[L]]</ref>\n<nowiki>&amp; [[x]]</nowiki>\n<pre>a\nb</pre>',
      config: ZH_CONFIG,
    },
    { name: "repeated text", source: "aa aa aa [[aa|aa]] {{aa|aa}}" },
    { name: "unicode and emoji", source: "中文 😀 [[条目|显示]] {|x|}" },
    { name: "crlf input", source: "== Head ==\r\ntext\r\n* item\r\n" },
    {
      name: "mixed html and table attributes",
      source: '<span class="x" title="t" id="q">hi</span>\n{| style="a" data-x=1\n| a\n|}',
      config: ZH_CONFIG,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const differences = compareRanges(testCase.source, testCase.config ?? MINIMUM_CONFIG);
      expect(formatDifferences(differences)).toBe("");
    });
  }
});
