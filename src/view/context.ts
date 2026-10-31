import { createContext, useContext, useMemo } from "react";
import type { ElementContent, Root, RootContent } from "hast";
import type { Components } from "hast-util-to-jsx-runtime";
import { isWikitextParentNode, type WikitextNode, type WikitextRenderDocument } from "../ast/model";
import { hastNodeId } from "../shared/hast";
import type { WikitextHtmlComponents, WikitextSemanticComponents } from "./types";

/** 视图上下文值；由 `<WikitextView>` 创建，`useWikitextContext` 读取。 */
export interface WikitextViewContextValue {
  /** 当前渲染的文档。 */
  readonly document: WikitextRenderDocument;
  /** 语义节点 id 到节点的索引。 */
  readonly semanticIndex: ReadonlyMap<string, WikitextNode>;
  /** 语义节点 id 到 HAST 节点的索引。 */
  readonly hastIndex: ReadonlyMap<string, ElementContent>;
  /** 按标签名覆盖的 HTML 组件。 */
  readonly components: WikitextHtmlComponents;
  /** 按语义节点类型覆盖的组件。 */
  readonly semanticComponents: WikitextSemanticComponents;
  /** 本次渲染使用的标签桥接表；`WikitextFragment` 复用同一份。 */
  readonly bridgeComponents: Partial<Components>;
  /** 当前实例的标题 id 前缀。 */
  readonly idPrefix: string;
  /** 把逻辑 id 映射为当前实例的 DOM id。 */
  readonly mapId: (id: string) => string;
  /** 把文档内的 `#fragment` 地址映射到当前实例。 */
  readonly mapHref: (href: string) => string;
  /** 单个块渲染失败时的回调。 */
  readonly onRenderError?: (error: Error, info: { node: WikitextNode }) => void;
}

/** 视图上下文；未包裹在 `<WikitextView>` 中时为 null。 */
export const WikitextViewContext = createContext<WikitextViewContextValue | null>(null);

/** 读取视图上下文；不在 `<WikitextView>` 内调用时会抛出异常。 */
export function useWikitextContext(): WikitextViewContextValue {
  const context = useContext(WikitextViewContext);
  if (!context) {
    throw new Error("Wikitext components must be rendered inside <WikitextView>.");
  }
  return context;
}

/** 读取当前文档的渲染文案。 */
export function useWikitextLabels() {
  return useWikitextContext().document.meta.labels;
}

/** 把逻辑 id 与地址映射为当前实例的值。 */
export interface WikitextInstanceIds {
  /** 逻辑 id 转 DOM id。 */
  toDomId(id: string): string;
  /** 文档内地址转当前实例的地址。 */
  toHref(href: string): string;
}

/** 读取当前实例的 id 映射函数；引用保持稳定，避免每次渲染产生新对象。 */
export function useWikitextIds(): WikitextInstanceIds {
  const context = useWikitextContext();
  return useMemo(
    () => ({ toDomId: context.mapId, toHref: context.mapHref }),
    [context.mapId, context.mapHref],
  );
}

/**
 * 建立语义节点 id 到节点的索引。
 * @param document 渲染快照。
 */
export function createSemanticIndex(document: WikitextRenderDocument): Map<string, WikitextNode> {
  const index = new Map<string, WikitextNode>();
  const visit = (node: WikitextNode): void => {
    index.set(node.id, node);
    if (isWikitextParentNode(node)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  visit(document.ast);
  return index;
}

/**
 * 建立语义节点 id 到 HAST 节点的索引。
 * @param root 待索引的 HAST 根节点或单个节点。
 */
export function createHastIndex(root: RootContent | Root): Map<string, ElementContent> {
  const index = new Map<string, ElementContent>();
  const visit = (node: RootContent): void => {
    if (node.type === "doctype") {
      return;
    }
    const id = hastNodeId(node);
    if (id && !index.has(id)) {
      index.set(id, node);
    }
    if (node.type === "element") {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  if (root.type === "root") {
    for (const child of root.children) {
      visit(child);
    }
  } else {
    visit(root);
  }
  return index;
}
