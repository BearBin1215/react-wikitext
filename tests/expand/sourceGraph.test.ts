import { describe, expect, it } from "vitest";
import {
  findRenderedNodes,
  findSourceByRole,
  getSourcePosition,
  getSpanText,
  mapSourceSpan,
} from "@/ast";
import { parseWikitext } from "@/parse";
import { expandWikitext } from "../helpers/expand";

const TEMPLATES = {
  "Template:Echo": "[{{{1}}}]",
  "Template:Filtered": "a<noinclude>x</noinclude>b",
};

describe("source graph normalization", () => {
  it("maps CRLF to LF at transform boundaries", () => {
    const snapshot = parseWikitext("a\r\nb");
    const input = findSourceByRole(snapshot.graph, "input")!;
    const normalized = findSourceByRole(snapshot.graph, "normalized")!;
    expect(normalized.text).toBe("a\nb");

    const forward = mapSourceSpan(
      snapshot.graph,
      { sourceId: input.id, start: 0, end: 3 },
      { targetSourceId: normalized.id },
    );
    expect(forward.coverage).toBe("complete");
    expect(forward.matches.map((match) => [match.to.start, match.to.end])).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(forward.matches.every((match) => match.precision === "exact")).toBe(true);

    const backward = mapSourceSpan(
      snapshot.graph,
      { sourceId: normalized.id, start: 1, end: 2 },
      { targetSourceId: input.id },
    );
    // CRLF 折叠后只能按整个变换片段对应，不做比例插值。
    expect(backward.matches).toHaveLength(1);
    expect(backward.matches[0]).toMatchObject({
      to: { sourceId: input.id, start: 1, end: 3 },
      precision: "exact",
    });
  });

  it("derives line and column from the owning source", () => {
    const snapshot = parseWikitext("one\ntwo");
    const normalized = findSourceByRole(snapshot.graph, "normalized")!;
    const position = getSourcePosition(snapshot.graph, {
      sourceId: normalized.id,
      start: 4,
      end: 7,
    });
    expect(position.start).toMatchObject({ line: 2, column: 1, offset: 4 });
    expect(position.end).toMatchObject({ line: 2, column: 4, offset: 7 });
  });
});

describe("expanded source mapping", () => {
  it("maps argument output back to the page argument", async () => {
    const result = await expandWikitext("{{Echo|a}}{{Echo|b}}", { templates: TEMPLATES });
    const snapshot = result.snapshot;
    expect(snapshot.source).toBe("[a][b]");

    const first = mapSourceSpan(snapshot.graph, {
      sourceId: snapshot.activeSourceId,
      start: 1,
      end: 2,
    });
    expect(first.matches[0]?.to).toMatchObject({ start: 7, end: 8 });
    expect(first.matches[0]?.precision).toBe("exact");
    expect(getSpanText(snapshot.graph, first.matches[0]!.to)).toBe("a");

    const second = mapSourceSpan(snapshot.graph, {
      sourceId: snapshot.activeSourceId,
      start: 4,
      end: 5,
    });
    expect(second.matches[0]?.to).toMatchObject({ start: 17, end: 18 });
    expect(second.matches[0]?.precision).toBe("exact");
  });

  it("returns every occurrence of a repeated template without choosing one", async () => {
    const result = await expandWikitext("{{Echo|a}}{{Echo|b}}", { templates: TEMPLATES });
    const snapshot = result.snapshot;
    const effective = findSourceByRole(snapshot.graph, "effective")!;
    const opening = mapSourceSpan(
      snapshot.graph,
      { sourceId: effective.id, start: 0, end: 1 },
      { targetSourceId: snapshot.activeSourceId },
    );
    expect(opening.matches.map((match) => match.to.start)).toEqual([0, 3]);
    expect(opening.coverage).toBe("complete");
  });

  it("associates template body output with the page call at coarse precision", async () => {
    const result = await expandWikitext("{{Echo|a}}", { templates: TEMPLATES });
    const snapshot = result.snapshot;
    const located = mapSourceSpan(snapshot.graph, {
      sourceId: snapshot.activeSourceId,
      start: 0,
      end: 1,
    });
    expect(located.matches[0]?.to).toMatchObject({ start: 0, end: 10 });
    expect(located.matches[0]?.precision).toBe("enclosing-invocation");
  });

  it("keeps include deletions unmapped", async () => {
    const result = await expandWikitext("{{Filtered}}", { templates: TEMPLATES });
    const snapshot = result.snapshot;
    const template = findSourceByRole(snapshot.graph, "template")!;
    const effective = findSourceByRole(snapshot.graph, "effective")!;
    expect(effective.text).toBe("ab");
    const removedStart = template.text.indexOf("x");
    const removed = mapSourceSpan(
      snapshot.graph,
      { sourceId: template.id, start: removedStart, end: removedStart + 1 },
      { targetSourceId: effective.id },
    );
    expect(removed.coverage).toBe("none");
    expect(removed.matches).toHaveLength(0);

    const kept = mapSourceSpan(
      snapshot.graph,
      { sourceId: effective.id, start: 1, end: 2 },
      { targetSourceId: template.id },
    );
    expect(getSpanText(snapshot.graph, kept.matches[0]!.to)).toBe("b");
  });

  it("marks function results as coarse instead of exact", async () => {
    const result = await expandWikitext("{{#len:abc}}");
    const snapshot = result.snapshot;
    expect(snapshot.source).toBe("3");
    const located = mapSourceSpan(snapshot.graph, {
      sourceId: snapshot.activeSourceId,
      start: 0,
      end: 1,
    });
    expect(located.matches[0]?.precision).toBe("enclosing-invocation");
    // 粗粒度关联覆盖整段可见输出，但仍不能当作精确映射。
    expect(located.coverage).toBe("complete");
  });

  it("locates rendered nodes and finds nodes by source range", async () => {
    const result = await expandWikitext("text", {});
    const snapshot = result.snapshot;
    const paragraph = snapshot.ast.children[0]!;
    const located = findRenderedNodes(snapshot, {
      sourceId: snapshot.activeSourceId,
      start: 0,
      end: 4,
    });
    expect(located.nodes.map((node) => node.nodeId)).toContain(paragraph.id);
    expect(located.nodes[0]?.span).toMatchObject({ start: 0, end: 4 });
  });
});
