import type { Root } from "hast";
import { VFile } from "vfile";
import {
  AST_SCHEMA_VERSION,
  RENDER_SCHEMA_VERSION,
  type WikitextDiagnostic,
  type WikitextParsedSnapshot,
  type WikitextHeadingIdStrategy,
  type WikitextRenderSnapshot,
  type WikitextRoot,
} from "../ast/model";
import { WikitextPrepareError } from "../ast/errors";
import { cloneSemanticTree } from "../ast/ids";
import { RENDER_HAST_BUDGET, hastBudgetViolation, hastNodeCount } from "./budget";
import { omitEmptyTableFillers } from "./fillerFallback";
import { finalizeHast, type FinalizeResult } from "./finalize";
import { sanitizeHast } from "./sanitize";
import type { ResolvedPrepareSettings } from "./settings";
import { toHast } from "./toHast";
import type { WikitextToHastResult, WikitextTocMode } from "./types";

function invalidDocument(message: string): never {
  throw new WikitextPrepareError("INVALID_DOCUMENT", message, { stage: "prepare" });
}

/** 为一次准备创建 VFile，并把原始快照放进 `data` 供插件读取。 */
export function createWikitextFile(document: WikitextParsedSnapshot): VFile {
  const file = new VFile({
    value: document.source,
    ...(document.meta.pageName === undefined ? {} : { path: document.meta.pageName }),
  });
  file.data.wikitextDocument = document;
  return file;
}

/**
 * 校验准备阶段的输入：文档形状、schema 版本、语义根与诊断数组。
 * 畸形输入统一抛 `WikitextPrepareError("INVALID_DOCUMENT")`，不会让原生 TypeError 直接抛出。
 */
export function assertPreparableDocument(
  document: unknown,
): asserts document is WikitextParsedSnapshot {
  if (!document || typeof document !== "object") {
    invalidDocument("prepareWikitext requires a parsed snapshot.");
  }
  const candidate = document as Partial<WikitextParsedSnapshot> & { kind?: unknown };
  if (candidate.kind !== undefined && candidate.kind !== "parsed") {
    invalidDocument(
      "prepare requires a parse snapshot; this value is a render snapshot that has already been prepared.",
    );
  }
  if (typeof candidate.source !== "string") {
    invalidDocument("Wikitext snapshot source is not a string.");
  }
  if (!candidate.graph || typeof candidate.graph !== "object") {
    invalidDocument("Wikitext snapshot is missing its source graph.");
  }
  if (typeof candidate.activeSourceId !== "string") {
    invalidDocument("Wikitext snapshot is missing its active source identity.");
  }
  if ((candidate as { hast?: unknown }).hast !== undefined) {
    invalidDocument(
      "prepare requires a parse snapshot; this value is a render snapshot that has already been prepared.",
    );
  }
  const meta = candidate.meta as
    | { astSchemaVersion?: unknown; renderSchemaVersion?: unknown }
    | undefined;
  if (!meta || typeof meta !== "object") {
    invalidDocument("Wikitext document meta is missing.");
  }
  if (meta.renderSchemaVersion !== undefined) {
    invalidDocument(
      "prepare requires a parse snapshot; this value is a render snapshot that has already been prepared.",
    );
  }
  if (meta.astSchemaVersion !== AST_SCHEMA_VERSION) {
    invalidDocument(`Unsupported AST schema version: ${String(meta.astSchemaVersion)}.`);
  }
  const ast = candidate.ast as { type?: unknown; children?: unknown } | undefined;
  if (!ast || ast.type !== "root" || !Array.isArray(ast.children)) {
    invalidDocument("Wikitext document AST is not a semantic root with children.");
  }
  if (candidate.diagnostics !== undefined && !Array.isArray(candidate.diagnostics)) {
    invalidDocument("Wikitext document diagnostics is not an array.");
  }
}

/** 克隆语义工作树；`structuredClone` 失败时转换成本库错误。 */
export function cloneWorkingAst(document: WikitextParsedSnapshot): WikitextRoot {
  try {
    return cloneSemanticTree(document.ast);
  } catch (error) {
    throw new WikitextPrepareError(
      "PREPARE_FAILED",
      "Semantic tree could not be cloned; semantic nodes must be structured-cloneable.",
      { stage: "wikitext", cause: error },
    );
  }
}

/** 把语义工作树转换为 HAST 并记录授权图片；不运行任何插件。 */
export function convertWorkingAst(
  document: WikitextParsedSnapshot,
  ast: WikitextRoot,
  settings: ResolvedPrepareSettings,
  diagnostics: WikitextDiagnostic[],
): WikitextToHastResult {
  return toHast({
    document,
    ast,
    labels: settings.labels,
    policy: settings.policy,
    ...(settings.resolveLink === undefined ? {} : { resolveLink: settings.resolveLink }),
    ...(settings.resolveImage === undefined ? {} : { resolveImage: settings.resolveImage }),
    ...(settings.handlers === undefined ? {} : { handlers: settings.handlers }),
    authorizedImages: new Set<string>(),
    diagnostics,
    tocSettings: settings.toc,
  });
}

/** 最终整理阶段可以覆盖的设置；unified 的 raw finalize 会用到。 */
export interface FinishPreparedHastOptions {
  /** 覆盖设置中的标题策略。 */
  readonly headingIdStrategy?: WikitextHeadingIdStrategy;
  /** 目录模式；默认没有显式 marker，也没有自动目录需求。 */
  readonly toc?: WikitextTocMode;
  /** 原始快照；用于给补位格降级诊断补充来源与位置。 */
  readonly document?: WikitextParsedSnapshot;
}

/**
 * 对插件处理后的 HAST 做最终清洗与整理；顺序固定为清洗后再整理。
 * 节点数超限时先省略语义表格行末空补位格，再校验渲染快照的 HAST 预算，
 * 保证 prepare 的合法产物总能被 restore 接受。
 */
export function finishPreparedHast(
  hast: Root,
  settings: ResolvedPrepareSettings,
  authorizedImages: ReadonlySet<string>,
  diagnostics: WikitextDiagnostic[],
  options: FinishPreparedHastOptions = {},
): FinalizeResult {
  const sanitized = sanitizeHast(hast, settings.policy, diagnostics);
  const finalized = finalizeHast(sanitized, {
    policy: settings.policy,
    labels: settings.labels,
    headingIdStrategy: options.headingIdStrategy ?? settings.headingIdStrategy,
    authorizedImages,
    diagnostics,
    toc: options.toc ?? "none",
    tocMinHeadings: settings.toc.minHeadings,
    tocColumns: settings.toc.columns,
  });
  if (
    hastNodeCount(finalized.hast, RENDER_HAST_BUDGET.maxNodes + 1) > RENDER_HAST_BUDGET.maxNodes
  ) {
    omitEmptyTableFillers(finalized.hast, options.document, diagnostics);
  }
  const violation = hastBudgetViolation(finalized.hast);
  if (violation) {
    throw new WikitextPrepareError("PREPARE_FAILED", violation, { stage: "finalize" });
  }
  return finalized;
}

/** 装配渲染快照；不重新清洗、不重新解析，也不运行 resolver。 */
export function createRenderDocument(
  document: WikitextParsedSnapshot,
  ast: WikitextRoot,
  finalized: FinalizeResult,
  settings: ResolvedPrepareSettings,
  authorizedImages: ReadonlySet<string>,
  diagnostics: WikitextDiagnostic[],
  /** 覆盖设置中的标题策略；raw finalize 使用。 */
  headingIdStrategy: WikitextHeadingIdStrategy = settings.headingIdStrategy,
): WikitextRenderSnapshot {
  return {
    kind: "render",
    id: document.id,
    activeSourceId: document.activeSourceId,
    graph: document.graph,
    source: document.source,
    ast,
    hast: finalized.hast,
    headings: finalized.headings,
    meta: {
      astSchemaVersion: AST_SCHEMA_VERSION,
      renderSchemaVersion: RENDER_SCHEMA_VERSION,
      parser: document.meta.parser,
      parserVersion: document.meta.parserVersion,
      ...(document.meta.pageName === undefined ? {} : { pageName: document.meta.pageName }),
      sourceNormalized: document.meta.sourceNormalized,
      originalLength: document.meta.originalLength,
      limits: document.meta.limits,
      headingIdStrategy,
      policy: settings.policy,
      labels: settings.labels,
      authorizedImages: [...authorizedImages],
    },
    diagnostics: [...document.diagnostics, ...diagnostics],
  };
}

/** unified 在同步路径遇到异步插件时抛出的固定消息；只按原文匹配。 */
export const ASYNC_IN_SYNC_MESSAGE = "`runSync` finished async. Use `run` instead";

/**
 * 把阶段错误包装为准备错误；已经是准备错误时原样抛出。
 * @param stage 阶段名，写入消息与错误字段。
 * @param error 原始错误。
 * @param prefix 消息前缀；unified 处理器使用自己的措辞。
 */
export function wrapPrepareError(
  stage: string,
  error: unknown,
  prefix = "Preparation failed during",
): never {
  if (error instanceof WikitextPrepareError) {
    throw error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const asyncInSync = error instanceof Error && message === ASYNC_IN_SYNC_MESSAGE;
  throw new WikitextPrepareError(
    asyncInSync ? "ASYNC_PLUGIN_IN_SYNC_PATH" : "PREPARE_FAILED",
    `${prefix} ${stage}: ${message}`,
    { stage: "prepare", ...(error instanceof Error ? { cause: error } : {}) },
  );
}
