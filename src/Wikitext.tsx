import { useEffect, useMemo, type ReactElement, type ReactNode } from "react";
import { WikitextError, WikitextParseError, WikitextPrepareError } from "./ast/errors";
import { resolveWikitextLabels } from "./ast/labels";
import type { WikitextRenderSnapshot, WikitextParsedSnapshot } from "./ast/model";
import type { WikitextParseOptions, WikitextParser } from "./parser";
import { prepareWikitext } from "./hast/prepare";
import type { WikitextPrepareOptions } from "./hast/types";
import { parseWikitext } from "./parse/adapter";
import { WikitextView } from "./view/WikitextView";
import type { WikitextViewProps } from "./view/types";

/** `<Wikitext>` 内部失败发生的阶段；渲染期失败由视图错误边界处理。 */
export type WikitextFailureStage = "parse" | "prepare";

/** `<Wikitext>` 的错误回调信息。 */
export interface WikitextErrorInfo {
  readonly stage: WikitextFailureStage;
}

/** `<Wikitext>` 的属性。 */
export interface WikitextProps extends Omit<WikitextViewProps, "snapshot"> {
  /** 待渲染的 wikitext 源码。 */
  readonly source: string;
  /** 高级用法：复用已创建的 parser；缺省时使用默认配置。 */
  readonly parser?: WikitextParser;
  /** 解析选项。 */
  readonly parseOptions?: WikitextParseOptions;
  /** 准备选项。 */
  readonly prepareOptions?: WikitextPrepareOptions;
  /**
   * 准备成功后回调，可以读取 `diagnostics`、`headings` 与生效设置。
   *
   * 占位、拦截与降级都以诊断形式记录在快照上，页面本身仍然渲染成功；
   * 需要观测这些情况时使用本回调，而不是 `onError`。
   */
  readonly onPrepared?: (document: WikitextRenderSnapshot) => void;
  /** 解析或准备失败时回调；错误不会继续抛给 React。 */
  readonly onError?: (error: WikitextError, info: WikitextErrorInfo) => void;
  /**
   * 失败时展示的内容；函数形式可以读取错误与阶段。
   * 提供后完全接管错误展示，不再渲染内置的错误容器。
   */
  readonly fallback?: ReactNode | ((error: WikitextError, info: WikitextErrorInfo) => ReactNode);
}

interface ParseOutcome {
  readonly document?: WikitextParsedSnapshot;
  readonly error?: WikitextError;
}

interface PrepareOutcome {
  readonly prepared?: WikitextRenderSnapshot;
  readonly error?: WikitextError;
  readonly stage?: WikitextFailureStage;
}

function asWikitextError(stage: WikitextFailureStage, value: unknown): WikitextError {
  if (value instanceof WikitextError) {
    return value;
  }
  const message = value instanceof Error ? value.message : String(value);
  return stage === "parse"
    ? new WikitextParseError("PARSE_FAILED", message, { cause: value })
    : new WikitextPrepareError("PREPARE_FAILED", message, { stage: "prepare", cause: value });
}

/**
 * 源码组件：内部完成 parse、prepare 与渲染。
 * 解析与准备分别缓存；只改 `prepareOptions` 时会复用上一次的解析结果。
 * 插件与 resolver 必须是纯处理；需要异步调度时请直接使用显式 API。
 */
export function Wikitext({
  source,
  parser,
  parseOptions,
  prepareOptions,
  onPrepared,
  onError,
  fallback,
  ...viewProps
}: WikitextProps): ReactElement {
  const parsed = useMemo<ParseOutcome>(() => {
    try {
      const document = parser
        ? parser.parse(source, parseOptions)
        : parseWikitext(source, parseOptions);
      return { document };
    } catch (error) {
      return { error: asWikitextError("parse", error) };
    }
  }, [parser, source, parseOptions]);

  const outcome = useMemo<PrepareOutcome>(() => {
    if (!parsed.document) {
      return { error: parsed.error, stage: "parse" };
    }
    try {
      return { prepared: prepareWikitext(parsed.document, prepareOptions) };
    } catch (error) {
      return { error: asWikitextError("prepare", error), stage: "prepare" };
    }
  }, [parsed, prepareOptions]);

  useEffect(() => {
    if (outcome.error && outcome.stage) {
      onError?.(outcome.error, { stage: outcome.stage });
    }
  }, [outcome.error, outcome.stage, onError]);

  useEffect(() => {
    if (outcome.prepared) {
      onPrepared?.(outcome.prepared);
    }
  }, [outcome.prepared, onPrepared]);

  if (outcome.error && outcome.stage) {
    const error = outcome.error;
    const info: WikitextErrorInfo = { stage: outcome.stage };
    // 没有 onError 与 fallback 时不吞异常，交给宿主的外层错误边界处理。
    if (!onError && fallback === undefined) {
      throw error;
    }
    if (fallback !== undefined) {
      return <>{typeof fallback === "function" ? fallback(error, info) : fallback}</>;
    }
    const renderFailed = resolveWikitextLabels(prepareOptions?.labels).renderFailed;
    return (
      <div className="wikitext-view wikitext-view--error" role="alert">
        {renderFailed}: {error.message}
      </div>
    );
  }

  // 其余属性原样透传，新增视图属性不会被这里丢掉。
  return <WikitextView snapshot={outcome.prepared!} {...viewProps} />;
}
