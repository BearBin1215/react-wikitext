import { describe, expect, it } from "vitest";
import { findNodeAtOffset, findNodeById, flattenNodes, getSourceText, toPlainText } from "@/ast";
import { parse } from "../helpers/parse";

describe("semantic queries", () => {
  it("flattens the semantic tree in pre-order", () => {
    const doc = parse("== H ==\ntext");
    const types = flattenNodes(doc.ast).map((node) => node.type);
    expect(types[0]).toBe("root");
    expect(types).toContain("heading");
    expect(types).toContain("paragraph");
  });

  it("finds nodes by id and reads source text from origin", () => {
    const doc = parse("hello [[World|world]]");
    const link = flattenNodes(doc.ast).find((node) => node.type === "link");
    expect(link).toBeDefined();
    expect(findNodeById(doc, link!.id)).toBe(link);
    expect(getSourceText(doc, link!)).toBe("[[World|world]]");
    expect(toPlainText(link!)).toBe("world");
  });

  it("returns the deepest node at an offset", () => {
    const doc = parse("[[A|label]]");
    const offset = doc.source.indexOf("label") + 1;
    expect(findNodeAtOffset(doc, offset)?.type).toBe("text");
    expect(findNodeAtOffset(doc, 1)?.type).toBe("link");
  });

  it("falls back to the root at the end of the document", () => {
    const doc = parse("text");
    expect(findNodeAtOffset(doc, doc.source.length)?.id).toBe(doc.ast.id);
  });
});
