import type { WikitextSyntaxNode } from "../ast/model";
import { BLOCK_EXT_TAGS, classifyHtmlTag, htmlTagName } from "./html";

const BLOCK_NODE_TYPES: ReadonlySet<string> = new Set([
  "heading",
  "hr",
  "table",
  "list",
  "dd",
  "redirect",
]);

function extensionName(node: WikitextSyntaxNode): string {
  return (typeof node.props.name === "string" ? node.props.name : "").toLowerCase();
}

/**
 * 该语法节点是否必须按块级归一化：块级结构、块级扩展、块级或禁止的 HTML。
 * html-block 与 tables 共用，避免两处各维护一份“块内容”判断。
 */
export function isBlockLevelNode(node: WikitextSyntaxNode): boolean {
  if (BLOCK_NODE_TYPES.has(node.type)) {
    return true;
  }
  if (node.type === "ext") {
    return BLOCK_EXT_TAGS.has(extensionName(node));
  }
  if (node.type === "html") {
    const kind = classifyHtmlTag(htmlTagName(node));
    return kind === "block" || kind === "banned";
  }
  return false;
}

/** 给定子节点中是否存在需要块级归一化的内容。 */
export function needsBlockNormalization(nodes: readonly WikitextSyntaxNode[]): boolean {
  return nodes.some(isBlockLevelNode);
}
