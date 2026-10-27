import type { WikitextNode, WikitextSyntaxNode } from "../ast/model";
import type { NormalizeContext } from "./context";
import { nodeLocation } from "./context";
import {
  BLOCK_CONTENT_TAGS,
  INLINE_CONTENT_BLOCK_TAGS,
  RAW_TEXT_BLOCK_TAGS,
  classifyHtmlTag,
  htmlTagName,
  isClosingHtml,
  isSelfClosingHtml,
} from "./html";
import { needsBlockNormalization } from "./block-policy";
import {
  normalizeInlinePieces,
  piecesFromNodes,
  trimInlinePieces,
  type InlinePiece,
} from "./inline";
import { syntaxAttributes } from "./fields";
import { decodeRawText } from "./text";

const STOP_TAGS = new Set(["heading", "hr", "table", "list", "redirect"]);

/** 块级 HTML 子内容归一化的回调；由调用方注入，避免与 blocks 模块形成循环依赖。 */
export type BuildBlockNodes = (
  nodes: readonly WikitextSyntaxNode[],
  limit: number,
  depth: number,
) => WikitextNode[];

interface HtmlBlockResult {
  readonly node: WikitextNode;
  readonly endOffset: number;
  /** 是否找到配对闭合；自闭合与 void 标签视为已闭合。 */
  readonly closed: boolean;
}

function piecesWithin(
  nodes: readonly WikitextSyntaxNode[],
  source: string,
  limit: number,
): InlinePiece[] {
  const pieces: InlinePiece[] = [];
  for (const node of nodes) {
    if (node.type !== "text") {
      pieces.push(...piecesFromNodes([node]));
      continue;
    }
    const end = Math.min(node.range[1], limit);
    if (end > node.range[0]) {
      pieces.push({
        kind: "syntax",
        syntax: node,
        text: source.slice(node.range[0], end),
        start: node.range[0],
      });
    }
  }
  return pieces;
}

/**
 * 归一化一个块级 HTML 元素，并返回其结束位置。
 * @param context 归一化上下文。
 * @param nodes 当前块级容器中的语法节点。
 * @param index 开标签在 `nodes` 中的下标。
 * @param depth 当前块级嵌套深度。
 * @param buildBlocks 子内容块级归一化回调。
 */
export function normalizeHtmlBlock(
  context: NormalizeContext,
  nodes: readonly WikitextSyntaxNode[],
  index: number,
  depth: number,
  buildBlocks: BuildBlockNodes,
): HtmlBlockResult {
  const open = nodes[index]!;
  const tag = htmlTagName(open);
  const kind = classifyHtmlTag(tag);
  const source = context.source;
  const inner: WikitextSyntaxNode[] = [];
  let close: WikitextSyntaxNode | undefined;

  if (!isSelfClosingHtml(open) && kind !== "void") {
    let depthCount = 1;
    for (let cursor = index + 1; cursor < nodes.length; cursor++) {
      const candidate = nodes[cursor]!;
      if (candidate.type === "html" && htmlTagName(candidate) === tag) {
        if (isClosingHtml(candidate)) {
          depthCount--;
          if (depthCount === 0) {
            close = candidate;
            break;
          }
        } else if (!isSelfClosingHtml(candidate)) {
          depthCount++;
        }
      } else if (STOP_TAGS.has(candidate.type)) {
        break;
      }
      inner.push(candidate);
    }
  }

  const endOfInner = close
    ? close.range[1]
    : inner.length > 0
      ? inner[inner.length - 1]!.range[1]
      : open.range[1];
  let endOffset = endOfInner;
  let contentLimit = close ? close.range[0] : endOfInner;
  let effectiveInner = inner;
  if (!close && kind !== "banned" && !RAW_TEXT_BLOCK_TAGS.has(tag)) {
    const blank = /\n[ \t]*\n/u.exec(source.slice(open.range[1], endOfInner));
    if (blank) {
      const blankStart = open.range[1] + blank.index;
      contentLimit = blankStart;
      endOffset = blankStart + blank[0].length;
      effectiveInner = inner.filter((node) => node.range[0] < blankStart);
    }
  }

  const closed = close !== undefined || isSelfClosingHtml(open) || kind === "void";

  if (kind === "banned") {
    return {
      node: {
        type: "htmlElement",
        id: "",
        tag,
        attributes: syntaxAttributes(open),
        selfClosing: false,
        block: true,
        blocked: true,
        children: [],
        ...nodeLocation(context, { syntax: open }),
      },
      endOffset,
      closed,
    };
  }

  // 调用方只会在 `isBlockHtmlStart` 成立后进入本函数，因此这里是块级、禁止或 void 标签。
  let children: WikitextNode[];
  if (RAW_TEXT_BLOCK_TAGS.has(tag)) {
    const start = open.range[1];
    const raw = decodeRawText(source.slice(start, contentLimit));
    children = [
      {
        type: "text",
        id: "",
        value: raw,
        ...nodeLocation(context, { origin: { syntaxId: open.id, range: [start, contentLimit] } }),
      },
    ];
  } else if (INLINE_CONTENT_BLOCK_TAGS.has(tag) || BLOCK_CONTENT_TAGS.has(tag)) {
    children = needsBlockNormalization(effectiveInner)
      ? buildBlocks(effectiveInner, contentLimit, depth + 1)
      : normalizeInlinePieces(
          context,
          trimInlinePieces(piecesWithin(effectiveInner, source, contentLimit)),
        );
  } else {
    children = [];
  }

  return {
    node: {
      type: "htmlElement",
      id: "",
      tag,
      attributes: syntaxAttributes(open),
      selfClosing: isSelfClosingHtml(open),
      block: true,
      children,
      ...nodeLocation(context, { syntax: open }),
    },
    endOffset,
    closed,
  };
}
