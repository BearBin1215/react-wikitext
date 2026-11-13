import { describe, expect, it } from "vitest";
import { getSourcePosition } from "@/ast";
import { prepareWikitext } from "@/hast";
import { configWithHtmlTags } from "../helpers/configs";
import { parse } from "../helpers/parse";

function codes(source: string, prepareOptions: Parameters<typeof prepareWikitext>[1] = {}) {
  return prepareWikitext(parse(source), prepareOptions).diagnostics.map((entry) => entry.code);
}

describe("degradation diagnostics", () => {
  it("reports unsupported extensions and blocked HTML", () => {
    expect(codes("x<timeline>y</timeline>")).toContain("EXTENSION_UNSUPPORTED");
    const blocked = prepareWikitext(
      parse("<script>leak</script>", { config: configWithHtmlTags(["script"]) }),
    ).diagnostics;
    expect(blocked.map((entry) => entry.code)).toContain("BLOCKED_HTML");
  });

  it("reports nested tables, missing files and empty references", () => {
    expect(codes("{|\n| a\n| {|\n| inner\n|}\n|}")).toContain("NESTED_TABLE_UNSUPPORTED");
    expect(codes("[[File:X.png]]")).toContain("FILE_PLACEHOLDER");
    expect(codes('<ref name="empty"/>')).toContain("REFERENCE_MISSING_CONTENT");
  });

  it("reports duplicate reference definitions and unknown behavior switches", () => {
    expect(codes('<ref name="a">x</ref><ref name="a">y</ref>')).toContain(
      "REFERENCE_DUPLICATE_DEFINITION",
    );
    expect(codes("__NOEDITSECTION__")).toContain("BEHAVIOR_SWITCH_IGNORED");
  });

  it("reports dropped unsafe style declarations", () => {
    const diagnostics = prepareWikitext(
      parse('<span style="color:red; background:url(javascript:alert(1))">x</span>'),
    ).diagnostics;
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: "STYLE_DECLARATION_DROPPED" }),
    );
  });

  it("attaches source positions to diagnostics", () => {
    const prepared = prepareWikitext(parse("<timeline>y</timeline>"));
    const diagnostics = prepared.diagnostics;
    const entry = diagnostics.find((diagnostic) => diagnostic.code === "EXTENSION_UNSUPPORTED");
    expect(entry?.location).toMatchObject({ start: 0, end: 22 });
    if (!entry?.location) {
      throw new Error("expected the diagnostic to carry a source location");
    }
    // 行列坐标由所属文本源按需计算，不再与 span 分别存储。
    expect(getSourcePosition(prepared.graph, entry.location).start.offset).toBe(0);
  });
});
