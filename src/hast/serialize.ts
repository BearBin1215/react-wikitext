import type { Root } from "hast";
import { isWikitextDiagnostic } from "../ast/diagnostic";
import { WikitextError } from "../ast/errors";
import { isResolvedParseLimits } from "../ast/limits";
import { hastBudgetViolation } from "./budget";
import { finalizeHast } from "./finalize";
import { sanitizeHast } from "./sanitize";
import { TOC_AUTO_MIN_HEADINGS } from "./toc";
import {
  AST_SCHEMA_VERSION,
  RENDER_SCHEMA_VERSION,
  isWikitextParentNode,
  type WikitextDiagnostic,
  type WikitextHeadingIdStrategy,
  type WikitextHeadingInfo,
  type WikitextRenderDocument,
  type WikitextRenderMeta,
  type WikitextResolvedPolicy,
  type WikitextRoot,
} from "../ast/model";
import { WIKITEXT_LABEL_KEYS, type WikitextLabels } from "../ast/labels";

/** 可序列化的渲染快照，带有 schema 版本。 */
export interface SerializedWikitextRenderDocument {
  readonly astSchemaVersion: typeof AST_SCHEMA_VERSION;
  readonly renderSchemaVersion: typeof RENDER_SCHEMA_VERSION;
  readonly source: string;
  readonly ast: WikitextRoot;
  readonly hast: Root;
  /** 派生数据：恢复时会按 HAST 重新计算，写入是为了便于检查。 */
  readonly headings: readonly WikitextHeadingInfo[];
  readonly meta: WikitextRenderMeta;
  readonly diagnostics: readonly WikitextDiagnostic[];
}

/**
 * 给渲染快照补上 schema 版本，并返回与输入分离的深拷贝。
 * 序列化结果是普通数据，修改它不会影响原始快照。
 * @param document 准备阶段的结果。
 */
export function serializeWikitextRenderDocument(
  document: WikitextRenderDocument,
): SerializedWikitextRenderDocument {
  const snapshot = structuredClone(document);
  return {
    astSchemaVersion: AST_SCHEMA_VERSION,
    renderSchemaVersion: RENDER_SCHEMA_VERSION,
    source: snapshot.source,
    ast: snapshot.ast,
    hast: snapshot.hast,
    headings: snapshot.headings,
    meta: snapshot.meta,
    diagnostics: snapshot.diagnostics,
  };
}

const HEADING_ID_STRATEGIES: ReadonlySet<string> = new Set<WikitextHeadingIdStrategy>([
  "instance",
  "mediawiki",
  "none",
]);
const POLICY_KEYS = [
  "allowRelativeLinks",
  "allowRelativeImages",
  "allowPluginImages",
  "allowSourceImages",
  "externalLinkTarget",
  "extraTags",
  "stripTags",
] as const;
const POLICY_BOOLEANS = [
  "allowRelativeLinks",
  "allowRelativeImages",
  "allowPluginImages",
  "allowSourceImages",
] as const;
const POLICY_LISTS = ["extraTags", "stripTags"] as const;

function invalid(message: string): never {
  throw new WikitextError("INVALID_DOCUMENT", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function assertPolicy(value: unknown): asserts value is WikitextResolvedPolicy {
  if (!isRecord(value)) {
    invalid("Render document policy is invalid.");
  }
  for (const key of POLICY_KEYS) {
    if (value[key] === undefined) {
      invalid(`Render document policy is missing "${key}".`);
    }
  }
  for (const key of POLICY_BOOLEANS) {
    if (typeof value[key] !== "boolean") {
      invalid(`Render document policy "${key}" is not a boolean.`);
    }
  }
  const target = value.externalLinkTarget;
  if (target !== null && target !== "_blank" && target !== "_self") {
    invalid('Render document policy "externalLinkTarget" is invalid.');
  }
  for (const key of POLICY_LISTS) {
    if (!isStringArray(value[key])) {
      invalid(`Render document policy "${key}" is not a string array.`);
    }
  }
}

function assertLabels(value: unknown): asserts value is WikitextLabels {
  if (!isRecord(value)) {
    invalid("Render document labels are invalid.");
  }
  for (const key of WIKITEXT_LABEL_KEYS) {
    if (typeof value[key] !== "string") {
      invalid(`Render document label "${key}" is not a string.`);
    }
  }
}

function assertHeadings(value: unknown): void {
  if (!Array.isArray(value)) {
    invalid("Render document headings are invalid.");
  }
  for (const entry of value as unknown[]) {
    if (!isRecord(entry)) {
      invalid("Render document headings are invalid.");
    }
    if (
      typeof entry.nodeId !== "string" ||
      typeof entry.level !== "number" ||
      typeof entry.text !== "string" ||
      (entry.id !== undefined && typeof entry.id !== "string")
    ) {
      invalid("Render document headings are invalid.");
    }
  }
}

function assertDiagnostics(value: unknown): void {
  if (!Array.isArray(value)) {
    invalid("Render document diagnostics are invalid.");
  }
  for (const entry of value as unknown[]) {
    if (!isWikitextDiagnostic(entry)) {
      invalid("Render document diagnostics are invalid.");
    }
  }
}

function assertMeta(value: unknown): asserts value is WikitextRenderMeta {
  if (!isRecord(value)) {
    invalid("Render document meta is invalid.");
  }
  if (
    value.astSchemaVersion !== AST_SCHEMA_VERSION ||
    value.renderSchemaVersion !== RENDER_SCHEMA_VERSION
  ) {
    invalid("Unsupported render document schema version.");
  }
  if (
    typeof value.parser !== "string" ||
    typeof value.parserVersion !== "string" ||
    typeof value.sourceNormalized !== "boolean" ||
    typeof value.originalLength !== "number" ||
    (value.pageName !== undefined && typeof value.pageName !== "string")
  ) {
    invalid("Render document meta is invalid.");
  }
  if (!isResolvedParseLimits(value.limits)) {
    invalid('Render document meta "limits" is invalid.');
  }
  if (
    typeof value.headingIdStrategy !== "string" ||
    !HEADING_ID_STRATEGIES.has(value.headingIdStrategy)
  ) {
    invalid('Render document meta "headingIdStrategy" is invalid.');
  }
  assertPolicy(value.policy);
  assertLabels(value.labels);
  if (!isStringArray(value.authorizedImages)) {
    invalid('Render document meta "authorizedImages" is not a string array.');
  }
}

/**
 * 校验序列化的渲染快照。
 *
 * 快照内的 `policy`、`labels` 与 `authorizedImages` 属于**可信边界**：它们由库在准备阶段生成，
 * 恢复时会按快照内的 policy 重新清洗，以重建引用 id、目录与标题锚点等派生结构，
 * 而不是把任意第三方 HAST 变成可信内容。不要用它处理不可信输入。
 * @param value 来自 `serializeWikitextRenderDocument` 或等价结构的数据。
 */
export function restoreWikitextRenderDocument(value: unknown): WikitextRenderDocument {
  if (!isRecord(value)) {
    invalid("Serialized render document is not an object.");
  }
  if (
    value.astSchemaVersion !== AST_SCHEMA_VERSION ||
    value.renderSchemaVersion !== RENDER_SCHEMA_VERSION
  ) {
    invalid("Unsupported render document schema version.");
  }
  if (typeof value.source !== "string") {
    invalid("Render document source is not a string.");
  }
  const ast = value.ast;
  if (
    !isRecord(ast) ||
    ast.type !== "root" ||
    !isWikitextParentNode(ast as unknown as WikitextRoot)
  ) {
    invalid("Render document AST is invalid.");
  }
  const hast = value.hast;
  if (!isRecord(hast) || hast.type !== "root" || !Array.isArray(hast.children)) {
    invalid("Render document HAST is invalid.");
  }
  const violation = hastBudgetViolation(hast);
  if (violation) {
    invalid(violation);
  }
  assertMeta(value.meta);
  assertHeadings(value.headings);
  assertDiagnostics(value.diagnostics);
  const meta = value.meta;
  const diagnostics = [...(value.diagnostics as readonly WikitextDiagnostic[])];
  const sanitized = sanitizeHast(hast as unknown as Root, meta.policy, diagnostics);
  const finalized = finalizeHast(sanitized, {
    policy: meta.policy,
    labels: meta.labels,
    headingIdStrategy: meta.headingIdStrategy,
    authorizedImages: new Set(meta.authorizedImages),
    diagnostics,
    // 快照里的目录已经生成；恢复时只重建派生结构，不重新插入目录。
    toc: "none",
    tocMinHeadings: TOC_AUTO_MIN_HEADINGS,
    tocColumns: 1,
  });
  return {
    source: value.source,
    ast: ast as unknown as WikitextRoot,
    hast: finalized.hast,
    headings: finalized.headings,
    meta,
    diagnostics,
  };
}
