import type { WikitextNode, WikitextRange, WikitextSyntaxNode } from "../ast/model";
import { WikitextParseError } from "../ast/errors";
import type { NormalizeContext } from "./context";
import { nodeLocation } from "./context";
import {
  BLOCK_TAG_SOURCE,
  classifyHtmlTag,
  htmlTagName,
  isBlockHtmlStart,
  isClosingHtml,
  isSelfClosingHtml,
  trackBannedTag,
} from "./html";
import { normalizeHtmlBlock, type BuildBlockNodes } from "./html-block";
import {
  hasMeaningfulPieces,
  normalizeInlinePieces,
  trimInlinePieces,
  type InlinePiece,
} from "./inline";

const LIST_PREFIX = /^([*#;:]+)[ \t]*/u;
const BLOCK_START = new RegExp(
  `^(?:={1,6}[^=\\n].*={1,6}[ \\t]*$|\\{\\||\\||!|<(?:\\/?)(?:${BLOCK_TAG_SOURCE})\\b|----)`,
  "iu",
);

interface ListLine {
  readonly start: number;
  readonly end: number;
  readonly contentStart: number;
  readonly chars?: string;
}

type VirtualItemTag = "li" | "dt" | "dd";
type VirtualBlockTag = "ul" | "ol" | "dl";

interface VirtualItem {
  readonly tag: VirtualItemTag;
  readonly ranges: Array<{ start: number; end: number }>;
  readonly children: VirtualBlock[];
}

interface VirtualBlock {
  readonly tag: VirtualBlockTag;
  readonly items: VirtualItem[];
}

interface ListResult {
  readonly nodes: WikitextNode[];
  readonly endOffset: number;
}

function listTag(char: string): VirtualBlockTag {
  if (char === "*") {
    return "ul";
  }
  if (char === "#") {
    return "ol";
  }
  return "dl";
}

/** 语法节点按 range 有序；返回第一个 end 超过 offset 的下标。 */
function lowerBound(nodes: readonly WikitextSyntaxNode[], offset: number): number {
  let low = 0;
  let high = nodes.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (nodes[middle]!.range[1] <= offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function findDefinitionSeparator(
  nodes: readonly WikitextSyntaxNode[],
  start: number,
  end: number,
): WikitextSyntaxNode | undefined {
  for (let index = lowerBound(nodes, start); index < nodes.length; index++) {
    const node = nodes[index]!;
    if (node.range[0] >= end) {
      break;
    }
    if (node.type === "dd") {
      return node;
    }
  }
  return undefined;
}

type ContentSegment =
  | { readonly pieces: readonly InlinePiece[] }
  | { readonly block: WikitextNode };

/**
 * 把一行列表内容切成行内片段与“同行完整闭合的块级 HTML”。
 * `startIndex` 由调用方用二分定位传入，避免每个列表项都从节点数组头部重新扫描。
 */
function lineSegments(
  context: NormalizeContext,
  nodes: readonly WikitextSyntaxNode[],
  startIndex: number,
  range: { readonly start: number; readonly end: number },
  depth: number,
  buildBlocks: BuildBlockNodes,
  banned: string[],
): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let pieces: InlinePiece[] = [];
  let consumed = range.start;
  const flush = (): void => {
    if (pieces.length > 0) {
      segments.push({ pieces });
      pieces = [];
    }
  };

  for (let index = startIndex; index < nodes.length; index++) {
    const node = nodes[index]!;
    if (node.range[0] >= range.end) {
      break;
    }
    if (node.range[1] <= consumed) {
      continue;
    }
    if (node.type === "list" || node.type === "dd") {
      continue;
    }
    if (node.type === "html") {
      const tag = htmlTagName(node);
      if (classifyHtmlTag(tag) === "banned") {
        trackBannedTag(banned, tag, isClosingHtml(node), isSelfClosingHtml(node));
      }
    }
    if (banned.length === 0 && node.range[0] >= consumed && isBlockHtmlStart(node)) {
      const result = normalizeHtmlBlock(context, nodes, index, depth, buildBlocks);
      if (result.closed && result.endOffset <= range.end) {
        flush();
        segments.push({ block: result.node });
        consumed = result.endOffset;
        continue;
      }
    }
    if (node.type === "text") {
      const from = Math.max(range.start, node.range[0], consumed);
      const to = Math.min(range.end, node.range[1]);
      if (to > from) {
        pieces.push({
          kind: "syntax",
          syntax: node,
          text: context.source.slice(from, to),
          start: from,
        });
      }
      continue;
    }
    if (node.range[0] >= consumed) {
      pieces.push({ kind: "syntax", syntax: node });
    }
  }

  flush();
  return segments;
}

function itemContent(
  context: NormalizeContext,
  item: VirtualItem,
  nodes: readonly WikitextSyntaxNode[],
  syntax: WikitextSyntaxNode,
  depth: number,
  buildBlocks: BuildBlockNodes,
): WikitextNode[] {
  const children: WikitextNode[] = [];
  const banned: string[] = [];
  let pieces: InlinePiece[] = [];
  let emitted = false;
  const flushInline = (trimEnd: boolean): void => {
    const trimmed = trimInlinePieces(pieces, { start: !emitted, end: trimEnd });
    pieces = [];
    if (!hasMeaningfulPieces(trimmed)) {
      return;
    }
    children.push(...normalizeInlinePieces(context, trimmed));
    emitted = true;
  };

  item.ranges.forEach((range, index) => {
    if (index > 0) {
      // 多行列表项用单个空格连接；合成文本不携带源码位置。
      pieces.push({ kind: "generated", text: " ", reason: "list-join" });
    }
    const startIndex = lowerBound(nodes, range.start);
    for (const segment of lineSegments(
      context,
      nodes,
      startIndex,
      range,
      depth,
      buildBlocks,
      banned,
    )) {
      if ("block" in segment) {
        flushInline(false);
        children.push(segment.block);
        emitted = true;
      } else {
        pieces.push(...segment.pieces);
      }
    }
  });
  flushInline(true);

  for (const child of item.children) {
    children.push(buildBlock(context, child, nodes, syntax, depth + 1, buildBlocks));
  }
  return children;
}

function blockRange(block: VirtualBlock): WikitextRange {
  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  for (const item of block.items) {
    for (const range of item.ranges) {
      start = Math.min(start, range.start);
      end = Math.max(end, range.end);
    }
  }
  return start <= end ? [start, end] : [0, 0];
}

function assertDepth(context: NormalizeContext, depth: number): void {
  if (depth > context.maxDepth) {
    throw new WikitextParseError(
      "SOURCE_TOO_COMPLEX",
      `Block nesting depth exceeds the limit of ${context.maxDepth}.`,
    );
  }
}

function buildBlock(
  context: NormalizeContext,
  block: VirtualBlock,
  nodes: readonly WikitextSyntaxNode[],
  syntax: WikitextSyntaxNode,
  depth: number,
  buildBlocks: BuildBlockNodes,
): WikitextNode {
  assertDepth(context, depth);
  const children: WikitextNode[] = block.items.map((item) => {
    const first = item.ranges[0];
    const last = item.ranges[item.ranges.length - 1];
    const range: WikitextRange =
      first && last ? [first.start, last.end] : [syntax.range[0], syntax.range[1]];
    const type =
      item.tag === "li"
        ? "listItem"
        : item.tag === "dt"
          ? "definitionTerm"
          : "definitionDescription";
    return {
      type,
      id: "",
      children: itemContent(context, item, nodes, syntax, depth, buildBlocks),
      ...nodeLocation(context, { range, origin: { range } }),
    };
  });

  const range = blockRange(block);
  const location = nodeLocation(context, { range, origin: { range } });
  if (block.tag === "dl") {
    return {
      type: "definitionList",
      id: "",
      children,
      ...location,
    };
  }
  return {
    type: "list",
    id: "",
    ordered: block.tag === "ol",
    children,
    ...location,
  };
}

export function normalizeList(
  context: NormalizeContext,
  node: WikitextSyntaxNode,
  nodes: readonly WikitextSyntaxNode[],
  buildBlocks: BuildBlockNodes,
  limit: number,
  blockDepth: number,
): ListResult {
  const { positions, source } = context;
  const startIndex = positions.lineAt(node.range[0]);
  const collected: ListLine[] = [];
  let stop = startIndex;

  for (let index = startIndex; index < positions.lineCount; index++) {
    const [lineStart, lineEnd] = positions.lineRange(index);
    if (lineStart >= limit) {
      break;
    }
    const end = Math.min(lineEnd, limit);
    const text = source.slice(lineStart, end);
    const prefix = LIST_PREFIX.exec(text);
    if (prefix) {
      collected.push({
        start: lineStart,
        end,
        contentStart: Math.min(lineStart + prefix[0].length, end),
        chars: prefix[1]!,
      });
      stop = index + 1;
      continue;
    }
    if (index === startIndex) {
      break;
    }
    if (!text.trim() || BLOCK_START.test(text)) {
      break;
    }
    // 续行的缩进只是排版，不进入语义文本。
    const indent = text.length - text.trimStart().length;
    collected.push({ start: lineStart, end, contentStart: Math.min(lineStart + indent, end) });
    stop = index + 1;
  }

  const endOffset = Math.min(
    stop < positions.lineCount ? positions.lineRange(stop)[0] : source.length,
    limit,
  );
  const roots: VirtualBlock[] = [];
  const stack: Array<{ block: VirtualBlock; item: VirtualItem; char: string }> = [];
  let previousChars: string[] = [];

  for (const line of collected) {
    if (!line.chars) {
      const deepest = stack[stack.length - 1];
      if (!deepest) {
        continue;
      }
      deepest.item.ranges.push({ start: line.contentStart, end: line.end });
      continue;
    }
    const chars = [...line.chars];
    // 先检查前缀深度，避免为超深列表构造几层虚拟块后才递归。
    assertDepth(context, blockDepth + chars.length);
    let common = 0;
    while (
      common < chars.length &&
      common < previousChars.length &&
      chars[common] === previousChars[common]
    ) {
      common++;
    }
    const startDepth = Math.min(common, chars.length - 1);
    stack.length = startDepth;

    for (let depth = startDepth; depth < chars.length; depth++) {
      const char = chars[depth]!;
      const tag = listTag(char);
      const parent = depth > 0 ? stack[depth - 1]!.item : undefined;
      const blocks = parent ? parent.children : roots;
      let block = blocks[blocks.length - 1];
      if (!block || block.tag !== tag) {
        block = { tag, items: [] };
        blocks.push(block);
      }
      const item: VirtualItem = {
        tag: char === ";" ? "dt" : char === ":" ? "dd" : "li",
        ranges: [],
        children: [],
      };
      block.items.push(item);
      stack[depth] = { block, item, char };
    }

    const deepest = stack[chars.length - 1]!;
    const separator =
      deepest.char === ";"
        ? findDefinitionSeparator(nodes, line.contentStart, line.end)
        : undefined;
    if (separator) {
      deepest.item.ranges.push({ start: line.contentStart, end: separator.range[0] });
      const item: VirtualItem = {
        tag: "dd",
        ranges: [{ start: separator.range[1], end: line.end }],
        children: [],
      };
      deepest.block.items.push(item);
      stack[chars.length - 1] = { block: deepest.block, item, char: ":" };
    } else {
      deepest.item.ranges.push({ start: line.contentStart, end: line.end });
    }
    previousChars = chars;
  }

  return {
    nodes: roots.map((block) => buildBlock(context, block, nodes, node, blockDepth, buildBlocks)),
    endOffset,
  };
}
