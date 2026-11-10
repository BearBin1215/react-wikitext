import { useMemo } from "react";
import {
  flattenTreeOf,
  nodeRange,
  type AstTreeDocument,
  type AstTreeKind,
  type AstTreeNode,
} from "./tree";

/** 搜索时可以命中的节点说明文字。 */
export type NodeLabeler = (node: AstTreeNode) => string;

/** 单个搜索结果。 */
export interface AstTreeSearchResult {
  readonly node: AstTreeNode;
  readonly source: string;
}

/** 搜索结果；超过数量上限时 `truncated` 为真。 */
export interface AstTreeSearchState {
  readonly results: readonly AstTreeSearchResult[];
  readonly truncated: boolean;
}

interface SearchEntry extends AstTreeSearchResult {
  readonly typeLower: string;
  readonly sourceLower: string;
}

const RESULT_LIMIT = 80;
const SOURCE_LIMIT = 512;

const entryCache = new WeakMap<AstTreeDocument, Map<AstTreeKind, readonly SearchEntry[]>>();

function entriesOf(document: AstTreeDocument, kind: AstTreeKind): readonly SearchEntry[] {
  let byKind = entryCache.get(document);
  if (!byKind) {
    byKind = new Map();
    entryCache.set(document, byKind);
  }
  const cached = byKind.get(kind);
  if (cached) {
    return cached;
  }
  const entries = flattenTreeOf(document, kind).map((node): SearchEntry => {
    const range = nodeRange(node);
    const source = range
      ? document.source.slice(range[0], Math.min(range[1], range[0] + SOURCE_LIMIT))
      : "";
    return {
      node,
      source,
      typeLower: node.type.toLowerCase(),
      sourceLower: source.toLowerCase(),
    };
  });
  byKind.set(kind, entries);
  return entries;
}

const EMPTY: AstTreeSearchState = { results: [], truncated: false };

/**
 * 在指定树中按类型、说明文字与源码片段搜索节点。
 * 空查询返回空结果；结果按先序截断，避免大文档一次性渲染过多条目。
 */
export function useAstTreeSearch(
  document: AstTreeDocument,
  kind: AstTreeKind,
  query: string,
  labelOf: NodeLabeler,
): AstTreeSearchState {
  const normalized = query.trim().toLowerCase();
  return useMemo(() => {
    if (!normalized) {
      return EMPTY;
    }
    const results: AstTreeSearchResult[] = [];
    let truncated = false;
    for (const entry of entriesOf(document, kind)) {
      const matches =
        entry.typeLower.includes(normalized) ||
        labelOf(entry.node).toLowerCase().includes(normalized) ||
        entry.sourceLower.includes(normalized);
      if (!matches) {
        continue;
      }
      if (results.length >= RESULT_LIMIT) {
        truncated = true;
        break;
      }
      results.push({ node: entry.node, source: entry.source });
    }
    return { results, truncated };
  }, [document, kind, normalized, labelOf]);
}
