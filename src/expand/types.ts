import type { WikitextDiagnostic, WikitextDocument, WikitextRange } from "../ast/model";
import type { WikitextParseOptions, WikitextParser } from "../ast/parser";

/** 传给模板 resolver 的请求。 */
export interface WikitextTemplateRequest {
  /** parser 规范化后的模板标题，例如 `Template:Echo`。 */
  readonly title: string;
  /** 原始页面名；整个展开过程保持不变。 */
  readonly pageName?: string;
  /** 当前调用所属的模板标题；在原始页面中调用时省略。 */
  readonly callerTitle?: string;
  /** 所属顶层调用在原始源码中的范围，按 UTF-16 `[start, end)` 表示。 */
  readonly invocation: WikitextRange;
  readonly signal?: AbortSignal;
}

/**
 * 获取模板源码。
 * 返回 `null` / `undefined` 表示模板不存在；空字符串是合法模板。
 */
export type WikitextTemplateResolver = (
  request: WikitextTemplateRequest,
) => string | null | undefined | Promise<string | null | undefined>;

/**
 * 模板源码表：键为 parser 规范化后的页面标题（默认配置下 `{{Box}}` 请求 `Template:Box`），
 * 值为模板源码，空字符串是合法模板。
 */
export type WikitextTemplateTable = Readonly<Record<string, string>> | ReadonlyMap<string, string>;

/** 参与展开或保留的顶层调用类别。 */
export type WikitextExpansionKind = "template" | "parserFunction" | "argument";

/** 单次展开的记录状态。 */
export type WikitextExpansionRecordStatus = "expanded" | "preserved";

/** 顶层调用的展开记录；嵌套调用复用所属顶层记录。 */
export interface WikitextExpansionRecord {
  readonly kind: WikitextExpansionKind;
  readonly name: string;
  /** 在 `original.source` 中的调用范围。 */
  readonly originalRange: WikitextRange;
  /** 在展开后源码中的结果范围；包含隐式换行。 */
  readonly expandedRange: WikitextRange;
  readonly status: WikitextExpansionRecordStatus;
}

/** 展开阶段诊断；坐标基于 `original.source`。 */
export type WikitextExpansionDiagnostic = WikitextDiagnostic & {
  readonly stage: "expand";
  /** 失败涉及的模板标题。 */
  readonly templateTitle?: string;
};

/** 整次展开的完成状态。 */
export type WikitextExpansionStatus = "complete" | "partial" | "fallback";

/** 展开统计信息。 */
export interface WikitextExpansionInfo {
  readonly status: WikitextExpansionStatus;
  readonly records: readonly WikitextExpansionRecord[];
  readonly diagnostics: readonly WikitextExpansionDiagnostic[];
}

/** 展开结果：原始快照、展开后快照与展开记录。 */
export interface WikitextExpandedDocument {
  readonly original: WikitextDocument;
  readonly document: WikitextDocument;
  readonly expansion: WikitextExpansionInfo;
}

/** 展开选项。 */
export interface WikitextExpandOptions {
  /** 解析器；省略时使用默认配置的默认 parser。 */
  readonly parser?: WikitextParser;
  /** 原始页面名。 */
  readonly pageName?: string;
  /** 原始页面与最终源码的解析选项；`pageName` 由外层选项提供。 */
  readonly parseOptions?: Omit<WikitextParseOptions, "pageName">;
  /**
   * 宿主提供的模板源码表。每次展开开始时复制一份，
   * 之后修改原集合不影响本次结果；表中存在的标题优先于 `resolveTemplate`。
   */
  readonly templates?: WikitextTemplateTable | undefined;
  /**
   * 模板表未命中时获取模板源码的回调，支持同步或异步。
   * 省略时，未命中的模板直接按缺失处理。
   */
  readonly resolveTemplate?: WikitextTemplateResolver | undefined;
  /** 求值调用栈深度上限，默认 40，必须是正整数。 */
  readonly maxDepth?: number;
  /** 实际进入求值的调用次数上限，默认 1000。 */
  readonly maxInvocations?: number;
  /** 展开后源码与单次求值结果的长度上限，默认与原始页面长度上限相同。 */
  readonly maxExpandedLength?: number;
  /** 严格模式：任一可恢复失败或最终解析失败都直接抛错。 */
  readonly strict?: boolean;
  readonly signal?: AbortSignal;
}
