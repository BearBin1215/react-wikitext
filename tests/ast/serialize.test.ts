import { describe, expect, it } from "vitest";
import {
  AST_SCHEMA_VERSION,
  SYNTAX_SCHEMA_VERSION,
  WikitextError,
  restoreWikitextSnapshot,
  serializeWikitextSnapshot,
} from "@/ast";
import { parseWikitext } from "@/parse";
import { parse } from "../helpers/parse";

function restoreError(value: unknown): WikitextError {
  try {
    restoreWikitextSnapshot(value);
  } catch (error) {
    expect(error).toBeInstanceOf(WikitextError);
    return error as WikitextError;
  }
  throw new Error("Expected restoring the document to fail.");
}

describe("document serialization", () => {
  it("round-trips a document with retained syntax", () => {
    const document = parse("== H ==\ntext");
    const serialized = JSON.parse(JSON.stringify(serializeWikitextSnapshot(document)));
    const restored = restoreWikitextSnapshot(serialized);
    expect(restored.source).toBe(document.source);
    expect(restored.ast).toEqual(document.ast);
    expect(restored.syntax).toEqual(document.syntax);
    expect(restored.meta).toEqual(document.meta);
    expect(restored.diagnostics).toEqual(document.diagnostics);
  });

  it("omits syntax when it was not retained", () => {
    const serialized = serializeWikitextSnapshot(parseWikitext("text"));
    expect(serialized.syntax).toBeUndefined();
    expect(serialized.syntaxSchemaVersion).toBeUndefined();
    expect(restoreWikitextSnapshot(serialized).syntax).toBeUndefined();
  });

  it("defaults missing diagnostics to an empty list", () => {
    const serialized = serializeWikitextSnapshot(parseWikitext("text"));
    const restored = restoreWikitextSnapshot({ ...serialized, diagnostics: undefined });
    expect(restored.diagnostics).toEqual([]);
  });

  it("rejects documents with a wrong schema or shape", () => {
    const serialized = serializeWikitextSnapshot(parseWikitext("text"));
    const withSyntax = serializeWikitextSnapshot(parse("text"));
    const invalidValues: unknown[] = [
      null,
      { ...serialized, astSchemaVersion: AST_SCHEMA_VERSION + 1 },
      { ...serialized, source: 1 },
      { ...serialized, ast: { type: "paragraph", id: "0", children: [] } },
      { ...serialized, meta: { ...serialized.meta, astSchemaVersion: 0 } },
      { ...serialized, meta: { ...serialized.meta, limits: undefined } },
      { ...serialized, diagnostics: "nope" },
      {
        ...serialized,
        diagnostics: [{ code: "X", stage: "nowhere", severity: "warning", message: "m" }],
      },
      { ...withSyntax, syntaxSchemaVersion: SYNTAX_SCHEMA_VERSION + 1 },
      { ...withSyntax, syntax: { type: "root", id: "0", range: [0, 0], children: [] } },
      {
        ...withSyntax,
        syntax: { ...(withSyntax.syntax as object), range: [-1, 0] },
      },
      { ...withSyntax, syntax: undefined },
    ];
    for (const value of invalidValues) {
      expect(restoreError(value).code).toBe("INVALID_DOCUMENT");
    }
  });

  it("returns a detached copy from serialize", () => {
    const document = parse("text");
    const originalLength = document.ast.children.length;
    const serialized = serializeWikitextSnapshot(document);
    (serialized.ast as unknown as { children: unknown[] }).children.push({
      type: "text",
      id: "0.1",
      value: "mutated",
    });
    expect(document.ast.children).toHaveLength(originalLength);
    expect(JSON.stringify(document.ast)).not.toContain("mutated");
  });
});
