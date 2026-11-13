import { describe, expect, it } from "vitest";
import { flattenNodes, getSourceText, type WikitextNode } from "@/ast";
import { parse } from "../helpers/parse";

function spanOf(node: WikitextNode | undefined): readonly [number, number] | undefined {
  return node?.origin ? [node.origin.start, node.origin.end] : undefined;
}

function texts(source: string): WikitextNode[] {
  const document = parse(source);
  return flattenNodes(document.ast).filter((node) => node.type === "text");
}

describe("semantic source positions", () => {
  it("keeps trimmed heading text pointing at the real source", () => {
    const document = parse("==  Head  ==");
    const text = flattenNodes(document.ast).find((node) => node.type === "text");
    expect(text?.type).toBe("text");
    if (text?.type !== "text") {
      throw new Error("expected a text node");
    }
    expect(text.value).toBe("Head");
    expect(spanOf(text)).toEqual([4, 8]);
    expect(getSourceText(document, text)).toBe("Head");
  });

  it("advances the start of trimmed leading whitespace", () => {
    const document = parse("  hello");
    const [text] = texts("  hello");
    if (!text || text.type !== "text") {
      throw new Error("expected a text node");
    }
    expect(text.value).toBe("hello");
    expect(spanOf(text)).toEqual([2, 7]);
    expect(getSourceText(document, text)).toBe("hello");
  });

  it("leaves generated list joins without origin or position", () => {
    const document = parse("* a\n  b");
    const nodes = texts("* a\n  b");
    expect(nodes.map((node) => (node.type === "text" ? node.value : ""))).toEqual(["a", " ", "b"]);
    const [, join, tail] = nodes;
    if (!join || join.type !== "text" || !tail || tail.type !== "text") {
      throw new Error("expected three text nodes");
    }
    expect(join.origin).toBeUndefined();
    expect(join.value).toBe(" ");
    expect(spanOf(tail)).toEqual([6, 7]);
    expect(getSourceText(document, tail)).toBe("b");
  });

  it("keeps link labels and surrounding text on their own ranges", () => {
    const source = "[[A]] tail";
    const document = parse(source);
    const nodes = texts(source);
    expect(nodes.map((node) => (node.type === "text" ? node.value : ""))).toEqual(["A", " tail"]);
    expect(spanOf(nodes[0])).toEqual([2, 3]);
    expect(spanOf(nodes[1])).toEqual([5, 10]);
    expect(getSourceText(document, nodes[1]!)).toBe(" tail");
  });

  it("keeps emphasis and table cell ranges exact", () => {
    const emphasisDoc = parse("''a''");
    const emphasisText = texts("''a''")[0];
    expect(spanOf(emphasisText)).toEqual([2, 3]);
    expect(getSourceText(emphasisDoc, emphasisText!)).toBe("a");

    const tableDoc = parse("{|\n| a\n|}");
    const cellText = texts("{|\n| a\n|}")[0];
    expect(spanOf(cellText)).toEqual([5, 6]);
    expect(getSourceText(tableDoc, cellText!)).toBe("a");
  });
});
