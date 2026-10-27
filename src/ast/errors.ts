import type { WikitextRange, WikitextStage } from "./model";

/** 库内错误码，按处理阶段分组。 */
export type WikitextErrorCode =
  | "SOURCE_TOO_LONG"
  | "SOURCE_TOO_COMPLEX"
  | "INVALID_CONFIG"
  | "PARSE_FAILED"
  | "PARSER_UNAVAILABLE"
  | "INVALID_DOCUMENT"
  | "PREPARE_FAILED"
  | "ASYNC_PLUGIN_IN_SYNC_PATH"
  | "INVALID_EXPAND_OPTIONS"
  | "INCOMPATIBLE_PARSER"
  | "TEMPLATE_NOT_FOUND"
  | "TEMPLATE_RESOLVE_FAILED"
  | "TEMPLATE_PARSE_FAILED"
  | "TEMPLATE_LOOP"
  | "UNSUPPORTED_CALL"
  | "UNRESOLVED_DEPENDENCY"
  | "EXPANSION_BUDGET_EXCEEDED"
  | "EXPANSION_TOO_LARGE"
  | "FINAL_PARSE_FAILED"
  | "ABORTED";

/** 展开阶段错误的失败类别。 */
export type WikitextExpandErrorCode = Extract<
  WikitextErrorCode,
  | "INVALID_EXPAND_OPTIONS"
  | "INCOMPATIBLE_PARSER"
  | "TEMPLATE_NOT_FOUND"
  | "TEMPLATE_RESOLVE_FAILED"
  | "TEMPLATE_PARSE_FAILED"
  | "TEMPLATE_LOOP"
  | "UNSUPPORTED_CALL"
  | "UNRESOLVED_DEPENDENCY"
  | "EXPANSION_BUDGET_EXCEEDED"
  | "EXPANSION_TOO_LARGE"
  | "FINAL_PARSE_FAILED"
  | "ABORTED"
>;

/** 所有库错误的基类。 */
export class WikitextError extends Error {
  /** 失败类别，调用方可以据此分支处理。 */
  readonly code: WikitextErrorCode;

  /**
   * @param code 失败类别。
   * @param message 面向开发者的错误说明。
   * @param options 标准错误选项，可通过 `cause` 保留底层异常。
   */
  constructor(code: WikitextErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WikitextError";
    this.code = code;
  }
}

/** 解析阶段错误；构造器只接受解析相关的错误码。 */
export class WikitextParseError extends WikitextError {
  /**
   * @param code 解析阶段的失败类别。
   * @param message 面向开发者的错误说明。
   * @param options 标准错误选项，可通过 `cause` 保留底层异常。
   */
  constructor(
    code: Extract<
      WikitextErrorCode,
      | "SOURCE_TOO_LONG"
      | "SOURCE_TOO_COMPLEX"
      | "INVALID_CONFIG"
      | "PARSE_FAILED"
      | "PARSER_UNAVAILABLE"
    >,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(code, message, options);
    this.name = "WikitextParseError";
  }
}

/** 模板展开阶段错误；严格模式、选项非法或无法返回有效快照时抛出。 */
export class WikitextExpandError extends WikitextError {
  /** 失败涉及的模板标题；无法确定时省略。 */
  readonly templateTitle?: string;
  /** 失败调用在原始源码中的范围；无法定位时省略。 */
  readonly range?: WikitextRange;

  /**
   * @param code 展开阶段的失败类别。
   * @param message 面向开发者的错误说明。
   * @param options 失败涉及的模板、原始调用范围和底层异常。
   */
  constructor(
    code: WikitextExpandErrorCode,
    message: string,
    options: {
      cause?: unknown;
      templateTitle?: string;
      range?: WikitextRange;
    } = {},
  ) {
    super(code, message, { cause: options.cause });
    this.name = "WikitextExpandError";
    if (options.templateTitle !== undefined) {
      this.templateTitle = options.templateTitle;
    }
    if (options.range !== undefined) {
      this.range = options.range;
    }
  }
}

/** 准备阶段错误，额外记录失败所在的阶段。 */
export class WikitextPrepareError extends WikitextError {
  /** 失败所在的阶段；与诊断共用 {@link WikitextStage} 取值。 */
  readonly stage: WikitextStage;

  /**
   * @param code 准备阶段的失败类别。
   * @param message 面向开发者的错误说明。
   * @param options 失败阶段，以及可选的底层异常。
   */
  constructor(
    code: Extract<
      WikitextErrorCode,
      "PREPARE_FAILED" | "INVALID_DOCUMENT" | "ASYNC_PLUGIN_IN_SYNC_PATH"
    >,
    message: string,
    options: { stage: WikitextStage; cause?: unknown },
  ) {
    super(code, message, { cause: options.cause });
    this.name = "WikitextPrepareError";
    this.stage = options.stage;
  }
}
