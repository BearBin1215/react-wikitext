import { describe, expect, it } from "vitest";
import {
  findAstTreeNode,
  getNodeRange,
  getNodeSource,
  isSyntaxNode,
  remapExpandedIds,
  restoreSelectedId,
  snapshotSelection,
  type AstTreeDocument,
} from "@/devtools";
import { flattenNodes } from "@/ast";
import { parse, prepare } from "../helpers/parse";

function findSemantic(doc: ReturnType<typeof parse>, type: string) {
  return flattenNodes(doc.ast).find((node) => node.type === type);
}

describe("selection restoration", () => {
  it("finds nodes by id in the requested tree", () => {
    const doc = parse("== H ==\ntext");
    const heading = findSemantic(doc, "heading")!;
    expect(findAstTreeNode(doc, heading.id, "semantic")?.type).toBe("heading");
    expect(findAstTreeNode(doc, undefined, "semantic")).toBeUndefined();
    const syntaxHeading = doc.syntax?.children[0]?.children.find(
      (node) => node.type === "heading-title",
    );
    expect(syntaxHeading ? findAstTreeNode(doc, syntaxHeading.id, "syntax")?.type : undefined).toBe(
      "heading-title",
    );
  });

  it("reads ranges and source for semantic and syntax nodes", () => {
    const doc = parse("== H ==\ntext");
    const heading = findSemantic(doc, "heading")!;
    const range = getNodeRange(heading)!;
    expect(getNodeSource(doc, heading)).toBe(doc.source.slice(range[0], range[1]));
    expect(isSyntaxNode(heading)).toBe(false);

    const syntaxHeading = doc.syntax!.children[0]!;
    expect(isSyntaxNode(syntaxHeading)).toBe(true);
    expect(getNodeRange(syntaxHeading)).toEqual(syntaxHeading.range);
    expect(getNodeSource(doc, syntaxHeading)).toBe(
      doc.source.slice(syntaxHeading.range[0], syntaxHeading.range[1]),
    );
  });

  it("restores a node after a prefix insertion", () => {
    const oldDoc = parse("Hello world");
    const text = findSemantic(oldDoc, "text");
    const snapshot = snapshotSelection(oldDoc, text?.id);
    expect(snapshot?.kind).toBe("semantic");
    const newDoc = parse("Prefix\nHello world");
    const restored = restoreSelectedId(newDoc, snapshot);
    expect(restored).toBe(findSemantic(newDoc, "text")?.id);
  });

  it("restores a link after its label changes", () => {
    const oldDoc = parse("see [[Target|label]]");
    const link = findSemantic(oldDoc, "link");
    const snapshot = snapshotSelection(oldDoc, link?.id);
    const newDoc = parse("see [[Target|new label]]");
    const restored = restoreSelectedId(newDoc, snapshot);
    expect(newDoc.ast && flattenNodes(newDoc.ast).find((node) => node.id === restored)?.type).toBe(
      "link",
    );
  });

  it("does not snapshot zero-length syntax nodes", () => {
    const oldDoc = parse("== H ==\ntext");
    const trail = oldDoc.syntax?.children[0]?.children.find(
      (node) => node.type === "heading-trail",
    );
    const snapshot = snapshotSelection(oldDoc, trail?.id, "syntax");
    expect(snapshot).toBeUndefined();
    expect(restoreSelectedId(parse("== H ==\nmore"), snapshot, "syntax")).toBeUndefined();
  });

  it("returns undefined for a missing snapshot", () => {
    const doc = parse("text");
    expect(restoreSelectedId(doc, undefined)).toBeUndefined();
  });

  it("treats restored ranges as half-open at adjacent boundaries", () => {
    const doc = parse("[[A]] [[B]]");
    const links = flattenNodes(doc.ast).filter((node) => node.type === "link");
    const first = links[0]!.origin!.range;
    // 起点与第一个链接的结束边界重合：应视为不在其内部。
    const snapshot = {
      kind: "semantic" as const,
      id: "snapshot",
      type: "link",
      start: first[1],
      end: first[1] + 1,
    };
    expect(restoreSelectedId(doc, snapshot)).toBe(links[1]!.id);
  });

  it("prefers the node with the matching end when starts are equal", () => {
    const document = {
      source: "0123456789",
      ast: {
        type: "root",
        id: "0",
        origin: { range: [0, 10] },
        children: [
          {
            type: "link",
            id: "outer",
            origin: { range: [0, 10] },
            children: [{ type: "link", id: "inner", origin: { range: [0, 5] }, children: [] }],
          },
        ],
      },
    } as unknown as AstTreeDocument;
    const snapshot = {
      kind: "semantic" as const,
      id: "outer",
      type: "link",
      start: 0,
      end: 5,
    };
    expect(restoreSelectedId(document, snapshot)).toBe("inner");
  });

  it("does not restore a snapshot into another tree kind", () => {
    const doc = parse("== H ==\ntext");
    const heading = findSemantic(doc, "heading");
    const snapshot = snapshotSelection(doc, heading?.id, "semantic");
    expect(restoreSelectedId(doc, snapshot, "syntax")).toBeUndefined();
  });

  it("restores a selection in a rendered document", () => {
    const oldDoc = prepare("Hello world");
    const text = flattenNodes(oldDoc.ast).find((node) => node.type === "text");
    const snapshot = snapshotSelection(oldDoc, text?.id);
    const newDoc = prepare("Prefix\nHello world");
    const restored = restoreSelectedId(newDoc, snapshot);
    expect(restored).toBe(flattenNodes(newDoc.ast).find((node) => node.type === "text")?.id);
  });

  it("remaps expanded ids by type and range", () => {
    const oldDoc = parse("== H ==\ntext");
    const heading = findSemantic(oldDoc, "heading");
    const expanded = new Set(["0", heading!.id]);
    const newDoc = parse("prefix\n== H ==\ntext");
    const remapped = remapExpandedIds(oldDoc, newDoc, expanded);
    const newHeading = findSemantic(newDoc, "heading");
    expect(remapped.has("0")).toBe(true);
    expect(remapped.has(newHeading!.id)).toBe(true);
  });
});
