import { describe, expect, it } from "vitest";
import { remapExpandedIds, restoreSelectedId, snapshotSelection } from "@pg/devtools";
import { flattenNodes } from "@/ast";
import { parse } from "../helpers/parse";

function findSemantic(doc: ReturnType<typeof parse>, type: string) {
  return flattenNodes(doc.ast).find((node) => node.type === type);
}

describe("selection restoration", () => {
  it("restores a node after a prefix insertion", () => {
    const oldDoc = parse("Hello world");
    const text = findSemantic(oldDoc, "text");
    const snapshot = snapshotSelection(oldDoc, text?.id);
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

  it("does not restore zero-length syntax nodes", () => {
    const oldDoc = parse("== H ==\ntext");
    const trail = oldDoc.syntax?.children[0]?.children.find(
      (node) => node.type === "heading-trail",
    );
    expect(
      restoreSelectedId(
        parse("== H ==\nmore"),
        snapshotSelection(oldDoc, trail?.id, "syntax"),
        "syntax",
      ),
    ).toBeUndefined();
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
    const snapshot = { id: "snapshot", type: "link", start: first[1], end: first[1] + 1 };
    expect(restoreSelectedId(doc, snapshot)).toBe(links[1]!.id);
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
