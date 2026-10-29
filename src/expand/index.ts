import { WikitextExpandError } from "../ast/errors";
import type { WikitextDiagnostic, WikitextDocument, WikitextDocumentMeta } from "../ast/model";
import {
  ExpansionEngine,
  ExpansionLimitError,
  isFatalParseError,
  parseWithSyntax,
  throwIfAborted,
} from "./evaluator";
import { resolveExpandOptions } from "./options";
import type { WikitextExpandOptions, WikitextExpandedDocument } from "./types";

export { WikitextError, WikitextExpandError } from "../ast/errors";
export type { WikitextExpandErrorCode } from "../ast/errors";
export type {
  WikitextExpandOptions,
  WikitextExpandedDocument,
  WikitextExpansionDiagnostic,
  WikitextExpansionInfo,
  WikitextExpansionKind,
  WikitextExpansionRecord,
  WikitextExpansionRecordStatus,
  WikitextExpansionStatus,
  WikitextTemplateRequest,
  WikitextTemplateResolver,
  WikitextTemplateTable,
} from "./types";

function publicDocument(document: WikitextDocument, retainSyntax: boolean): WikitextDocument {
  if (retainSyntax) {
    return document;
  }
  const meta: WikitextDocumentMeta = {
    astSchemaVersion: document.meta.astSchemaVersion,
    parser: document.meta.parser,
    parserVersion: document.meta.parserVersion,
    ...(document.meta.pageName === undefined ? {} : { pageName: document.meta.pageName }),
    sourceNormalized: document.meta.sourceNormalized,
    originalLength: document.meta.originalLength,
    limits: document.meta.limits,
    retainSyntax: false,
  };
  return {
    source: document.source,
    ast: document.ast,
    meta,
    diagnostics: document.diagnostics,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withDiagnostics(
  document: WikitextDocument,
  extra: readonly WikitextDiagnostic[],
): WikitextDocument {
  return {
    source: document.source,
    ast: document.ast,
    ...(document.syntax === undefined ? {} : { syntax: document.syntax }),
    meta: document.meta,
    diagnostics: [...document.diagnostics, ...extra],
  };
}

/**
 * 可选的前置展开阶段：解析原始源码，按调用结构求值模板与解析器函数，
 * 再把展开后的源码解析为新的文档。默认不启用。
 * 模板源码先查 `options.templates`，未命中时使用 `options.resolveTemplate`；
 * 两者都省略时仍可展开受支持的纯 wikitext 函数，模板调用按缺失处理。
 * @param source 原始 wikitext。
 * @param options 展开选项与模板来源。
 */
export async function expandWikitext(
  source: string,
  options: WikitextExpandOptions = {},
): Promise<WikitextExpandedDocument> {
  const resolved = resolveExpandOptions(options);
  const { signal, strict } = resolved;
  throwIfAborted(signal);

  const originalInternal = parseWithSyntax(
    resolved.parser,
    resolved.parseOptions,
    resolved.pageName,
    resolved.sourceLimit,
    source,
  );
  throwIfAborted(signal);

  const engine = new ExpansionEngine(resolved, originalInternal.source);
  const frame = engine.createRootFrame(originalInternal);
  let output;
  try {
    output = await engine.evaluateDocument(frame);
  } catch (error) {
    if (error instanceof ExpansionLimitError) {
      throw new WikitextExpandError(
        "EXPANSION_TOO_LARGE",
        `The expanded source exceeds the length limit of ${resolved.maxExpandedLength}.`,
      );
    }
    throw error;
  }
  throwIfAborted(signal);
  engine.applyExpandedRanges(output);

  const retainSyntax = resolved.parseOptions.retainSyntax === true;
  const original = publicDocument(originalInternal, retainSyntax);

  let finalInternal: WikitextDocument | undefined;
  let finalError: unknown;
  try {
    finalInternal = parseWithSyntax(
      resolved.parser,
      resolved.parseOptions,
      resolved.pageName,
      resolved.maxExpandedLength,
      output.text,
    );
  } catch (error) {
    if (isFatalParseError(error)) {
      throw error;
    }
    finalError = error;
  }
  // 最终解析本身无法中断；在它前后各检查一次，避免已取消的请求继续产出快照。
  throwIfAborted(signal);

  if (!finalInternal) {
    if (strict) {
      throw new WikitextExpandError(
        "FINAL_PARSE_FAILED",
        "The expanded source could not be parsed.",
        { cause: finalError },
      );
    }
    if (original.source.length > resolved.maxExpandedLength) {
      throw new WikitextExpandError(
        "EXPANSION_TOO_LARGE",
        "The original source exceeds the expanded length limit, so no fallback snapshot can be returned.",
        { cause: finalError },
      );
    }
    engine.markFallback(
      `The expanded source could not be parsed; the original document was returned. ${describeError(
        finalError,
      )}`,
    );
    return {
      original,
      document: withDiagnostics(original, engine.mapDiagnostics(original.source)),
      expansion: engine.toInfo("fallback"),
    };
  }

  const document = publicDocument(finalInternal, retainSyntax);
  const status = engine.hasPreservedRecords() || output.unresolved ? "partial" : "complete";
  return {
    original,
    document: withDiagnostics(document, engine.mapDiagnostics(document.source)),
    expansion: engine.toInfo(status),
  };
}
