import { isWikitextParentNode, type WikitextNode, type WikitextRoot } from "./model";

interface MutableIdNode {
  id: string;
}

/**
 * 为语义树重新分配路径式 id，保证插件复制、插入节点后仍唯一。
 * 编辑后的 id 只在一份快照内有效，不承诺跨解析稳定。
 */
export function assignSemanticIds(root: WikitextRoot): void {
  const walk = (node: WikitextNode, path: string): void => {
    (node as unknown as MutableIdNode).id = path;
    if (isWikitextParentNode(node)) {
      for (const [index, child] of node.children.entries()) {
        walk(child, `${path}.${index}`);
      }
    }
  };
  walk(root, "0");
}

/** 深拷贝语义树，用于在插件处理前隔离原始快照。 */
export function cloneSemanticTree(root: WikitextRoot): WikitextRoot {
  return structuredClone(root);
}
