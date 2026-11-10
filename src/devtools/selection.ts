import type { WikitextRange } from "../ast/model";
import {
  buildTreeIndex,
  flattenTreeOf,
  nodeRange,
  treeRoot,
  type AstTreeDocument,
  type AstTreeKind,
  type AstTreeNode,
} from "./tree";

/** 用于在文档更新后恢复选中节点的快照。 */
export interface SelectionSnapshot {
  /** 节点所属的树；恢复时默认沿用。 */
  readonly kind: AstTreeKind;
  readonly id: string;
  readonly type: string;
  readonly start: number;
  readonly end: number;
}

interface MatchIndex {
  readonly exact: ReadonlyMap<string, AstTreeNode>;
  readonly byType: ReadonlyMap<string, readonly { node: AstTreeNode; range: WikitextRange }[]>;
}

function matchKey(type: string, start: number, end: number): string {
  return `${type}\u0000${start}\u0000${end}`;
}

function buildMatchIndex(nodes: readonly AstTreeNode[]): MatchIndex {
  const exact = new Map<string, AstTreeNode>();
  const byType = new Map<string, { node: AstTreeNode; range: WikitextRange }[]>();
  for (const node of nodes) {
    const range = nodeRange(node);
    if (!range || range[1] <= range[0]) {
      continue;
    }
    const key = matchKey(node.type, range[0], range[1]);
    if (!exact.has(key)) {
      exact.set(key, node);
    }
    const group = byType.get(node.type);
    if (group) {
      group.push({ node, range });
    } else {
      byType.set(node.type, [{ node, range }]);
    }
  }
  return { exact, byType };
}

function bestMatch(
  index: MatchIndex,
  type: string,
  start: number,
  end: number,
): AstTreeNode | undefined {
  const exact = index.exact.get(matchKey(type, start, end));
  if (exact) {
    return exact;
  }
  const candidates = index.byType.get(type) ?? [];
  const sameStart = candidates.filter((entry) => entry.range[0] === start);
  if (sameStart.length > 0) {
    const closest = [...sameStart];
    // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 target has no toSorted
    closest.sort((left, right) => Math.abs(left.range[1] - end) - Math.abs(right.range[1] - end));
    return closest[0]?.node;
  }
  // 区间按 `[start, end)` 处理，避免相邻同类型节点在边界上互相命中。
  const containing = candidates
    .filter((entry) => entry.range[0] <= start && start < entry.range[1])
    // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 target has no toSorted
    .sort((left, right) => left.range[1] - left.range[0] - (right.range[1] - right.range[0]));
  if (containing[0]) {
    return containing[0].node;
  }
  const sorted = [...candidates];
  // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 target has no toSorted
  sorted.sort((left, right) => Math.abs(left.range[0] - start) - Math.abs(right.range[0] - start));
  return sorted[0]?.node;
}

/** 在指定的树中按 id 查找节点；空 id 直接返回 `undefined`。 */
export function findAstTreeNode(
  document: AstTreeDocument,
  id: string | null | undefined,
  kind: AstTreeKind,
): AstTreeNode | undefined {
  if (!id) {
    return undefined;
  }
  const root = treeRoot(document, kind);
  if (!root) {
    return undefined;
  }
  return buildTreeIndex(root).byId.get(id)?.node;
}

/** 记录当前选中节点的类型与区间，供文档变化后恢复。 */
export function snapshotSelection(
  document: AstTreeDocument,
  id: string | null | undefined,
  kind: AstTreeKind = "semantic",
): SelectionSnapshot | undefined {
  if (!id) {
    return undefined;
  }
  const node = findAstTreeNode(document, id, kind);
  const range = node ? nodeRange(node) : undefined;
  if (!node || !range || range[1] <= range[0]) {
    return undefined;
  }
  return { kind, id, type: node.type, start: range[0], end: range[1] };
}

/** 在新文档中寻找与快照最接近的节点，返回它的 id。 */
export function restoreSelectedId(
  document: AstTreeDocument,
  snapshot: SelectionSnapshot | undefined,
  kind: AstTreeKind = snapshot?.kind ?? "semantic",
): string | undefined {
  if (!snapshot || snapshot.kind !== kind || snapshot.end <= snapshot.start) {
    return undefined;
  }
  const index = buildMatchIndex(flattenTreeOf(document, kind));
  return bestMatch(index, snapshot.type, snapshot.start, snapshot.end)?.id;
}

/** 文档更新后，按节点类型与源码区间尽量保留原来的展开集合。 */
export function remapExpandedIds(
  oldDocument: AstTreeDocument,
  newDocument: AstTreeDocument,
  ids: ReadonlySet<string>,
  kind: AstTreeKind = "semantic",
): Set<string> {
  const oldRoot = treeRoot(oldDocument, kind);
  if (!oldRoot || ids.size === 0) {
    return new Set();
  }
  const oldIndex = buildTreeIndex(oldRoot);
  const newNodes = flattenTreeOf(newDocument, kind);
  if (newNodes.length === 0) {
    return new Set();
  }
  const newIndex = buildMatchIndex(newNodes);
  const remapped = new Set<string>();
  for (const id of ids) {
    const entry = oldIndex.byId.get(id);
    const range = entry ? nodeRange(entry.node) : undefined;
    if (!entry || !range || range[1] <= range[0]) {
      continue;
    }
    const match = bestMatch(newIndex, entry.node.type, range[0], range[1]);
    if (match) {
      remapped.add(match.id);
    }
  }
  return remapped;
}
