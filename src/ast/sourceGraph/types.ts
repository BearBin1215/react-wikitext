/**
 * 来源图数据模型。
 *
 * 输入原文、归一化文本、模板原文、模板有效正文与展开结果都登记为独立的文本源，
 * 任何可对外传递的源码范围都是 {@link WikitextSourceSpan}。关系只通过 id 引用，
 * 索引、映射方法与对象父指针不进入序列化数据。
 */

/** 文本源身份；在同一份快照内唯一。 */
export type WikitextSourceId = string;

/** 数据源角色：编辑器原文、LF 文本、模板原文、include 过滤后的正文、展开结果。 */
export type WikitextSourceRole = "input" | "normalized" | "template" | "effective" | "expanded";

/** 带来源身份的范围，按 UTF-16 `[start, end)` 表示。 */
export interface WikitextSourceSpan {
  readonly sourceId: WikitextSourceId;
  readonly start: number;
  readonly end: number;
}

/** 一份可查询的文本源。 */
export interface WikitextTextSource {
  /** 快照内唯一的源身份，必须区分页面、模板、版本与变换阶段。 */
  readonly id: WikitextSourceId;
  /** 宿主提供的逻辑键，例如页面键或 provider 键；用于分组与调试。 */
  readonly key: string;
  /** 内容版本；更换内容必须更换版本。 */
  readonly revision: string;
  readonly role: WikitextSourceRole;
  readonly text: string;
  /** 模板源的标题；页面源省略。 */
  readonly title?: string;
}

/** 映射精度：可证明的边界对应，或只能定位到产生结果的调用。 */
export type WikitextMappingPrecision = "exact" | "enclosing-invocation";

/** 片段关系种类。 */
export type WikitextSourceSegmentKind =
  /** 等长复制：两侧文本一致，可按边界精确对应。 */
  | "copy"
  /** 换行归一化：CRLF / CR 折叠为 LF。 */
  | "normalize"
  /** 被删除的片段：只有 `from`，没有对应输出。 */
  | "delete"
  /** 生成内容：只有 `to`，没有可对应的输入。 */
  | "generated"
  /** 调用输出与模板正文的对应关系。 */
  | "invocation"
  /** 参数或函数结果与调用方文本的对应关系。 */
  | "value";

/**
 * 一条片段关系。
 *
 * `from` 与 `to` 至少有一个存在：`delete` 只有 `from`，`generated` 只有 `to`。
 * 两侧都存在时表示一个可双向查询的对应关系。
 */
export interface WikitextSourceSegment {
  readonly kind: WikitextSourceSegmentKind;
  readonly from?: WikitextSourceSpan;
  readonly to?: WikitextSourceSpan;
  readonly precision: WikitextMappingPrecision;
  /** 产生该片段的调用；用于把粗粒度结果关联回调用记录。 */
  readonly invocationId?: string;
  /** 输出出现位置身份；同一源码片段被多次展开时各不相同。 */
  readonly occurrenceId?: string;
}

/** 调用类别。 */
export type WikitextInvocationKind = "template" | "parserFunction" | "argument";

/** 调用状态；`preserved` 表示原文保留，`failed` 表示依赖或预算是失败原因。 */
export type WikitextInvocationStatus = "expanded" | "preserved" | "failed";

/** 单次调用的来源记录。 */
export interface WikitextInvocation {
  /** 快照内唯一；嵌套调用各自一条记录。 */
  readonly id: string;
  readonly kind: WikitextInvocationKind;
  readonly name: string;
  /** 词法作用域身份；参数 thunk 捕获它，循环检测按它计算。 */
  readonly scopeId: string;
  /** 因果父调用；参数内部的调用指向包含它的调用，但不参与循环检测。 */
  readonly parentId?: string;
  /** 调用文本所在的文本源。 */
  readonly sourceId: WikitextSourceId;
  /** 调用在所属文本源中的范围。 */
  readonly start: number;
  readonly end: number;
  readonly status: WikitextInvocationStatus;
  /** 输出在展开结果中的全部出现位置；被保留或失败时为空。 */
  readonly outputs: readonly WikitextSourceSpan[];
  /** 被调用模板的规范化标题。 */
  readonly templateTitle?: string;
  /** 保留或失败的原因码。 */
  readonly reason?: string;
}

/** 来源图版本；恢复时拒绝其他版本。 */
export const SOURCE_GRAPH_VERSION = 1 as const;

/** 来源图：源目录、片段关系与调用记录。 */
export interface WikitextSourceGraph {
  readonly version: typeof SOURCE_GRAPH_VERSION;
  readonly sources: readonly WikitextTextSource[];
  readonly segments: readonly WikitextSourceSegment[];
  readonly invocations: readonly WikitextInvocation[];
}

/** 一个匹配结果：输入范围与它对应的目标范围。 */
export interface WikitextMappingMatch {
  readonly from: WikitextSourceSpan;
  readonly to: WikitextSourceSpan;
  readonly precision: WikitextMappingPrecision;
  readonly invocationId?: string;
  readonly occurrenceId?: string;
}

/** 映射覆盖率：全部对应、部分对应或没有对应。 */
export type WikitextMappingCoverage = "complete" | "partial" | "none";

/** 映射结果；无法映射的子范围进入 `unmapped`。 */
export interface WikitextMappingResult {
  readonly matches: readonly WikitextMappingMatch[];
  readonly unmapped: readonly WikitextSourceSpan[];
  readonly coverage: WikitextMappingCoverage;
  /** 达到结果上限时为 true；未返回的匹配不等于不存在。 */
  readonly truncated: boolean;
}

/** 源码中的单个坐标；行列从 1 开始，offset 从 0 开始。 */
export interface WikitextPoint {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

/** 一段源码的起止坐标；由所属文本源按需计算，不与 span 分别存储。 */
export interface WikitextSourcePosition {
  readonly start: WikitextPoint;
  readonly end: WikitextPoint;
}

/** 映射方向：把范围投影到目标源，或反向查找来源。 */
export interface WikitextMapOptions {
  /** 目标文本源；省略时映射到页面原文（`input`）。 */
  readonly targetSourceId?: WikitextSourceId;
  /** 最多返回的匹配数，默认 64。 */
  readonly limit?: number;
  /** 是否允许经过粗粒度片段继续映射，默认 true。 */
  readonly includeCoarse?: boolean;
}
