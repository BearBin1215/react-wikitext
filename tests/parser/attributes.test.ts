import { describe, expect, it } from "vitest";
import type { WikitextSyntaxNode } from "@/parse";
import { ZH_CONFIG } from "../helpers/configs";
import { parse } from "../helpers/parse";

function flatten(root: WikitextSyntaxNode): WikitextSyntaxNode[] {
  return [root, ...root.children.flatMap((child) => flatten(child))];
}

describe("syntax attributes", () => {
  it("extracts html attributes with lower-case names and decoded values", () => {
    const doc = parse('<span Class="X" title="a&amp;b" id="q">hi</span>');
    const html = flatten(doc.syntax!).find(
      (node) => node.type === "html" && node.props.closing === false,
    );
    expect(html?.attributes.map((attribute) => attribute.name)).toEqual(["class", "title", "id"]);
    expect(html?.attributes.map((attribute) => attribute.value)).toEqual(["X", "a&b", "q"]);
    expect(
      html?.attributes.map((attribute) => doc.source.slice(attribute.range[0], attribute.range[1])),
    ).toEqual(['Class="X"', 'title="a&amp;b"', 'id="q"']);
  });

  it("extracts table attributes and records boolean attributes as null", () => {
    const doc = parse('{| class="wikitable" style="color:red" data-flag\n| a\n|}');
    const table = flatten(doc.syntax!).find((node) => node.type === "table");
    expect(table?.attributes.map((attribute) => attribute.name)).toEqual([
      "class",
      "style",
      "data-flag",
    ]);
    expect(table?.attributes[0]?.value).toBe("wikitable");
    expect(table?.attributes[2]?.value).toBeNull();
  });

  it("extracts extension attributes", () => {
    const doc = parse('<ref name="r" group="g">note</ref>', { config: ZH_CONFIG });
    const ext = flatten(doc.syntax!).find(
      (node) => node.type === "ext" && node.props.name === "ref",
    );
    expect(ext?.attributes.find((attribute) => attribute.name === "name")?.value).toBe("r");
    expect(ext?.attributes.find((attribute) => attribute.name === "group")?.value).toBe("g");
  });
});
