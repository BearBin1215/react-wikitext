import { describe, expect, it } from "vitest";
import { flattenNodes, type WikitextExtension } from "@/ast";
import { parse } from "../helpers/parse";

function extension(source: string): WikitextExtension {
  const node = flattenNodes(parse(source).ast).find((item) => item.type === "extension");
  expect(node?.type).toBe("extension");
  return node as WikitextExtension;
}

describe("extension identity", () => {
  it("keeps unsupported tags with their name, attributes, source and block state", () => {
    const node = extension('<poem class="verse">line 1\nline 2</poem>');
    expect(node).toMatchObject({
      name: "poem",
      block: true,
      selfClosing: false,
      raw: "line 1\nline 2",
    });
    expect(node.attributes).toEqual([expect.objectContaining({ name: "class", value: "verse" })]);
  });

  it("treats a standalone unsupported tag as a block-level node", () => {
    const nodes = flattenNodes(parse("intro\n<references/>\n").ast);
    expect(nodes.map((node) => node.type)).toEqual(["root", "paragraph", "text", "extension"]);
    expect(nodes[3]).toMatchObject({
      type: "extension",
      name: "references",
      block: true,
      selfClosing: true,
      raw: "",
    });
  });

  it("keeps unsupported tags inline when they share a line", () => {
    expect(extension("before <poem>x</poem> after").block).toBe(false);
  });

  it("keeps dedicated inline tags inline even on their own line", () => {
    expect(extension("<nowiki>x</nowiki>").block).toBe(false);
    expect(extension("<math>x</math>").block).toBe(false);
  });
});
