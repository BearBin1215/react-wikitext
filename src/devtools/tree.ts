import type {
  WikitextNode,
  WikitextParentNode,
  WikitextRange,
  WikitextRoot,
  WikitextSnapshotBase,
  WikitextSyntaxNode,
  WikitextSyntaxRoot,
} from "../ast/model";
import { flattenNodes } from "../ast/query";
import { getSpanText } from "../ast/sourceGraph/query";

function isWikitextParentNode(node: WikitextNode): node is WikitextParentNode {
  return Array.isArray((node as { readonly children?: unknown }).children);
}

/** 调试组件可以读取的快照形状；解析快照与渲染快照都满足。 */
export interface AstTreeDocument extends Pick<
  WikitextSnapshotBase,
  "graph" | "activeSourceId" | "source"
> {
  readonly ast: WikitextRoot;
  /** 只有 `retainSyntax: true` 的解析快照会保留源码语法树。 */
  readonly syntax?: WikitextSyntaxRoot;
}

/** 调试组件可以展示的树类型。 */
export type AstTreeKind = "semantic" | "syntax";

/** 调试组件可以展示的节点；语义节点与源码语法节点共用树结构。 */
export type AstTreeNode = WikitextNode | WikitextSyntaxNode;

/** 节点在树中的位置信息；不依赖 id 的路径格式，自定义 adapter 也能用。 */
export interface TreeEntry {
  readonly node: AstTreeNode;
  readonly depth: number;
  readonly parentId?: string;
  readonly hasChildren: boolean;
}

/** 一次遍历得到的树索引。 */
export interface TreeIndex {
  readonly entries: readonly TreeEntry[];
  readonly byId: ReadonlyMap<string, TreeEntry>;
}

const flattenCache = new WeakMap<object, readonly AstTreeNode[]>();
const indexCache = new WeakMap<object, TreeIndex>();

/** 判断节点是否来自源码语法树。 */
export function isSyntaxNode(node: AstTreeNode): node is WikitextSyntaxNode {
  return "props" in node && "range" in node && Array.isArray(node.attributes);
}

/** 读取节点的子节点；两种树共用。 */
export function childrenOf(node: AstTreeNode): readonly AstTreeNode[] {
  return isSyntaxNode(node) ? node.children : isWikitextParentNode(node) ? node.children : [];
}

/** 按先序展开任意一棵树，并按根节点缓存结果。 */
export function flattenTree(root: AstTreeNode): readonly AstTreeNode[] {
  const cached = flattenCache.get(root);
  if (cached) {
    return cached;
  }
  const result: AstTreeNode[] = [];
  const visit = (node: AstTreeNode): void => {
    result.push(node);
    for (const child of childrenOf(node)) {
      visit(child);
    }
  };
  visit(root);
  flattenCache.set(root, result);
  return result;
}

/** 读取指定树类型的根节点。 */
export function treeRoot(document: AstTreeDocument, kind: AstTreeKind): AstTreeNode | undefined {
  return kind === "syntax" ? document.syntax : document.ast;
}

/** 按树类型展开文档；语义树复用 `flattenNodes` 的缓存。 */
export function flattenTreeOf(
  document: AstTreeDocument,
  kind: AstTreeKind,
): readonly AstTreeNode[] {
  const root = treeRoot(document, kind);
  if (!root) {
    return [];
  }
  return kind === "syntax" ? flattenTree(root) : flattenNodes(root as WikitextRoot);
}

/** 建立深度与父节点索引；同一根节点只遍历一次。 */
export function buildTreeIndex(root: AstTreeNode | undefined): TreeIndex {
  if (!root) {
    return { entries: [], byId: new Map() };
  }
  const cached = indexCache.get(root);
  if (cached) {
    return cached;
  }
  const entries: TreeEntry[] = [];
  const byId = new Map<string, TreeEntry>();
  const visit = (node: AstTreeNode, depth: number, parentId: string | undefined): void => {
    const children = childrenOf(node);
    const entry: TreeEntry = {
      node,
      depth,
      hasChildren: children.length > 0,
      ...(parentId === undefined ? {} : { parentId }),
    };
    entries.push(entry);
    byId.set(node.id, entry);
    for (const child of children) {
      visit(child, depth + 1, node.id);
    }
  };
  visit(root, 0, undefined);
  const index: TreeIndex = { entries, byId };
  indexCache.set(root, index);
  return index;
}

/**
 * 节点在活动源码中的区间；生成节点没有区间。
 *
 * 语法节点使用 parser 偏移；语义节点使用 origin 的偏移，二者都针对活动文本源。
 */
export function nodeRange(node: AstTreeNode): WikitextRange | undefined {
  return isSyntaxNode(node)
    ? node.range
    : node.origin
      ? [node.origin.start, node.origin.end]
      : undefined;
}

/** 节点对应的源码文本；语法节点直接切片，语义节点按来源图读取。 */
export function nodeSource(document: AstTreeDocument, node: AstTreeNode): string {
  if (isSyntaxNode(node)) {
    return document.source.slice(node.range[0], node.range[1]);
  }
  return node.origin ? getSpanText(document.graph, node.origin) : "";
}

/** 从节点一路向上收集祖先 id，用于展开外部选中项的路径。 */
export function ancestorIds(index: TreeIndex, id: string): string[] {
  const result: string[] = [];
  let parent = index.byId.get(id)?.parentId;
  while (parent !== undefined) {
    result.push(parent);
    parent = index.byId.get(parent)?.parentId;
  }
  // oxlint-disable-next-line unicorn/no-array-reverse -- ES2022 target has no toReversed
  return result.reverse();
}
