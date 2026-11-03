import type {
  WikitextDocument,
  WikitextNode,
  WikitextParentNode,
  WikitextRange,
  WikitextSyntaxNode,
} from "react-wikitext/ast";
import { flattenNodes, getSourceText } from "react-wikitext/ast";

function isWikitextParentNode(node: WikitextNode): node is WikitextParentNode {
  return Array.isArray((node as { readonly children?: unknown }).children);
}

/** 调试面板可以查看的树类型。 */
export type DevtreeKind = "semantic" | "syntax";

/** 调试面板可以展示的节点。 */
export type DevtreeNode = WikitextNode | WikitextSyntaxNode;

/** 节点在树中的位置信息；不依赖 id 的路径格式，自定义 adapter 也能用。 */
export interface TreeEntry {
  readonly node: DevtreeNode;
  readonly depth: number;
  readonly parentId?: string;
  readonly hasChildren: boolean;
}

/** 一次遍历得到的树索引。 */
export interface TreeIndex {
  readonly entries: readonly TreeEntry[];
  readonly byId: ReadonlyMap<string, TreeEntry>;
  readonly root?: DevtreeNode;
}

const flattenCache = new WeakMap<object, readonly DevtreeNode[]>();
const indexCache = new WeakMap<object, TreeIndex>();

/** 判断节点是否来自源码语法树。 */
export function isSyntaxNode(node: DevtreeNode): node is WikitextSyntaxNode {
  return "props" in node && "range" in node;
}

/** 读取节点的子节点；两种树共用。 */
export function childrenOf(node: DevtreeNode): readonly DevtreeNode[] {
  return isSyntaxNode(node) ? node.children : isWikitextParentNode(node) ? node.children : [];
}

/** 按先序展开任意一棵树，并按根节点缓存结果。 */
export function flattenTree(root: DevtreeNode): readonly DevtreeNode[] {
  const cached = flattenCache.get(root);
  if (cached) {
    return cached;
  }
  const result: DevtreeNode[] = [];
  const visit = (node: DevtreeNode): void => {
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
export function treeRoot(document: WikitextDocument, kind: DevtreeKind): DevtreeNode | undefined {
  return kind === "syntax" ? document.syntax : document.ast;
}

/** 按树类型展开文档；语义树复用 `flattenNodes` 的缓存。 */
export function flattenTreeOf(
  document: WikitextDocument,
  kind: DevtreeKind,
): readonly DevtreeNode[] {
  const root = treeRoot(document, kind);
  if (!root) {
    return [];
  }
  return kind === "syntax" ? flattenTree(root) : flattenNodes(root as never);
}

/** 建立深度与父节点索引；同一根节点只遍历一次。 */
export function buildTreeIndex(root: DevtreeNode | undefined): TreeIndex {
  if (!root) {
    return { entries: [], byId: new Map() };
  }
  const cached = indexCache.get(root);
  if (cached) {
    return cached;
  }
  const entries: TreeEntry[] = [];
  const byId = new Map<string, TreeEntry>();
  const visit = (node: DevtreeNode, depth: number, parentId: string | undefined): void => {
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
  const index: TreeIndex = { entries, byId, root };
  indexCache.set(root, index);
  return index;
}

/** 节点对应的源码区间；生成节点没有区间。 */
export function nodeRange(node: DevtreeNode): WikitextRange | undefined {
  return isSyntaxNode(node) ? node.range : node.origin?.range;
}

/** 节点对应的源码文本；语法节点直接切片，语义节点优先使用 origin。 */
export function nodeSource(document: WikitextDocument, node: DevtreeNode): string {
  if (isSyntaxNode(node)) {
    return document.source.slice(node.range[0], node.range[1]);
  }
  return getSourceText(document, node);
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
