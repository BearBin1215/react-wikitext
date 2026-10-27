import type { WikitextNode, WikitextSyntaxNode } from "../ast/model";
import type { NormalizeContext } from "./context";
import { nodeLocation } from "./context";
import { trimInlinePieces, piecesFromNodes, normalizeInlinePieces } from "./inline";
import { splitParagraphText } from "./text";
import { needsBlockNormalization } from "./block-policy";
import { childOfType, syntaxAttributes } from "./fields";

type BlockBuilder = (
  nodes: readonly WikitextSyntaxNode[],
  limit: number,
  depth: number,
) => WikitextNode[];

function cellNeedsBlocks(context: NormalizeContext, inner: WikitextSyntaxNode): boolean {
  if (needsBlockNormalization(inner.children)) {
    return true;
  }
  return inner.children.some(
    (node) =>
      node.type === "text" &&
      splitParagraphText(context.source.slice(node.range[0], node.range[1])).length > 1,
  );
}

function cellContent(
  context: NormalizeContext,
  cell: WikitextSyntaxNode,
  buildBlocks: BlockBuilder | undefined,
  depth: number,
): WikitextNode[] {
  const inner = childOfType(cell, "td-inner");
  if (!inner) {
    return [];
  }
  if (buildBlocks && cellNeedsBlocks(context, inner)) {
    return buildBlocks(inner.children, inner.range[1], depth + 1);
  }
  return normalizeInlinePieces(
    context,
    trimInlinePieces(piecesFromNodes(inner.children, { textForTextNodes: true })),
  );
}

function buildCell(
  context: NormalizeContext,
  cell: WikitextSyntaxNode,
  buildBlocks: BlockBuilder | undefined,
  depth: number,
): WikitextNode {
  const subtype = typeof cell.props.subtype === "string" ? cell.props.subtype : "td";
  return {
    type: "tableCell",
    id: "",
    kind: subtype === "th" ? "th" : "td",
    attributes: syntaxAttributes(cell),
    children: cellContent(context, cell, buildBlocks, depth),
    ...nodeLocation(context, { syntax: cell }),
  };
}

function buildCaption(context: NormalizeContext, cell: WikitextSyntaxNode): WikitextNode {
  return {
    type: "tableCaption",
    id: "",
    attributes: syntaxAttributes(cell),
    children: cellContent(context, cell, undefined, 0),
    ...nodeLocation(context, { syntax: cell }),
  };
}

function buildRow(
  context: NormalizeContext,
  row: WikitextSyntaxNode | undefined,
  cells: readonly WikitextSyntaxNode[],
  buildBlocks: BlockBuilder | undefined,
  depth: number,
): WikitextNode {
  const range: readonly [number, number] =
    cells.length > 0 ? [cells[0]!.range[0], cells[cells.length - 1]!.range[1]] : [0, 0];
  return {
    type: "tableRow",
    id: "",
    attributes: row ? syntaxAttributes(row) : [],
    children: cells.map((cell) => buildCell(context, cell, buildBlocks, depth)),
    ...(row
      ? nodeLocation(context, { syntax: row })
      : nodeLocation(context, { range, origin: { range } })),
  };
}

/** 注释与扩展标签内的 `{|`/`|}` 不是表格语法，统计前要跳过这些区间。 */
function maskRanges(node: WikitextSyntaxNode, ranges: Array<[number, number]>): void {
  for (const child of node.children) {
    if (child.type === "comment" || child.type === "ext") {
      ranges.push([child.range[0], child.range[1]]);
      continue;
    }
    maskRanges(child, ranges);
  }
}

function countTableMarkers(context: NormalizeContext, node: WikitextSyntaxNode): number {
  const masked: Array<[number, number]> = [];
  maskRanges(node, masked);
  masked.sort((a, b) => a[0] - b[0]);
  let opens = 0;
  let closes = 0;
  let cursor = node.range[0];
  const count = (start: number, end: number): void => {
    if (end <= start) {
      return;
    }
    const text = context.source.slice(start, end);
    opens += (text.match(/\{\|/gu) ?? []).length;
    closes += (text.match(/\|\}/gu) ?? []).length;
  };
  for (const [start, end] of masked) {
    if (start > cursor) {
      count(cursor, Math.min(start, node.range[1]));
    }
    cursor = Math.max(cursor, end);
  }
  count(cursor, node.range[1]);
  return opens > 1 && closes < opens ? opens - closes : 0;
}

export function normalizeTable(
  context: NormalizeContext,
  node: WikitextSyntaxNode,
  buildBlocks?: BlockBuilder,
  depth = 0,
): WikitextNode {
  if (countTableMarkers(context, node) > 0) {
    const location = nodeLocation(context, { syntax: node });
    context.diagnostics.push({
      code: "NESTED_TABLE_UNSUPPORTED",
      stage: "parse",
      severity: "warning",
      message: "A nested wikitext table was degraded to a source card.",
      ...location,
    });
    return {
      type: "unknown",
      id: "",
      parserType: "table",
      value: context.source.slice(node.range[0], node.range[1]),
      block: true,
      reason: "nestedTableUnsupported",
      ...location,
    };
  }

  let caption: WikitextNode | undefined;
  const rows: WikitextNode[] = [];
  let implicit: WikitextSyntaxNode[] = [];

  const flushImplicit = (): void => {
    if (implicit.length > 0) {
      rows.push(buildRow(context, undefined, implicit, buildBlocks, depth));
      implicit = [];
    }
  };

  for (const child of node.children) {
    if (child.type === "td" && child.props.subtype === "caption") {
      caption ??= buildCaption(context, child);
      continue;
    }
    if (child.type === "td") {
      implicit.push(child);
      continue;
    }
    if (child.type === "tr") {
      flushImplicit();
      const cells: WikitextSyntaxNode[] = [];
      for (const cell of child.children) {
        if (cell.type !== "td") {
          continue;
        }
        if (cell.props.subtype === "caption") {
          caption ??= buildCaption(context, cell);
          continue;
        }
        cells.push(cell);
      }
      if (cells.length > 0) {
        rows.push(buildRow(context, child, cells, buildBlocks, depth));
      }
    }
  }
  flushImplicit();

  return {
    type: "table",
    id: "",
    attributes: syntaxAttributes(node),
    children: [...(caption ? [caption] : []), ...rows],
    ...nodeLocation(context, { syntax: node }),
  };
}
