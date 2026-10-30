import type { ElementContent, Root } from "hast";
import type { WikitextLabels } from "../ast/labels";
import type {
  WikitextDocument,
  WikitextFile,
  WikitextFileParameter,
  WikitextHeadingIdStrategy,
  WikitextLink,
  WikitextNode,
  WikitextNodeMap,
  WikitextNodeType,
  WikitextOrigin,
  WikitextResolvedPolicy,
  WikitextRoot,
  WikitextDiagnostic,
} from "../ast/model";

/** 写在 HAST 节点 `data` 上的 wiki 来源信息。 */
export interface WikitextHastMeta {
  /** 对应语义节点的 id。 */
  readonly id: string;
  /** 对应语义节点的类型。 */
  readonly type: string;
  /** 对应语义节点的来源。 */
  readonly origin?: WikitextOrigin;
  /** 该节点是否由转换器生成。 */
  readonly generated?: boolean;
  /** 引用在文档中的序号；仅 `reference` 节点提供。 */
  readonly number?: number;
  /** 引用分组；未分组时省略。 */
  readonly group?: string;
  /** 同一注释第几次被引用；仅 `reference` 节点提供。 */
  readonly occurrence?: number;
  /** 图片由 resolver 解析；用于最终整理按来源判断授权。 */
  readonly imageSource?: "resolver";
}

/** HAST 节点上的 wiki 数据。 */
export interface WikitextHastData {
  wikitext?: WikitextHastMeta;
}

/** 单个语义节点的 HAST 转换函数。 */
export type WikitextHastHandler<Node extends WikitextNode = WikitextNode> = (
  node: Node,
  context: WikitextToHastContext,
) => ElementContent | ElementContent[] | null | undefined;

/**
 * 自定义语义节点的 HAST 转换函数表。
 *
 * 内建节点键按 {@link WikitextNodeMap} 推导出具体的节点类型；自定义节点应通过
 * 模块扩展写入 `WikitextNodeMap`，即可获得同样的推导。返回 `undefined` 表示继续
 * 使用内建转换；返回 `null` 表示显式丢弃该节点。
 */
export type WikitextHastHandlers = {
  readonly [Type in WikitextNodeType]?: WikitextHastHandler<WikitextNodeMap[Type]>;
} & {
  /** 未注册的节点类型；需要显式标注参数类型。 */
  readonly [type: string]: unknown;
};

/** 传给 link/image resolver 的上下文。 */
export interface WikitextResolverContext<Node extends WikitextNode> {
  /** 原始解析快照。查询时必须查该快照的 ast，而不是工作树。 */
  readonly document: WikitextDocument;
  /** 本次转换后的工作树。 */
  readonly ast: WikitextRoot;
  /** 正在处理的语义节点。 */
  readonly node: Node;
}

/** 传给链接 resolver 的请求。 */
export interface WikitextLinkRequest {
  /** 链接类型。 */
  readonly kind: "internal" | "external" | "bareExternal";
  /** 链接目标。 */
  readonly target: string;
  /** 内部链接的页面部分。 */
  readonly page?: string;
  /** 内部链接的片段部分。 */
  readonly fragment?: string;
}

/** 链接 resolver 返回的结果。 */
export interface WikitextResolvedLink {
  /** 最终使用的地址；留空表示不生成链接。 */
  readonly href?: string;
  /** 纯文本标签；需要富展示时改用语义组件覆盖。 */
  readonly label?: string;
  /** 链接的打开方式。 */
  readonly target?: "_blank" | "_self";
}

/** 把 wiki 链接解析为真实地址的回调。 */
export type WikitextLinkResolver = (
  request: WikitextLinkRequest,
  context: WikitextResolverContext<WikitextLink>,
) => WikitextResolvedLink | null | undefined;

/** 传给图片 resolver 的请求。 */
export interface WikitextImageRequest {
  /** 文件名。 */
  readonly name: string;
  /** 原始文件参数。 */
  readonly parameters: readonly WikitextFileParameter[];
  /** 宽度（像素）。 */
  readonly width?: number;
  /** 高度（像素）。 */
  readonly height?: number;
  /** 替代文字。 */
  readonly alt?: string;
  /** 说明文字。 */
  readonly caption?: string;
}

/** 图片 resolver 返回的结果。 */
export interface WikitextResolvedImage {
  /** 图片地址。 */
  readonly src: string;
  readonly alt?: string;
  readonly width?: number;
  readonly height?: number;
}

/**
 * 把 wiki 文件解析为图片地址的回调。
 * 返回 `undefined` 或 `null` 都表示没有可用图片，节点保持占位。
 */
export type WikitextImageResolver = (
  request: WikitextImageRequest,
  context: WikitextResolverContext<WikitextFile>,
) => WikitextResolvedImage | null | undefined;

/** 准备阶段的安全策略，未提供的字段使用默认值。 */
export interface WikitextPreparePolicy {
  /** 是否允许相对链接。 */
  readonly allowRelativeLinks?: boolean;
  /** 是否允许相对图片地址。 */
  readonly allowRelativeImages?: boolean;
  /** 是否允许插件插入的图片。 */
  readonly allowPluginImages?: boolean;
  /** 是否允许源码 HTML 中的 `<img>`。 */
  readonly allowSourceImages?: boolean;
  /** 外部链接的打开方式；null 表示不写 target。 */
  readonly externalLinkTarget?: "_blank" | "_self" | null;
  /** 在基础白名单之外额外允许的标签。 */
  readonly extraTags?: readonly string[];
  /** 即使出现在白名单中也要移除的标签。 */
  readonly stripTags?: readonly string[];
}

/** 默认安全策略；冻结以避免宿主修改默认数组影响后续准备。 */
export const DEFAULT_PREPARE_POLICY: WikitextResolvedPolicy = Object.freeze({
  allowRelativeLinks: true,
  allowRelativeImages: false,
  allowPluginImages: false,
  allowSourceImages: false,
  externalLinkTarget: "_blank",
  extraTags: Object.freeze<string[]>([]),
  stripTags: Object.freeze([
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "form",
    "input",
    "button",
    "textarea",
    "select",
    "option",
    "svg",
    "math",
    "meta",
    "link",
  ]),
});

/** 传给 handler 的只读转换上下文。 */
export interface WikitextToHastContext {
  /** 原始解析快照。 */
  readonly document: WikitextDocument;
  /** 本次转换的工作树。 */
  readonly ast: WikitextRoot;
  /** 渲染文案。 */
  readonly labels: WikitextLabels;
  /** 已解析的安全策略。 */
  readonly policy: WikitextResolvedPolicy;
  readonly resolveLink?: WikitextLinkResolver;
  readonly resolveImage?: WikitextImageResolver;
  readonly handlers?: WikitextHastHandlers;
  /** resolver 明确授权的图片地址；handler 不能在这里追加授权。 */
  readonly authorizedImages: ReadonlySet<string>;
  /** 转换过程中收集的诊断信息；追加请使用 {@link WikitextToHastContext.reportDiagnostic}。 */
  readonly diagnostics: readonly WikitextDiagnostic[];
  /** 追加一条诊断。 */
  readonly reportDiagnostic: (diagnostic: WikitextDiagnostic) => void;
  /** 用内建规则转换单个语义节点。 */
  readonly convert: (node: WikitextNode) => ElementContent | ElementContent[] | null;
  /** 用内建规则转换语义节点列表。 */
  readonly convertChildren: (nodes: readonly WikitextNode[]) => ElementContent[];
}

/** 调用 `toHast` 时传入的内部输入；与 handler 可见的上下文分开，允许库内写入授权与诊断。 */
export interface WikitextToHastInput extends Omit<
  WikitextToHastContext,
  "authorizedImages" | "diagnostics" | "reportDiagnostic" | "convert" | "convertChildren"
> {
  /** 记录 resolver 明确授权的图片地址。 */
  readonly authorizedImages: Set<string>;
  /** 转换过程中收集的诊断信息。 */
  readonly diagnostics: WikitextDiagnostic[];
  /** 已解析的目录设置；缺省时按自动阈值处理。 */
  readonly tocSettings?: WikitextResolvedTocSettings;
}

/** 目录处理模式：`none` 表示 `__NOTOC__`，`marker` 有显式 `__TOC__`，`force` 表示 `__FORCETOC__`，`auto` 交给阈值判断。 */
export type WikitextTocMode = "none" | "marker" | "force" | "auto";

/** 目录选项：自动生成阈值与列数。 */
export interface WikitextTocOptions {
  /** 自动目录所需的最少标题数，默认 4；显式 `__TOC__` 不受该阈值限制。 */
  readonly minHeadings?: number;
  /** 目录列数，1–3，默认 1。 */
  readonly columns?: 1 | 2 | 3;
}

/** 补齐默认值后的目录选项。 */
export interface WikitextTocSettings {
  readonly minHeadings: number;
  readonly columns: 1 | 2 | 3;
}

/** 补齐默认值并合并行为开关后的目录设置。 */
export interface WikitextResolvedTocSettings extends WikitextTocSettings {
  readonly enabled: boolean;
}

/** HAST 转换结果。 */
export interface WikitextToHastResult {
  readonly hast: Root;
  readonly authorizedImages: ReadonlySet<string>;
  /** 目录模式；最终放置与阈值由 finalize 统一处理。 */
  readonly toc: WikitextTocMode;
}

/**
 * unified 插件列表。刻意使用结构化类型，避免 public d.ts 绑定内部
 * bundled unified 的构造器身份，允许消费方传入自己的 processor 实例。
 */
export type WikitextPluginList = readonly unknown[];

/** 准备阶段接受的插件列表。 */
export interface WikitextPrepareOptions {
  /** 处理语义树（wiki AST）的 unified 插件。 */
  readonly wikitextPlugins?: WikitextPluginList;
  /** 处理 HAST 的 rehype 插件。 */
  readonly rehypePlugins?: WikitextPluginList;
  /** 把 wiki 链接解析为真实地址。 */
  readonly resolveLink?: WikitextLinkResolver;
  /** 把 wiki 文件解析为图片地址。 */
  readonly resolveImage?: WikitextImageResolver;
  /** 覆盖渲染文案。 */
  readonly labels?: Partial<WikitextLabels>;
  /** 覆盖安全策略。 */
  readonly policy?: WikitextPreparePolicy;
  /** 标题 id 策略，默认 `instance`。 */
  readonly headingIdStrategy?: WikitextHeadingIdStrategy;
  /** 目录选项；`false` 关闭目录，包括 `__TOC__` 与 `__FORCETOC__`。 */
  readonly toc?: false | WikitextTocOptions;
  /** 自定义语义节点的 HAST 转换函数。 */
  readonly handlers?: WikitextHastHandlers;
}
