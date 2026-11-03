import { useMemo } from "react";
import type { WikitextDocument } from "react-wikitext/ast";
import { flattenTreeOf, nodeSource, type DevtreeKind, type DevtreeNode } from "./tree";

/** 搜索时可以命中的节点说明文字。 */
export type NodeLabeler = (node: DevtreeNode) => string;

/** 单个搜索结果。 */
export interface AstTreeSearchResult {
  readonly node: DevtreeNode;
  readonly source: string;
}

const RESULT_LIMIT = 80;

/**
 * 在指定树中按类型、说明文字与源码搜索节点。
 * 空查询返回空数组；结果按先序截断，避免大文档卡顿。
 */
export function useAstTreeSearch(
  document: WikitextDocument,
  kind: DevtreeKind,
  query: string,
  labelOf: NodeLabeler,
): readonly AstTreeSearchResult[] {
  const normalized = query.trim().toLowerCase();
  return useMemo(() => {
    if (!normalized) {
      return [];
    }
    const results: AstTreeSearchResult[] = [];
    for (const node of flattenTreeOf(document, kind)) {
      const source = nodeSource(document, node);
      if (
        node.type.toLowerCase().includes(normalized) ||
        labelOf(node).toLowerCase().includes(normalized) ||
        source.toLowerCase().includes(normalized)
      ) {
        results.push({ node, source });
        if (results.length >= RESULT_LIMIT) {
          break;
        }
      }
    }
    return results;
  }, [document, kind, normalized, labelOf]);
}
