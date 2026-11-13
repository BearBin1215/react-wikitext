import { describe, expect, it } from "vitest";
import { findNodeById, flattenNodes, getFileParameters, isNodeType, toPlainText } from "@/ast";
import { parse } from "../helpers/parse";

function fileNode(source: string) {
  const document = parse(source);
  const node = flattenNodes(document.ast).find((candidate) => isNodeType(candidate, "file"));
  expect(node).toBeDefined();
  return { document, file: node! };
}

describe("getFileParameters", () => {
  it("parses explicit keys, dimensions, format, and alignment", () => {
    const source =
      "[[File:X.png|thumb|left|200x100px|alt=Alt text|lang=zh|page=2|class=foo|upright=1.2|link=Target|First|Last]]";
    const { file } = fileNode(source);
    const parameters = getFileParameters(file);
    expect(parameters).toMatchObject({
      name: "X.png",
      alt: "Alt text",
      lang: "zh",
      page: "2",
      className: "foo",
      upright: 1.2,
      link: "Target",
      width: 200,
      height: 100,
      format: "thumbnail",
      alignment: "left",
      caption: "Last",
    });
  });

  it("uses the last unnamed parameter as caption", () => {
    const { file } = fileNode("[[File:X.png|First|Last]]");
    expect(getFileParameters(file).caption).toBe("Last");
  });

  it("does not leak the caption= key into the caption", () => {
    const { file } = fileNode("[[File:X.png|thumb|Unnamed|caption=Cap text]]");
    const parameters = getFileParameters(file);
    expect(parameters.caption).toBe("Cap text");
    expect(parameters.caption).not.toContain("caption=");
    expect(toPlainText(file)).toBe("X.png");
  });

  it("keeps captions without parameters empty", () => {
    const { document, file } = fileNode("[[File:X.png]]");
    const parameters = getFileParameters(file);
    expect(parameters.caption).toBeUndefined();
    expect(parameters.captionNodes).toEqual([]);
    expect(parameters.border).toBe(false);
    expect(findNodeById(document.ast, file.id)).toBe(file);
  });
});
