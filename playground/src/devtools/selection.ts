import type { WikitextDocument, WikitextRange } from "react-wikitext/ast";
import {
  buildTreeIndex,
  flattenTreeOf,
  nodeRange,
  treeRoot,
  type DevtreeKind,
  type DevtreeNode,
} from "./tree";

export type { DevtreeKind, DevtreeNode } from "./tree";

/** 用于在文档更新后恢复选中节点的快照。 */
export interface SelectionSnapshot {
  readonly id: string;
  readonly type: string;
  readonly start: number;
  readonly end: number;
}

/** 在指定的树中按 id 查找节点；使用一次遍历建立的索引。 */
export function findDevtreeNode(
  document: WikitextDocument,
  id: string,
  kind: DevtreeKind,
): DevtreeNode | undefined {
  const root = treeRoot(document, kind);
  if (!root) {
    return undefined;
  }
  return buildTreeIndex(root).byId.get(id)?.node;
}

/** 记录当前选中节点的类型与区间，供文档变化后恢复。 */
export function snapshotSelection(
  document: WikitextDocument,
  id: string | undefined,
  kind: DevtreeKind = "semantic",
): SelectionSnapshot | undefined {
  if (!id) {
    return undefined;
  }
  const node = findDevtreeNode(document, id, kind);
  const range = node ? nodeRange(node) : undefined;
  if (!node || !range) {
    return undefined;
  }
  return { id, type: node.type, start: range[0], end: range[1] };
}

function bestMatch(
  nodes: readonly DevtreeNode[],
  type: string,
  start: number,
): DevtreeNode | undefined {
  const candidates: Array<{ node: DevtreeNode; range: WikitextRange }> = [];
  for (const node of nodes) {
    if (node.type !== type) {
      continue;
    }
    const range = nodeRange(node);
    if (range && range[1] > range[0]) {
      candidates.push({ node, range });
    }
  }
  const exact = candidates.find((entry) => entry.range[0] === start);
  if (exact) {
    return exact.node;
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

/** 在新文档中寻找与快照最接近的节点，返回它的 id。 */
export function restoreSelectedId(
  document: WikitextDocument,
  snapshot: SelectionSnapshot | undefined,
  kind: DevtreeKind = "semantic",
): string | undefined {
  if (!snapshot || snapshot.start === snapshot.end) {
    return undefined;
  }
  return bestMatch(flattenTreeOf(document, kind), snapshot.type, snapshot.start)?.id;
}

/** 文档更新后，按节点类型与起始 offset 尽量保留原来的展开集合。 */
export function remapExpandedIds(
  oldDocument: WikitextDocument,
  newDocument: WikitextDocument,
  ids: ReadonlySet<string>,
  kind: DevtreeKind = "semantic",
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
  const remapped = new Set<string>();
  for (const id of ids) {
    const entry = oldIndex.byId.get(id);
    const range = entry ? nodeRange(entry.node) : undefined;
    if (!entry || !range) {
      continue;
    }
    const match = bestMatch(newNodes, entry.node.type, range[0]);
    if (match) {
      remapped.add(match.id);
    }
  }
  return remapped;
}
