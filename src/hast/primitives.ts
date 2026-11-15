import type { Element, ElementContent, Properties, Text } from "hast";
import type {
  WikitextAttribute,
  WikitextDiagnostic,
  WikitextDiagnosticCode,
  WikitextNode,
  WikitextReference,
} from "../ast/model";
import { getSourceText } from "../ast/query";
import { sanitizedAttributesToProps } from "./sanitize";
import type {
  WikitextHastData,
  WikitextHastMeta,
  WikitextToHastContext,
  WikitextTocMode,
} from "./types";

/** 引用状态在 context 上的私有槽位。 */
export const REFERENCE_STATE = Symbol("wikitext.references");
/** 链接状态在 context 上的私有槽位。 */
export const LINK_STATE = Symbol("wikitext.links");
/** 目录状态在 context 上的私有槽位。 */
export const TOC_STATE = Symbol("wikitext.toc");

/** 单条引用的编号、分组与出现次数。 */
export interface ReferenceEntry {
  readonly node: WikitextReference;
  readonly number: number;
  readonly group: string;
  /** Cite 1.43 的全局 key：命名引用首次出现时分配，重复引用不增加。 */
  readonly key: number;
  readonly name?: string;
  occurrences: number;
}

/** 一个引用分组的已收集条目。 */
export interface ReferenceGroupState {
  readonly name: string;
  readonly entries: ReferenceEntry[];
  readonly definitions: Map<string, ReferenceEntry>;
}

/** 整篇文档的引用收集状态。 */
export interface ReferenceState {
  readonly groups: Map<string, ReferenceGroupState>;
  buildingList: boolean;
  nextKey: number;
}

/** 链接自动编号状态。 */
export interface LinkState {
  nextAutonumber: number;
}

/** 目录模式；在转换开始时固定。 */
export interface TocState {
  readonly mode: WikitextTocMode;
}

/**
 * 转换阶段的内部上下文：公共回调 + 本次转换的私有状态与递归入口。
 * 只在本模块与各个 `toHast` 子模块之间使用，不进入公共类型。
 */
export type BuildContext = WikitextToHastContext & {
  readonly [REFERENCE_STATE]: ReferenceState;
  readonly [LINK_STATE]: LinkState;
  readonly [TOC_STATE]: TocState;
  readonly authorizedImages: Set<string>;
  readonly diagnostics: WikitextDiagnostic[];
  readonly convert: (node: WikitextNode) => ElementContent | ElementContent[] | null;
  readonly convertChildren: (nodes: readonly WikitextNode[]) => ElementContent[];
};

/** 生成 HAST 节点的来源元数据。 */
export function mark(node: WikitextNode): { wikitext: WikitextHastMeta } {
  return {
    wikitext: {
      id: node.id,
      type: node.type,
      ...(node.origin ? { origin: node.origin } : {}),
      ...(node.origin ? {} : { generated: true }),
    },
  };
}

/** 创建文本节点。 */
export function textNode(value: string, data?: WikitextHastData): Text {
  return { type: "text", value, ...(data ? { data } : {}) };
}

/** 创建元素节点，并按需附带来源。 */
export function element(
  tagName: string,
  properties: Properties,
  children: ElementContent[],
  node?: WikitextNode,
): Element {
  return {
    type: "element",
    tagName,
    properties,
    children,
    ...(node ? { data: mark(node) } : {}),
  };
}

/** 拆分并过滤 class 名。 */
export function classNames(...names: string[]): string[] {
  return names.flatMap((name) => name.split(/\s+/u)).filter(Boolean);
}

/** 合并 class 名，保留已有顺序。 */
export function withClassName(properties: Properties, ...names: string[]): Properties {
  return {
    ...properties,
    className: classNames(...names, ...((properties.className as string[] | undefined) ?? [])),
  };
}

/** 读取节点在所属文本源中的源码。 */
export function sourceOf(context: BuildContext, node: WikitextNode): string {
  return getSourceText(context.document, node);
}

/** 为一次明确的降级追加诊断；位置与来源直接取自语义节点。 */
export function reportDegrade(
  context: BuildContext,
  node: WikitextNode,
  code: WikitextDiagnosticCode,
  message: string,
  severity: WikitextDiagnostic["severity"] = "warning",
): void {
  context.reportDiagnostic({
    code,
    stage: "hast",
    severity,
    message,
    ...(node.origin ? { location: node.origin } : {}),
  });
}

/** 源码属性转换；被丢弃的样式声明同时产生诊断。 */
export function sourceProperties(
  context: BuildContext,
  node: WikitextNode & { readonly attributes: readonly WikitextAttribute[] },
  tag: string,
): Properties {
  return sanitizedAttributesToProps(node.attributes, tag, {
    onStyleDropped: (dropped) =>
      reportDegrade(
        context,
        node,
        "STYLE_DECLARATION_DROPPED",
        `Dropped unsupported inline style declaration: ${dropped.join(", ")}.`,
      ),
  });
}

/**
 * 无法转换的节点：按块级或行内输出源码卡片，并保留节点来源。
 * @param context 转换上下文。
 * @param node 原始语义节点。
 * @param parserType 节点类型，用于标签与 data 属性。
 * @param value 卡片中展示的源码。
 * @param block 是否按块级渲染。
 * @param reason 自定义降级原因；省略时使用通用文案。
 */
export function unknownElement(
  context: BuildContext,
  node: WikitextNode,
  parserType: string,
  value: string,
  block: boolean,
  reason?: string,
): Element {
  const label = reason
    ? reason === "nestedTableUnsupported"
      ? context.labels.nestedTableUnsupported
      : reason
    : `${context.labels.unknownNode}: ${parserType}`;
  if (reason === "nestedTableUnsupported") {
    return element(
      "section",
      { className: classNames("wikitext-table--degraded"), role: "note" },
      [
        element("span", { className: ["wikitext-unknown__label"] }, [textNode(label)]),
        element("pre", { className: ["wikitext-unknown__source"] }, [textNode(value)]),
      ],
      node,
    );
  }
  if (block) {
    return element(
      "section",
      {
        className: ["wikitext-unknown", "wikitext-unknown--block"],
        dataNodeType: parserType,
        dataNodeId: node.id,
      },
      [
        element("span", { className: ["wikitext-unknown__label"] }, [textNode(label)]),
        element("pre", { className: ["wikitext-unknown__source"] }, [textNode(value)]),
      ],
      node,
    );
  }
  return element(
    "span",
    {
      className: ["wikitext-unknown", "wikitext-unknown--inline"],
      dataNodeType: parserType,
      dataNodeId: node.id,
      title: label,
    },
    [
      element("span", { className: ["wikitext-unknown__label"] }, [textNode(label)]),
      element("code", { className: ["wikitext-unknown__source"] }, [
        textNode(value.length > 160 ? `${value.slice(0, 160)}…` : value),
      ]),
    ],
    node,
  );
}
