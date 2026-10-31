import { WikitextError } from "../ast/errors";
import { RENDER_SCHEMA_VERSION, type WikitextRenderDocument } from "../ast/model";

function invalid(message: string): never {
  throw new WikitextError("INVALID_DOCUMENT", message);
}

/**
 * 渲染前的轻量运行时校验。
 *
 * TypeScript 只能挡住编译期的误用；这里额外拒绝把解析快照直接交给视图，
 * 以及在跨语言边界（JSON、Worker、缓存）丢掉关键字段的数据。
 * @param value 准备阶段的结果。
 */
export function assertRenderDocument(value: unknown): asserts value is WikitextRenderDocument {
  if (!value || typeof value !== "object") {
    invalid("WikitextView requires a render snapshot from prepareWikitext().");
  }
  const candidate = value as Partial<WikitextRenderDocument>;
  const meta = candidate.meta as { renderSchemaVersion?: unknown } | undefined;
  if (!meta || typeof meta !== "object") {
    invalid("WikitextView received a value without render metadata.");
  }
  if (meta.renderSchemaVersion !== RENDER_SCHEMA_VERSION) {
    if ((meta as { astSchemaVersion?: unknown }).astSchemaVersion !== undefined) {
      invalid(
        "WikitextView received a parse snapshot; pass the result of prepareWikitext() to document instead.",
      );
    }
    invalid(`Unsupported render schema version: ${String(meta.renderSchemaVersion)}.`);
  }
  const hast = candidate.hast as { type?: unknown; children?: unknown } | undefined;
  if (!hast || hast.type !== "root" || !Array.isArray(hast.children)) {
    invalid("WikitextView render snapshot HAST is not a root with children.");
  }
  const ast = candidate.ast as { type?: unknown; children?: unknown } | undefined;
  if (!ast || ast.type !== "root" || !Array.isArray(ast.children)) {
    invalid("WikitextView render snapshot AST is not a semantic root with children.");
  }
  if (!Array.isArray(candidate.headings)) {
    invalid("WikitextView render snapshot headings are not an array.");
  }
  if (!Array.isArray(candidate.diagnostics)) {
    invalid("WikitextView render snapshot diagnostics are not an array.");
  }
}
