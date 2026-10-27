import { isWikitextDiagnostic } from "./diagnostic";
import { WikitextError } from "./errors";
import { isResolvedParseLimits } from "./limits";
import {
  AST_SCHEMA_VERSION,
  SYNTAX_SCHEMA_VERSION,
  isWikitextParentNode,
  type WikitextDiagnostic,
  type WikitextDocument,
  type WikitextDocumentMeta,
  type WikitextNode,
  type WikitextRoot,
  type WikitextSyntaxRoot,
} from "./model";

/** 可序列化的解析快照，带有 schema 版本。 */
export interface SerializedWikitextDocument {
  readonly astSchemaVersion: typeof AST_SCHEMA_VERSION;
  readonly syntaxSchemaVersion?: typeof SYNTAX_SCHEMA_VERSION;
  readonly source: string;
  readonly ast: WikitextRoot;
  readonly syntax?: WikitextSyntaxRoot;
  readonly meta: WikitextDocumentMeta;
  readonly diagnostics: readonly WikitextDiagnostic[];
}

/**
 * 给解析快照补上 schema 版本，并返回与输入分离的深拷贝。
 * 序列化结果是普通数据，修改它不会影响原始快照。
 * @param document 解析结果。
 */
export function serializeWikitextDocument(document: WikitextDocument): SerializedWikitextDocument {
  const snapshot = structuredClone(document);
  return {
    astSchemaVersion: AST_SCHEMA_VERSION,
    ...(snapshot.syntax ? { syntaxSchemaVersion: SYNTAX_SCHEMA_VERSION } : {}),
    source: snapshot.source,
    ...(snapshot.syntax ? { syntax: snapshot.syntax } : {}),
    ast: snapshot.ast,
    meta: snapshot.meta,
    diagnostics: snapshot.diagnostics,
  };
}

function assertAstNode(value: unknown): asserts value is WikitextNode {
  if (!value || typeof value !== "object") {
    throw new WikitextError("INVALID_DOCUMENT", "Serialized AST node is not an object.");
  }
  const node = value as { type?: unknown; id?: unknown; children?: unknown };
  if (typeof node.type !== "string" || typeof node.id !== "string") {
    throw new WikitextError("INVALID_DOCUMENT", "Serialized AST node is missing type or id.");
  }
  if (node.children !== undefined && !Array.isArray(node.children)) {
    throw new WikitextError("INVALID_DOCUMENT", "Serialized AST node has invalid children.");
  }
}

function assertTree(root: unknown): asserts root is WikitextRoot {
  assertAstNode(root);
  if (root.type !== "root" || !isWikitextParentNode(root)) {
    throw new WikitextError("INVALID_DOCUMENT", "Serialized AST root is not a root node.");
  }
}

/** 校验语法树结构与区间；序列化快照虽然可信，仍拒绝畸形字段进入准备阶段。 */
function assertSyntaxTree(root: unknown): asserts root is WikitextSyntaxRoot {
  if (!root || typeof root !== "object") {
    throw new WikitextError("INVALID_DOCUMENT", "Serialized syntax root is not an object.");
  }
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || typeof value !== "object") {
      throw new WikitextError("INVALID_DOCUMENT", "Serialized syntax node is not an object.");
    }
    const node = value as {
      type?: unknown;
      id?: unknown;
      range?: unknown;
      position?: unknown;
      children?: unknown;
    };
    if (typeof node.type !== "string" || typeof node.id !== "string") {
      throw new WikitextError("INVALID_DOCUMENT", "Serialized syntax node is missing type or id.");
    }
    const range = node.range;
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      !Number.isSafeInteger(range[0]) ||
      !Number.isSafeInteger(range[1]) ||
      (range[0] as number) < 0 ||
      (range[0] as number) > (range[1] as number)
    ) {
      throw new WikitextError("INVALID_DOCUMENT", "Serialized syntax node has an invalid range.");
    }
    const position = node.position as
      | { start?: { offset?: unknown }; end?: { offset?: unknown } }
      | undefined;
    if (
      !position ||
      typeof position !== "object" ||
      position.start?.offset !== range[0] ||
      position.end?.offset !== range[1]
    ) {
      throw new WikitextError(
        "INVALID_DOCUMENT",
        "Serialized syntax node position does not match its range.",
      );
    }
    if (node.children === undefined) {
      continue;
    }
    if (!Array.isArray(node.children)) {
      throw new WikitextError("INVALID_DOCUMENT", "Serialized syntax node has invalid children.");
    }
    stack.push(...(node.children as unknown[]));
  }
  const candidate = root as { type?: unknown; children?: unknown };
  if (candidate.type !== "root" || !Array.isArray(candidate.children)) {
    throw new WikitextError("INVALID_DOCUMENT", "Serialized syntax root is not a root node.");
  }
}

function assertDiagnostics(value: unknown): asserts value is readonly WikitextDiagnostic[] {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new WikitextError("INVALID_DOCUMENT", "Serialized document diagnostics is not an array.");
  }
  for (const entry of value) {
    if (!isWikitextDiagnostic(entry)) {
      throw new WikitextError("INVALID_DOCUMENT", "Serialized document diagnostics is invalid.");
    }
  }
}

/**
 * 校验并恢复解析快照；结构或版本不对时抛出 `WikitextError`。
 * @param value 来自 `serializeWikitextDocument` 或等价结构的数据。
 */
export function restoreWikitextDocument(value: unknown): WikitextDocument {
  if (!value || typeof value !== "object") {
    throw new WikitextError("INVALID_DOCUMENT", "Serialized document is not an object.");
  }
  const candidate = value as Partial<SerializedWikitextDocument>;
  if (candidate.astSchemaVersion !== AST_SCHEMA_VERSION) {
    throw new WikitextError(
      "INVALID_DOCUMENT",
      `Unsupported AST schema version: ${String(candidate.astSchemaVersion)}.`,
    );
  }
  if (typeof candidate.source !== "string") {
    throw new WikitextError("INVALID_DOCUMENT", "Serialized document source is not a string.");
  }
  assertTree(candidate.ast);
  if (candidate.syntax !== undefined) {
    if (candidate.syntaxSchemaVersion !== SYNTAX_SCHEMA_VERSION) {
      throw new WikitextError(
        "INVALID_DOCUMENT",
        `Unsupported syntax schema version: ${String(candidate.syntaxSchemaVersion)}.`,
      );
    }
    assertSyntaxTree(candidate.syntax);
  } else if (candidate.syntaxSchemaVersion !== undefined) {
    throw new WikitextError(
      "INVALID_DOCUMENT",
      "Serialized document has a syntax schema version without a syntax tree.",
    );
  }
  const meta = candidate.meta;
  if (!meta || typeof meta !== "object" || meta.astSchemaVersion !== AST_SCHEMA_VERSION) {
    throw new WikitextError("INVALID_DOCUMENT", "Serialized document meta is invalid.");
  }
  if (!isResolvedParseLimits((meta as { limits?: unknown }).limits)) {
    throw new WikitextError(
      "INVALID_DOCUMENT",
      "Serialized document meta does not record valid effective parse limits.",
    );
  }
  assertDiagnostics(candidate.diagnostics);
  return {
    source: candidate.source,
    ast: candidate.ast,
    ...(candidate.syntax ? { syntax: candidate.syntax } : {}),
    meta,
    diagnostics: candidate.diagnostics === undefined ? [] : candidate.diagnostics,
  };
}
