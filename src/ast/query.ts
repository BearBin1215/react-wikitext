import {
  isWikitextParentNode,
  type WikitextNode,
  type WikitextNodeType,
  type WikitextOrigin,
  type WikitextParentNode,
  type WikitextRoot,
  type WikitextSnapshotBase,
} from "./model";
import { getSpanText } from "./sourceGraph/query";

/** 只需要语义树与来源图的快照结构，便于复用查询函数。 */
export interface SourceSnapshotLike extends Pick<WikitextSnapshotBase, "graph" | "activeSourceId"> {
  readonly source: string;
  readonly ast: WikitextRoot;
}

const indexCache = new WeakMap<object, Map<string, WikitextNode>>();
const flatCache = new WeakMap<object, readonly WikitextNode[]>();

/**
 * 清除该根节点的查询缓存；仅在工作树结构或 id 改变后由库内部调用。
 * @param root 需要失效的语义树根节点。
 */
export function clearQueryCache(root: WikitextRoot): void {
  flatCache.delete(root);
  indexCache.delete(root);
}

/** 按先序展开语义树，并缓存结果。 */
export function flattenNodes(root: WikitextRoot): readonly WikitextNode[] {
  const cached = flatCache.get(root);
  if (cached) {
    return cached;
  }
  const result: WikitextNode[] = [];
  const visit = (node: WikitextNode): void => {
    result.push(node);
    if (isWikitextParentNode(node)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  visit(root);
  flatCache.set(root, result);
  return result;
}

function getNodeIndex(root: WikitextRoot): Map<string, WikitextNode> {
  const cached = indexCache.get(root);
  if (cached) {
    return cached;
  }
  const index = new Map<string, WikitextNode>();
  for (const node of flattenNodes(root)) {
    index.set(node.id, node);
  }
  indexCache.set(root, index);
  return index;
}

/** 按 id 查找语义节点。 */
export function findNodeById(root: WikitextRoot, id: string): WikitextNode | undefined {
  return getNodeIndex(root).get(id);
}

/** 读取节点对应的来源源码；生成内容没有来源时返回空字符串。 */
export function getSourceText(
  snapshot: Pick<WikitextSnapshotBase, "graph">,
  node: { readonly origin?: WikitextOrigin },
): string {
  if (!node.origin) {
    return "";
  }
  return getSpanText(snapshot.graph, node.origin);
}

/** 读取节点转换后的语义文本，不做实体解码。 */
export function toPlainText(node: WikitextNode): string {
  switch (node.type) {
    case "text":
    case "code":
      return node.value;
    case "comment":
    case "unknown":
    case "thematicBreak":
      return "";
    case "category":
    case "behaviorSwitch":
      return "";
    case "template":
    case "parserFunction":
    case "file":
      return node.name;
    case "extension":
      return node.raw ?? joinChildren(node);
    case "reference":
      return joinChildren(node);
    case "link":
      return node.children.length > 0 ? joinChildren(node) : node.target;
    default:
      return isWikitextParentNode(node) ? joinChildren(node) : "";
  }
}

function joinChildren(node: WikitextParentNode): string {
  return node.children.map((child) => toPlainText(child)).join("");
}

/** 查找节点时的选项。 */
export interface FindNodeAtOffsetOptions {
  /** 是否让零长度节点参与选中，默认跳过。 */
  includeZeroLength?: boolean;
}

/**
 * 返回包含该 offset 的最深语义节点。
 *
 * 只考虑活动文本源中的来源；范围按 `[start, end)` 处理，文档末尾回退到根节点。
 * @param snapshot 快照。
 * @param offset 活动源码中的 UTF-16 offset。
 * @param options 查询选项。
 */
export function findNodeAtOffset(
  snapshot: SourceSnapshotLike,
  offset: number,
  options: FindNodeAtOffsetOptions = {},
): WikitextNode | undefined {
  let best: WikitextNode | undefined;
  let bestSpan = Number.POSITIVE_INFINITY;
  for (const node of flattenNodes(snapshot.ast)) {
    const origin = node.origin;
    if (!origin || origin.sourceId !== snapshot.activeSourceId) {
      continue;
    }
    if (!options.includeZeroLength && origin.end === origin.start) {
      continue;
    }
    const contains =
      origin.end === origin.start
        ? offset === origin.start
        : offset >= origin.start && offset < origin.end;
    if (!contains) {
      continue;
    }
    const span = origin.end - origin.start;
    if (span <= bestSpan) {
      best = node;
      bestSpan = span;
    }
  }
  if (!best && offset === snapshot.source.length) {
    return snapshot.ast;
  }
  return best;
}

/** 收窄节点类型，便于在条件分支中直接访问特定字段。 */
export function isNodeType<TType extends WikitextNodeType>(
  node: WikitextNode,
  type: TType,
): node is Extract<WikitextNode, { type: TType }> {
  return node.type === type;
}
