/**
 * 公共 wiki 语义 AST、源码语法树与快照模型。
 *
 * 这里只定义普通数据与判别联合，不依赖 React、DOM 或具体解析器。
 */

import type { Root as HastRoot } from "hast";
import type { WikitextLabels } from "./labels";
import type { ResolvedParseLimits } from "./limits";
import type {
  WikitextSourceGraph,
  WikitextSourceId,
  WikitextSourcePosition,
  WikitextSourceSpan,
} from "./sourceGraph/types";

/** 语义 AST 的版本号；恢复快照时用来拒绝不兼容的数据。 */
export const AST_SCHEMA_VERSION = 3 as const;
/** 源码语法树的版本号。 */
export const SYNTAX_SCHEMA_VERSION = 2 as const;
/** 渲染快照的版本号，覆盖 HAST 与渲染元数据。 */
export const RENDER_SCHEMA_VERSION = 4 as const;
/** 编译封装的版本号，覆盖依赖清单与统计字段。 */
export const COMPILATION_SCHEMA_VERSION = 1 as const;

/**
 * parser 内部的偏移区间，按 `[start, end)` 的 UTF-16 offset 表示。
 *
 * 它只出现在源码语法树等 parser 内部结构；diagnostic、origin、resolver 请求、
 * 组件属性与公共查询统一使用 {@link WikitextSourceSpan}。
 */
export type WikitextRange = readonly [start: number, end: number];

/** 源码中的单个坐标；行列从 1 开始，offset 从 0 开始。 */
export type { WikitextPoint } from "./sourceGraph/types";
/** 一段源码的起止坐标；由所属文本源按需计算。 */
export type WikitextPosition = WikitextSourcePosition;

/** 语义节点与源码语法节点的对应关系；生成的节点可以没有 origin。 */
export interface WikitextOrigin extends WikitextSourceSpan {
  readonly syntaxId?: string;
}

/**
 * 处理阶段词表；诊断与错误共用同一套取值，运行时校验也读取这里。
 * `prepare` 表示失败发生在准备阶段的整体调度层，而不是某一个具体子阶段。
 */
export const WIKITEXT_STAGES = [
  "parse",
  "expand",
  "prepare",
  "wikitext",
  "hast",
  "rehype",
  "sanitize",
  "finalize",
] as const;

/** 处理阶段名。 */
export type WikitextStage = (typeof WIKITEXT_STAGES)[number];

/** 诊断级别词表；序列化校验与类型共用。 */
export const WIKITEXT_DIAGNOSTIC_SEVERITIES = ["error", "warning", "info"] as const;

/** 诊断级别。 */
export type WikitextDiagnosticSeverity = (typeof WIKITEXT_DIAGNOSTIC_SEVERITIES)[number];

/**
 * 库内固定诊断码词表；与错误码分开，宿主可以稳定匹配。
 * 插件通过 VFile 产生消息时可以使用自定义 rule id，因此联合类型额外允许自定义字符串。
 */
export type KnownWikitextDiagnosticCode =
  | "UNKNOWN_NODE"
  | "EXTENSION_UNSUPPORTED"
  | "NESTED_TABLE_UNSUPPORTED"
  | "TABLE_FILLER_BUDGET_EXCEEDED"
  | "FILE_PLACEHOLDER"
  | "BEHAVIOR_SWITCH_IGNORED"
  | "BLOCKED_HTML"
  | "UNAUTHORIZED_IMAGE"
  | "STYLE_DECLARATION_DROPPED"
  | "REFERENCE_DUPLICATE_DEFINITION"
  | "REFERENCE_MISSING_CONTENT"
  | "UNSUPPORTED_CALL"
  | "UNRESOLVED_DEPENDENCY"
  | "TEMPLATE_NOT_FOUND"
  | "TEMPLATE_LOOP"
  | "TEMPLATE_RESOLVE_FAILED"
  | "TEMPLATE_PARSE_FAILED"
  | "DEPTH_BUDGET_EXCEEDED"
  | "INVOCATION_BUDGET_EXCEEDED"
  | "LENGTH_BUDGET_EXCEEDED"
  | "EXPRESSION_ERROR"
  | "FINAL_PARSE_FALLBACK"
  | "UNCLOSED_CALL"
  | "SOURCE_GRAPH_BUDGET_EXCEEDED"
  | "TEMPLATE_BUDGET_EXCEEDED";

/** 诊断码；已知词表之外允许插件自定义 rule id。 */
export type WikitextDiagnosticCode = KnownWikitextDiagnosticCode | (string & {});

/** 诊断的附带位置；主位置仍是 `location`，这里只补充相关来源。 */
export interface WikitextRelatedLocation {
  readonly location: WikitextSourceSpan;
  readonly message: string;
  readonly stage?: WikitextStage;
}

/** 管线产生的诊断信息，用于定位解析、转换或清洗问题。 */
export interface WikitextDiagnostic {
  readonly code: WikitextDiagnosticCode;
  readonly stage: WikitextStage;
  readonly severity: WikitextDiagnosticSeverity;
  readonly message: string;
  /** 主位置：真实失败位置所在的文本源与范围。 */
  readonly location?: WikitextSourceSpan;
  /** 相关位置；页面调用位置、模板原文等补充信息。 */
  readonly related?: readonly WikitextRelatedLocation[];
  /** 失败涉及的调用；与来源图中的调用记录对应。 */
  readonly invocationId?: string;
  /** 失败涉及的模板标题；展开阶段诊断提供。 */
  readonly templateTitle?: string;
  /** 同一诊断码在该次编译中出现的次数；只有全局摘要诊断提供。 */
  readonly count?: number;
  /** 产生诊断的规则或插件标识。 */
  readonly rule?: string;
}

/** HTML 属性；没有值的布尔属性用 null 表示。 */
export interface WikitextAttribute {
  readonly name: string;
  readonly value: string | null;
}

/** 带源码区间的语法属性。 */
export interface WikitextSyntaxAttribute extends WikitextAttribute {
  readonly range: WikitextRange;
}

/** 语法节点保留的标量属性值。 */
export type WikitextPrimitive = string | number | boolean;

/**
 * 源码语法树：保留真实的 token 类型、标量属性与区间。
 * 它属于解析器适配层，只在显式开启 `retainSyntax` 时进入公共快照，
 * 用途是调试上游 token；语义节点的位置、区间与查询不依赖它。
 */
export interface WikitextSyntaxNode {
  readonly id: string;
  readonly type: string;
  readonly range: WikitextRange;
  readonly position: WikitextPosition;
  readonly props: Readonly<Record<string, WikitextPrimitive>>;
  readonly attributes: readonly WikitextSyntaxAttribute[];
  readonly children: readonly WikitextSyntaxNode[];
}

/** 源码语法树的根节点。 */
export interface WikitextSyntaxRoot extends WikitextSyntaxNode {
  readonly type: "root";
}

/**
 * 语义节点的公共字段；自定义节点可以扩展它并注册到 {@link WikitextNodeMap}。
 * @example
 * ```ts
 * interface Callout extends WikitextNodeBase<"callout"> {
 *   readonly tone: "info" | "warn";
 * }
 * declare module "react-wikitext/ast" {
 *   interface WikitextNodeMap {
 *     callout: Callout;
 *   }
 * }
 * ```
 */
export interface WikitextNodeBase<TType extends string = string> {
  readonly type: TType;
  /** 在一份快照内唯一；不承诺跨编辑稳定。 */
  readonly id: string;
  /**
   * 来源文本源与范围；生成节点不伪造来源。
   *
   * 行列坐标由 `getSourcePosition` 从所属文本源计算，不在节点上另存一份。
   */
  readonly origin?: WikitextOrigin;
  readonly data?: Readonly<Record<string, unknown>>;
}

interface WikitextParentBase<TType extends string> extends WikitextNodeBase<TType> {
  readonly children: readonly WikitextNode[];
}

/** 语义树根节点，子节点是文档级内容。 */
export type WikitextRoot = WikitextParentBase<"root">;

/** 段落。 */
export type WikitextParagraph = WikitextParentBase<"paragraph">;

/** 文本节点。 */
export interface WikitextText extends WikitextNodeBase<"text"> {
  /** 已做一次实体解码的语义文本。 */
  readonly value: string;
}

/** 标题，级别限制在 1 到 6。 */
export interface WikitextHeading extends WikitextParentBase<"heading"> {
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
}

/** 粗体。 */
export type WikitextStrong = WikitextParentBase<"strong">;

/** 斜体。 */
export type WikitextEmphasis = WikitextParentBase<"emphasis">;

/** 水平线。 */
export type WikitextThematicBreak = WikitextNodeBase<"thematicBreak">;

/** 链接类型：内部链接、带方括号的外部链接、裸外部链接。 */
export type WikitextLinkKind = "internal" | "external" | "bareExternal";

/** 链接。 */
export interface WikitextLink extends WikitextParentBase<"link"> {
  readonly kind: WikitextLinkKind;
  /** 完整目标；内部链接包含页面与片段，外链即 URL。 */
  readonly target: string;
  /** 内部链接的页面部分。 */
  readonly page?: string;
  /** 内部链接的片段部分（不含 `#`）。 */
  readonly fragment?: string;
}

/** 文件参数。 */
export interface WikitextFileParameter {
  readonly name: string;
  readonly value: string;
  readonly explicit: boolean;
  readonly origin?: WikitextOrigin;
}

/** 文件说明文字的来源：没有说明、显式键值参数、匿名参数。 */
export type WikitextFileCaptionKind = "none" | "explicit" | "unnamed";

/** 文件（图片）节点。 */
export interface WikitextFile extends WikitextParentBase<"file"> {
  /** 去掉 `File:`/`Image:` 前缀的文件名。 */
  readonly name: string;
  /** 非说明文字的结构化参数。 */
  readonly parameters: readonly WikitextFileParameter[];
  readonly captionKind: WikitextFileCaptionKind;
  readonly attributes: readonly WikitextAttribute[];
  /** 独占一行时使用块级展示。 */
  readonly block?: boolean;
}

/** 有序或无序列表。 */
export interface WikitextList extends WikitextParentBase<"list"> {
  readonly ordered: boolean;
}

/** 列表项。 */
export type WikitextListItem = WikitextParentBase<"listItem">;

/** 定义列表。 */
export type WikitextDefinitionList = WikitextParentBase<"definitionList">;

/** 定义列表的术语项。 */
export type WikitextDefinitionTerm = WikitextParentBase<"definitionTerm">;

/** 定义列表的说明项。 */
export type WikitextDefinitionDescription = WikitextParentBase<"definitionDescription">;

/** 表格单元格类型：表头或普通单元格。 */
export type WikitextTableCellKind = "th" | "td";

/** 表格。 */
export interface WikitextTable extends WikitextParentBase<"table"> {
  readonly attributes: readonly WikitextAttribute[];
}

/** 表格标题；保留单元格上的对齐等属性。 */
export interface WikitextTableCaption extends WikitextParentBase<"tableCaption"> {
  readonly attributes: readonly WikitextAttribute[];
}

/** 表格行。 */
export interface WikitextTableRow extends WikitextParentBase<"tableRow"> {
  readonly attributes: readonly WikitextAttribute[];
}

/** 表格单元格。 */
export interface WikitextTableCell extends WikitextParentBase<"tableCell"> {
  readonly kind: WikitextTableCellKind;
  readonly attributes: readonly WikitextAttribute[];
}

/** 模板或解析器函数的参数。 */
export interface WikitextTemplateParameter extends WikitextParentBase<"templateParameter"> {
  readonly name: string;
  readonly anonymous: boolean;
  /** 同名匿名参数中的序号（从 1 开始）；具名参数没有该字段。 */
  readonly index?: number;
}

/** 模板调用。 */
export interface WikitextTemplate extends WikitextParentBase<"template"> {
  readonly name: string;
  /** 规整后的显示名，已去掉命名空间前缀。 */
  readonly displayName: string;
  /** 独占一行时使用块级展示。 */
  readonly block?: boolean;
}

/** 解析器函数调用。 */
export interface WikitextParserFunction extends WikitextParentBase<"parserFunction"> {
  readonly name: string;
  /** 独占一行时使用块级展示。 */
  readonly block?: boolean;
}

/** 模板参数引用，例如 `{{{name|default}}}`。 */
export interface WikitextArgument extends WikitextParentBase<"argument"> {
  readonly name: string;
}

/** 扩展标签；未专门支持的标签同样保留名称与内部原文，默认展示为源码卡片。 */
export interface WikitextExtension extends WikitextParentBase<"extension"> {
  readonly name: string;
  readonly attributes: readonly WikitextAttribute[];
  readonly selfClosing: boolean;
  readonly block: boolean;
  /** 已解码的内部原文，供占位展示与自定义组件读取。 */
  readonly raw?: string;
}

/** 引用（ref）节点。 */
export interface WikitextReference extends WikitextParentBase<"reference"> {
  readonly name?: string;
  readonly group?: string;
  readonly attributes: readonly WikitextAttribute[];
  /** 已解码的扩展标签内部原文，用于安全占位标题。 */
  readonly raw?: string;
}

/** 分类声明。 */
export interface WikitextCategory extends WikitextNodeBase<"category"> {
  readonly target: string;
  readonly sortKey?: string;
}

/** 行为开关，例如双下划线魔术字。 */
export interface WikitextBehaviorSwitch extends WikitextNodeBase<"behaviorSwitch"> {
  readonly name: string;
}

/** 重定向声明。 */
export interface WikitextRedirect extends WikitextNodeBase<"redirect"> {
  readonly target: string;
  readonly page?: string;
  readonly fragment?: string;
}

/** 源码中的 HTML 元素。 */
export interface WikitextHtmlElement extends WikitextParentBase<"htmlElement"> {
  readonly tag: string;
  readonly attributes: readonly WikitextAttribute[];
  readonly selfClosing: boolean;
  readonly block: boolean;
  /** 禁止标签的安全占位标记。 */
  readonly blocked?: boolean;
}

/** 代码文本。 */
export interface WikitextCode extends WikitextNodeBase<"code"> {
  readonly value: string;
  readonly language?: string;
}

/** 注释。 */
export interface WikitextComment extends WikitextNodeBase<"comment"> {
  readonly value: string;
}

/** 无法识别或明确降级的节点。 */
export interface WikitextUnknown extends WikitextNodeBase<"unknown"> {
  /** 上游 token 类型（或语义分类标识），例如 `html`、`ext`。 */
  readonly parserType: string;
  readonly value: string;
  readonly block: boolean;
  /** 明确的降级原因。 */
  readonly reason?: string;
}

/**
 * 已注册的语义节点类型与对应数据。
 * 可以通过模块扩展追加自定义节点，并在准备阶段用 handlers 注册对应的 HAST 转换。
 */
export interface WikitextNodeMap {
  root: WikitextRoot;
  paragraph: WikitextParagraph;
  text: WikitextText;
  heading: WikitextHeading;
  strong: WikitextStrong;
  emphasis: WikitextEmphasis;
  thematicBreak: WikitextThematicBreak;
  link: WikitextLink;
  file: WikitextFile;
  list: WikitextList;
  listItem: WikitextListItem;
  definitionList: WikitextDefinitionList;
  definitionTerm: WikitextDefinitionTerm;
  definitionDescription: WikitextDefinitionDescription;
  table: WikitextTable;
  tableCaption: WikitextTableCaption;
  tableRow: WikitextTableRow;
  tableCell: WikitextTableCell;
  template: WikitextTemplate;
  templateParameter: WikitextTemplateParameter;
  parserFunction: WikitextParserFunction;
  argument: WikitextArgument;
  extension: WikitextExtension;
  reference: WikitextReference;
  category: WikitextCategory;
  behaviorSwitch: WikitextBehaviorSwitch;
  redirect: WikitextRedirect;
  htmlElement: WikitextHtmlElement;
  code: WikitextCode;
  comment: WikitextComment;
  unknown: WikitextUnknown;
}

/** 已注册的语义节点类型名。 */
export type WikitextNodeType = keyof WikitextNodeMap;

/** 任意语义节点。 */
export type WikitextNode = WikitextNodeMap[WikitextNodeType];

/** 带子节点的语义节点。 */
export type WikitextParentNode = Extract<WikitextNode, { children: readonly WikitextNode[] }>;

/** 判断节点是否带有 children 字段。 */
export function isWikitextParentNode(node: WikitextNode): node is WikitextParentNode {
  return Array.isArray((node as { children?: unknown }).children);
}

/** 快照公共字段：判别类型、快照身份、活动源码与来源图。 */
export interface WikitextSnapshotBase {
  /** 快照判别类型；恢复与查询据此区分解析快照和渲染快照。 */
  readonly kind: "parsed" | "render";
  /** 快照身份；实时调度不得把旧快照的 node id 直接用于新快照。 */
  readonly id: string;
  /** 活动文本源；`source` 与之一致。 */
  readonly activeSourceId: WikitextSourceId;
  /** 来源图；诊断与 AST origin 都引用这里的范围。 */
  readonly graph: WikitextSourceGraph;
  /** 活动源码文本。 */
  readonly source: string;
  readonly diagnostics: readonly WikitextDiagnostic[];
}

/** 解析快照的元数据。 */
export interface WikitextParsedMeta {
  readonly astSchemaVersion: typeof AST_SCHEMA_VERSION;
  readonly syntaxSchemaVersion?: typeof SYNTAX_SCHEMA_VERSION;
  readonly parser: string;
  readonly parserVersion: string;
  readonly pageName?: string;
  readonly sourceNormalized: boolean;
  readonly originalLength: number;
  /**
   * 本次解析实际生效的预算；与单次选项、创建时默认值合并后的结果一致。
   * 缓存键需要覆盖这些值时，可以直接读取，不必自行重算合并规则。
   */
  readonly limits: ResolvedParseLimits;
  /** 是否把上游语法树放进了公共快照；源码坐标与查询不依赖它。 */
  readonly retainSyntax: boolean;
}

/** 一次解析的结果；静态解析与展开路径共用同一种快照。 */
export interface WikitextParsedSnapshot extends WikitextSnapshotBase {
  readonly kind: "parsed";
  readonly ast: WikitextRoot;
  readonly syntax?: WikitextSyntaxRoot;
  readonly meta: WikitextParsedMeta;
}

/** 标题在文档中的位置与锚点信息。 */
export interface WikitextHeadingInfo {
  readonly nodeId: string;
  readonly level: number;
  readonly text: string;
  /** 逻辑锚点；具体 DOM id 由视图按实例映射。 */
  readonly id?: string;
}

/** 标题 id 策略：按实例加前缀、按 MediaWiki 裸锚点、或完全不写 id。 */
export type WikitextHeadingIdStrategy = "instance" | "mediawiki" | "none";

/** 准备阶段实际使用的安全策略。 */
export interface WikitextResolvedPolicy {
  readonly allowRelativeLinks: boolean;
  readonly allowRelativeImages: boolean;
  /** 是否允许插件（rehype）插入的图片。 */
  readonly allowPluginImages: boolean;
  /** 是否允许源码 HTML 中的 `<img>`。 */
  readonly allowSourceImages: boolean;
  /** 外链打开方式；null 表示不写 target。 */
  readonly externalLinkTarget: "_blank" | "_self" | null;
  /** 在基础白名单之外额外允许的标签。 */
  readonly extraTags: readonly string[];
  /** 即使出现在白名单中也要移除的标签。 */
  readonly stripTags: readonly string[];
}

/** 渲染快照的元数据。 */
export interface WikitextRenderMeta extends Omit<
  WikitextParsedMeta,
  "syntaxSchemaVersion" | "retainSyntax"
> {
  readonly renderSchemaVersion: typeof RENDER_SCHEMA_VERSION;
  readonly headingIdStrategy: WikitextHeadingIdStrategy;
  readonly policy: WikitextResolvedPolicy;
  readonly labels: WikitextLabels;
  /** resolver 明确授权的图片资源；恢复快照时用于复验。 */
  readonly authorizedImages: readonly string[];
}

/** 准备阶段的结果，可以直接交给视图渲染；继承解析快照的来源图。 */
export interface WikitextRenderSnapshot extends WikitextSnapshotBase {
  readonly kind: "render";
  /** 插件处理后的语义树。 */
  readonly ast: WikitextRoot;
  readonly hast: HastRoot;
  readonly headings: readonly WikitextHeadingInfo[];
  readonly meta: WikitextRenderMeta;
}

/** 整次编译的完成状态。 */
export type WikitextCompilationStatus = "complete" | "partial" | "fallback";

/** 本次编译实际读取的模板依赖；不收录未选中分支。 */
export interface WikitextCompilationDependency {
  /** 规范化后的模板标题。 */
  readonly title: string;
  /** 内容版本；命中缓存时保留原版本。 */
  readonly revision: string;
  /** 是否取到了模板。 */
  readonly found: boolean;
  /** 是否由缓存命中。 */
  readonly cached: boolean;
}

/** 一次编译的可观测统计；不包含每次编辑的历史记录。 */
export interface WikitextCompilationStats {
  /** 实际发出的 provider 请求数（按标题去重后）。 */
  readonly providerRequests: number;
  /** 需求批次数量。 */
  readonly batches: number;
  /** 模板语法程序的缓存命中与未命中。 */
  readonly programCacheHits: number;
  readonly programCacheMisses: number;
  /** 实际编译模板语法程序的次数。 */
  readonly programCompilations: number;
  /** 参与求值的调用数量。 */
  readonly invocationCount: number;
  /** 来源图片段数量。 */
  readonly segmentCount: number;
  /** 来源图文本源数量。 */
  readonly sourceCount: number;
  /** 端到端耗时（毫秒）。 */
  readonly durationMs: number;
}

/**
 * 编译结果。
 *
 * 诊断与来源图只保存在 `snapshot`；外层只描述状态、源码身份、依赖与统计。
 */
export interface WikitextCompilation {
  readonly schemaVersion: typeof COMPILATION_SCHEMA_VERSION;
  readonly status: WikitextCompilationStatus;
  /** 页面原文源身份。 */
  readonly inputSourceId: WikitextSourceId;
  /** 实际输出对应的文本源；回退时与 `inputSourceId` 的归一化源一致。 */
  readonly outputSourceId: WikitextSourceId;
  /** 尝试展开但失败时的输出源身份；失败诊断指向它。 */
  readonly attemptedSourceId?: WikitextSourceId;
  readonly snapshot: WikitextParsedSnapshot;
  readonly dependencies: readonly WikitextCompilationDependency[];
  readonly stats: WikitextCompilationStats;
}
