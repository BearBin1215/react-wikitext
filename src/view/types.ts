import type { Element } from "hast";
import type { ComponentType, HTMLAttributes, ReactNode } from "react";
import type {
  WikitextArgument,
  WikitextExtension,
  WikitextFile,
  WikitextLink,
  WikitextNode,
  WikitextOrigin,
  WikitextParserFunction,
  WikitextReference,
  WikitextRenderDocument,
  WikitextTable,
  WikitextTemplate,
  WikitextUnknown,
} from "../ast/model";

/** 传给自定义 HTML 组件的属性。 */
export interface WikitextHtmlComponentProps extends HTMLAttributes<HTMLElement> {
  /** 当前的 HAST 元素；由桥接层传入。 */
  readonly node?: Element;
  /** 当前渲染的文档。 */
  readonly document: WikitextRenderDocument;
  /** 当该 HTML 元素承载 wiki 语义节点时提供。 */
  readonly semantic?: WikitextNode;
  /** 该 HTML 元素对应的源码来源。 */
  readonly origin?: WikitextOrigin;
  readonly children?: ReactNode;
  /** 链接与图片常用的安全属性。 */
  readonly href?: string;
  readonly src?: string;
  readonly alt?: string;
}

/** 按标签名覆盖 HTML 元素的组件表。 */
export type WikitextHtmlComponents = Partial<
  Record<string, ComponentType<WikitextHtmlComponentProps>>
>;

/** 传给语义组件的公共属性。 */
export interface WikitextSemanticComponentProps<Node extends WikitextNode> {
  /** 当前渲染的文档。 */
  readonly document: WikitextRenderDocument;
  /** 当前语义节点。 */
  readonly node: Node;
  /** 该节点对应的 HAST 元素。 */
  readonly hastNode: Element;
  /** 该节点的源码来源。 */
  readonly origin?: WikitextOrigin;
  readonly children?: ReactNode;
}

/** 链接语义组件的属性。 */
export interface WikitextLinkComponentProps extends WikitextSemanticComponentProps<WikitextLink> {
  /** 链接目标。 */
  readonly target: string;
  /** 链接类型。 */
  readonly kind: WikitextLink["kind"];
  /** 清洗后的地址；没有可用的地址时省略。 */
  readonly href?: string;
  /** 是否为站外链接。 */
  readonly external: boolean;
}

/** 模板与解析器函数语义组件的属性。 */
export interface WikitextTemplateComponentProps extends WikitextSemanticComponentProps<
  WikitextTemplate | WikitextParserFunction
> {
  /** 显示名。 */
  readonly displayName: string;
}

/** 文件语义组件的属性。 */
export interface WikitextFileComponentProps extends WikitextSemanticComponentProps<WikitextFile> {
  /** 文件名。 */
  readonly name: string;
}

/** 引用语义组件的属性。 */
export interface WikitextReferenceComponentProps extends WikitextSemanticComponentProps<WikitextReference> {
  /** 引用在文档中的出现序号，从 1 开始。 */
  readonly number: number;
}

/** 扩展标签语义组件的属性。 */
export interface WikitextExtensionComponentProps extends WikitextSemanticComponentProps<WikitextExtension> {
  /** 标签名。 */
  readonly name: string;
  /** 是否按块级展示。 */
  readonly block: boolean;
}

/** 未知节点语义组件的属性。 */
export interface WikitextUnknownComponentProps extends WikitextSemanticComponentProps<WikitextUnknown> {
  /** 上游 token 类型。 */
  readonly parsedType: string;
  /** 是否按块级展示。 */
  readonly block: boolean;
}

/** 按语义节点类型覆盖的组件表。 */
export interface WikitextSemanticComponents {
  /** 覆盖链接。 */
  link?: ComponentType<WikitextLinkComponentProps>;
  /** 覆盖模板。 */
  template?: ComponentType<WikitextTemplateComponentProps>;
  /** 覆盖解析器函数。 */
  parserFunction?: ComponentType<WikitextTemplateComponentProps>;
  /** 覆盖模板参数引用。 */
  argument?: ComponentType<WikitextSemanticComponentProps<WikitextArgument>>;
  /** 覆盖文件。 */
  file?: ComponentType<WikitextFileComponentProps>;
  /** 覆盖引用。 */
  reference?: ComponentType<WikitextReferenceComponentProps>;
  /** 覆盖扩展标签。 */
  extension?: ComponentType<WikitextExtensionComponentProps>;
  /** 覆盖未知节点。 */
  unknown?: ComponentType<WikitextUnknownComponentProps>;
  /** 覆盖表格。 */
  table?: ComponentType<WikitextSemanticComponentProps<WikitextTable>>;
}

/** `<WikitextView>` 的属性。 */
export interface WikitextViewProps {
  /** 准备阶段生成的渲染快照。 */
  readonly document: WikitextRenderDocument;
  /** 按标签名覆盖 HTML 元素。 */
  readonly components?: WikitextHtmlComponents;
  /** 按语义节点类型覆盖组件。 */
  readonly semanticComponents?: WikitextSemanticComponents;
  /** 容器的语言。 */
  readonly lang?: string;
  /** 容器的文字方向。 */
  readonly dir?: "ltr" | "rtl";
  /** 标题 id 的前缀；未传时由 React 生成的实例 id 提供，保证多实例不冲突。 */
  readonly idPrefix?: string;
  readonly className?: string;
  readonly containerProps?: Omit<HTMLAttributes<HTMLDivElement>, "dangerouslySetInnerHTML">;
  /** 单个块渲染失败时的回调；不传时由错误边界显示占位内容。 */
  readonly onRenderError?: (error: Error, info: { node: WikitextNode }) => void;
}

/** `<WikitextFragment>` 的属性。 */
export interface WikitextFragmentProps {
  /** 需要渲染的语义节点。 */
  readonly nodes: readonly WikitextNode[];
  /** 片段外层的展示方式，默认行内。 */
  readonly mode?: "inline" | "block";
  readonly className?: string;
}
