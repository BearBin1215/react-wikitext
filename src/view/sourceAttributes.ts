import type { WikitextNode, WikitextRenderSnapshot } from "../ast/model";
import type { WikitextSourceAttributes, WikitextSourceAttributesMode } from "./types";

/** 块级展示的语义节点类型；依据语义与转换结构，不依据站点 CSS。 */
const BLOCK_NODE_TYPES: ReadonlySet<string> = new Set([
  "paragraph",
  "heading",
  "list",
  "listItem",
  "definitionList",
  "definitionTerm",
  "definitionDescription",
  "table",
  "tableCaption",
  "tableRow",
  "tableCell",
  "reference",
]);

function isBlockNode(node: WikitextNode): boolean {
  if (BLOCK_NODE_TYPES.has(node.type)) {
    return true;
  }
  if (node.type === "extension" || node.type === "unknown" || node.type === "file") {
    return node.block === true;
  }
  if (node.type === "htmlElement") {
    return node.block;
  }
  return false;
}

/**
 * 生成单个元素的源码定位属性。
 *
 * 复杂、多源或生成节点只输出真实存在的身份与来源；不把多个范围压成一个字符串。
 * @param mode 属性模式。
 * @param snapshot 当前渲染快照。
 * @param node 承载该元素的语义节点。
 */
export function sourceAttributes(
  mode: WikitextSourceAttributesMode,
  snapshot: WikitextRenderSnapshot,
  node: WikitextNode | undefined,
): WikitextSourceAttributes {
  if (mode === "none" || !node) {
    return {};
  }
  if (mode === "block" && !isBlockNode(node)) {
    return {};
  }
  const attributes: Record<string, string> = {
    "data-wikitext-snapshot": snapshot.id,
    "data-wikitext-node": node.id,
  };
  const origin = node.origin;
  if (origin && origin.sourceId === snapshot.activeSourceId) {
    attributes["data-wikitext-source"] = origin.sourceId;
    attributes["data-wikitext-start"] = String(origin.start);
    attributes["data-wikitext-end"] = String(origin.end);
  }
  return attributes as WikitextSourceAttributes;
}
