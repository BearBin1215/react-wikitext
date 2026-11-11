import type { WikitextNode, WikitextSyntaxNode } from "../ast/model";
import { WikitextParseError } from "../ast/errors";
import type { NormalizeContext } from "./context";
import { nodeLocation } from "./context";
import { normalizeList } from "./lists";
import { normalizeTable } from "./tables";
import {
  hasMeaningfulPieces,
  mergeOrigins,
  normalizeInlinePieces,
  normalizeInlineSyntax,
  piecesFromNodes,
  trimInlinePieces,
  type InlinePiece,
} from "./inline";
import { decodeText, splitParagraphText } from "./text";
import {
  BLOCK_EXT_TAGS,
  INLINE_EXT_TAGS,
  classifyHtmlTag,
  htmlTagName,
  isBlockHtmlStart,
} from "./html";
import { normalizeHtmlBlock, type BuildBlockNodes } from "./html-block";
import { childOfType, parseFileData, splitTarget, syntaxTextDecoded } from "./fields";
import { fileLayoutIsBlock } from "../ast/file-options";

const SYNTAX_ONLY_TYPES = new Set([
  "heading-trail",
  "table-syntax",
  "html-attrs",
  "html-attr",
  "html-attr-dirty",
  "table-attrs",
  "table-attr",
  "table-attr-dirty",
  "ext-attrs",
  "ext-attr",
  "ext-attr-dirty",
  "attr-key",
  "attr-value",
  "parameter-key",
  "parameter-value",
  "magic-word-name",
  "template-name",
  "arg-name",
  "arg-default",
  "redirect-syntax",
  "redirect-target",
  "link-target",
  "link-text",
  "ext-link-url",
  "ext-link-text",
  "ext-inner",
  "td-inner",
]);

function isStandaloneLine(source: string, node: WikitextSyntaxNode): boolean {
  let start = node.range[0];
  while (start > 0 && source[start - 1] !== "\n") {
    start--;
  }
  let end = node.range[1];
  while (end < source.length && source[end] !== "\n") {
    end++;
  }
  return (
    source.slice(start, node.range[0]).trim() === "" &&
    source.slice(node.range[1], end).trim() === ""
  );
}

function paragraphNode(context: NormalizeContext, children: readonly WikitextNode[]): WikitextNode {
  const origin = mergeOrigins(children);
  const location = origin ? nodeLocation(context, { origin }) : {};
  return { type: "paragraph", id: "", children: [...children], ...location };
}

function headingNode(context: NormalizeContext, node: WikitextSyntaxNode): WikitextNode {
  const title = childOfType(node, "heading-title");
  const pieces = trimInlinePieces(
    piecesFromNodes(title?.children ?? [], { textForTextNodes: true }),
  );
  const rawLevel = typeof node.props.level === "number" ? node.props.level : 2;
  const level = Math.min(Math.max(Math.round(rawLevel), 1), 6) as 1 | 2 | 3 | 4 | 5 | 6;
  return {
    type: "heading",
    id: "",
    level,
    children: normalizeInlinePieces(context, pieces),
    ...nodeLocation(context, { syntax: node }),
  };
}

function redirectNode(context: NormalizeContext, node: WikitextSyntaxNode): WikitextNode {
  const targetNode = childOfType(node, "redirect-target");
  const targetLink = childOfType(targetNode, "link-target");
  const target = targetLink
    ? syntaxTextDecoded(targetLink).trim()
    : decodeText(context.source.slice(node.range[0], node.range[1]))
        .replace(/^#redirect\s*:?\s*/iu, "")
        .replace(/^\[\[|\]\]$/gu, "")
        .trim();
  const { page, fragment } = splitTarget(target);
  return {
    type: "redirect",
    id: "",
    target,
    ...(page === undefined ? {} : { page }),
    ...(fragment === undefined ? {} : { fragment }),
    ...nodeLocation(context, { syntax: node }),
  };
}

interface SpecialResult {
  readonly nodes: readonly WikitextNode[];
  readonly consumedTo?: number;
}

function standaloneNode(
  context: NormalizeContext,
  node: WikitextSyntaxNode,
): WikitextNode | undefined {
  const converted = normalizeInlineSyntax(context, [node])[0];
  if (!converted) {
    return undefined;
  }
  const standalone = isStandaloneLine(context.source, node);
  if (converted.type === "template" || converted.type === "parserFunction") {
    if (!standalone) {
      return undefined;
    }
    return { ...converted, block: true };
  }
  if (node.type === "ext") {
    const name = (typeof node.props.name === "string" ? node.props.name : "").toLowerCase();
    if (BLOCK_EXT_TAGS.has(name)) {
      return converted;
    }
    if (!standalone || INLINE_EXT_TAGS.has(name)) {
      return undefined;
    }
    // 没有专门展示且独立成行的扩展按块级源码卡片处理，避免被并入前后段落。
    return converted.type === "extension" ? { ...converted, block: true } : undefined;
  }
  return undefined;
}

function specialBlock(
  context: NormalizeContext,
  node: WikitextSyntaxNode,
  index: number,
  nodes: readonly WikitextSyntaxNode[],
  depth: number,
  limit: number,
): SpecialResult | "skip" | undefined {
  const buildBlocks: BuildBlockNodes = (inner, innerLimit, innerDepth) =>
    normalizeBlocks(context, inner, innerLimit, innerDepth);
  switch (node.type) {
    case "html": {
      const tag = htmlTagName(node);
      if (classifyHtmlTag(tag) === "drop") {
        return "skip";
      }
      if (!isBlockHtmlStart(node)) {
        return undefined;
      }
      const result = normalizeHtmlBlock(context, nodes, index, depth, buildBlocks);
      return { nodes: [result.node], consumedTo: result.endOffset };
    }
    case "list":
    case "dd": {
      const result = normalizeList(context, node, nodes, buildBlocks, limit, depth);
      return {
        nodes: result.nodes,
        consumedTo: Math.min(result.endOffset, limit),
      };
    }
    case "table":
      return {
        nodes: [
          normalizeTable(
            context,
            node,
            (inner, innerLimit, innerDepth) => buildBlocks(inner, innerLimit, innerDepth),
            depth + 1,
          ),
        ],
        consumedTo: Math.min(node.range[1], limit),
      };
    case "heading":
      return { nodes: [headingNode(context, node)] };
    case "hr":
      return {
        nodes: [{ type: "thematicBreak", id: "", ...nodeLocation(context, { syntax: node }) }],
      };
    case "redirect":
      return { nodes: [redirectNode(context, node)] };
    case "file": {
      const data = parseFileData(context, node);
      if (!fileLayoutIsBlock(data.parameters)) {
        return undefined;
      }
      const converted = normalizeInlineSyntax(context, [node])[0];
      return converted?.type === "file"
        ? { nodes: [{ ...converted, block: true }], consumedTo: node.range[1] }
        : undefined;
    }
    case "template":
    case "magic-word":
    case "ext": {
      const converted = standaloneNode(context, node);
      return converted ? { nodes: [converted], consumedTo: node.range[1] } : undefined;
    }
    default:
      return undefined;
  }
}

const INVISIBLE_TYPES = new Set(["category", "behaviorSwitch", "comment"]);

function hasVisibleContent(nodes: readonly WikitextNode[]): boolean {
  return nodes.some(
    (node) => !INVISIBLE_TYPES.has(node.type) && (node.type !== "text" || node.value.trim() !== ""),
  );
}

export function normalizeBlocks(
  context: NormalizeContext,
  nodes: readonly WikitextSyntaxNode[],
  limit = context.source.length,
  depth = 0,
): WikitextNode[] {
  if (depth > context.maxDepth) {
    throw new WikitextParseError(
      "SOURCE_TOO_COMPLEX",
      `Block nesting depth exceeds the limit of ${context.maxDepth}.`,
    );
  }
  const source = context.source;
  const output: WikitextNode[] = [];
  let buffer: InlinePiece[] = [];

  const flush = (): void => {
    buffer = trimInlinePieces(buffer);
    if (!hasMeaningfulPieces(buffer)) {
      buffer = [];
      return;
    }
    const children = normalizeInlinePieces(context, buffer, { depth, limit });
    if (hasVisibleContent(children)) {
      output.push(paragraphNode(context, children));
    } else {
      // 分类、行为开关和注释不进入正文；单独成行时保留为根级节点供 HAST 与 playground 消费。
      output.push(...children.filter((child) => child.type !== "text"));
    }
    buffer = [];
  };

  const addText = (node: WikitextSyntaxNode, start: number, end: number): void => {
    const text = source.slice(start, end);
    const parts = splitParagraphText(text);
    let cursor = 0;
    for (const [index, part] of parts.entries()) {
      const at = text.indexOf(part, cursor);
      const partStart = at < 0 ? start + cursor : start + at;
      cursor = at < 0 ? cursor : at + part.length;
      if (index > 0) {
        flush();
      }
      if (part !== "") {
        // 保留行内空白（例如两个链接之间的单个空格）；段落边缘空白由 flush 裁剪。
        buffer.push({ kind: "syntax", syntax: node, text: part, start: partStart });
      }
    }
  };

  let consumedUntil = 0;
  for (const [index, node] of nodes.entries()) {
    if (node.range[0] >= limit) {
      break;
    }
    if (node.range[1] <= consumedUntil) {
      continue;
    }
    if (node.type === "text") {
      const start = Math.max(node.range[0], consumedUntil);
      const end = Math.min(node.range[1], limit);
      if (start < end) {
        addText(node, start, end);
      }
      continue;
    }
    if (node.range[0] < consumedUntil || SYNTAX_ONLY_TYPES.has(node.type)) {
      continue;
    }

    const special = specialBlock(context, node, index, nodes, depth, limit);
    if (special === "skip") {
      continue;
    }
    if (special) {
      flush();
      output.push(...special.nodes);
      if (special.consumedTo !== undefined) {
        consumedUntil = Math.max(consumedUntil, special.consumedTo);
      }
      continue;
    }

    buffer.push(...piecesFromNodes([node]));
  }
  flush();
  return output;
}
