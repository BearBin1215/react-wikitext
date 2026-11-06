import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_SOURCE_LENGTH,
  createWikiparser,
  createWikitextParser,
  parseWikitext,
  WikitextParseError,
  type WikitextParserAdapter,
  type WikitextSyntaxNode,
  type WikitextSyntaxRoot,
} from "@/parse";
import { AST_SCHEMA_VERSION, flattenNodes } from "@/ast";
import { createPositionIndex } from "@/ast/position";
import { cloneConfig } from "../helpers/parse";

function emptySyntax(source: string): WikitextSyntaxRoot {
  const position = createPositionIndex(source).position([0, source.length]);
  return {
    id: "0",
    type: "root",
    range: [0, source.length],
    position,
    props: {},
    attributes: [],
    children: [],
  };
}

function syntaxWithChildren(source: string, count: number): WikitextSyntaxRoot {
  const root = emptySyntax(source);
  const empty = createPositionIndex(source).position([0, 0]);
  return {
    ...root,
    children: Array.from({ length: count }, (_, index) => ({
      id: `0.${index}`,
      type: "text",
      range: [0, 0] as [number, number],
      position: empty,
      props: {},
      attributes: [],
      children: [],
    })),
  };
}

function parseError(run: () => unknown): WikitextParseError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(WikitextParseError);
    return error as WikitextParseError;
  }
  throw new Error("Expected parsing to throw WikitextParseError.");
}

describe("parseWikitext", () => {
  it("normalizes CRLF and records metadata", () => {
    const parser = createWikiparser({ config: cloneConfig() });
    const doc = parser.parse("a\r\nb", { pageName: "Page" });
    expect(doc.source).toBe("a\nb");
    expect(doc.meta).toMatchObject({
      astSchemaVersion: AST_SCHEMA_VERSION,
      parser: "wikiparser-node",
      parserVersion: "1.48.2",
      pageName: "Page",
      sourceNormalized: true,
      originalLength: 4,
      retainSyntax: false,
    });
    expect(doc.syntax).toBeUndefined();
  });

  it("exposes effective options and records them in the snapshot", () => {
    const parser = createWikiparser({
      defaults: { maxDepth: 10, pageName: "Default" },
    });
    const resolved = parser.resolveOptions({ maxSemanticNodes: 20 });
    expect(resolved).toMatchObject({
      maxDepth: 10,
      maxSemanticNodes: 20,
      maxSourceLength: DEFAULT_MAX_SOURCE_LENGTH,
      pageName: "Default",
      retainSyntax: false,
    });
    expect(parser.resolveOptions({ pageName: "Override" }).pageName).toBe("Override");
    expect(parser.resolveOptions({ retainSyntax: true }).retainSyntax).toBe(true);

    const document = parser.parse("text", { maxSemanticNodes: 20 });
    expect(document.meta.limits).toEqual({
      maxSourceLength: resolved.maxSourceLength,
      maxSyntaxNodes: resolved.maxSyntaxNodes,
      maxSemanticNodes: 20,
      maxDepth: 10,
    });
  });

  it("uses an injected adapter with normalized source and page context", () => {
    const calls: Array<{ source: string; pageName?: string }> = [];
    const adapter: WikitextParserAdapter = {
      name: "custom",
      version: "9.9.9",
      parse(source, context) {
        calls.push({
          source,
          ...(context.pageName === undefined ? {} : { pageName: context.pageName }),
        });
        return emptySyntax(source);
      },
    };
    const parser = createWikitextParser(adapter);
    const doc = parser.parse("a\r\nb", { pageName: "Demo", retainSyntax: true });
    expect(doc.source).toBe("a\nb");
    expect(calls).toEqual([{ source: "a\nb", pageName: "Demo" }]);
    expect(doc.meta.parser).toBe("custom");
    expect(doc.meta.parserVersion).toBe("9.9.9");
    expect(doc.syntax).toBeDefined();
  });

  it("passes the effective limits to the adapter in override order", () => {
    const seen: Array<{ maxSyntaxNodes: number; maxDepth: number } | undefined> = [];
    const adapter: WikitextParserAdapter = {
      name: "limits",
      version: "1",
      parse(source, context) {
        seen.push(context.limits);
        return emptySyntax(source);
      },
    };
    const parser = createWikitextParser(adapter, {
      defaults: { maxSyntaxNodes: 10, maxDepth: 5 },
    });
    parser.parse("a");
    parser.parse("a", { maxSyntaxNodes: 7 });
    parser.parse("a", { maxDepth: 3 });
    expect(seen).toEqual([
      { maxSyntaxNodes: 10, maxDepth: 5 },
      { maxSyntaxNodes: 7, maxDepth: 5 },
      { maxSyntaxNodes: 10, maxDepth: 3 },
    ]);
  });

  it("still rejects an over-budget tree from an adapter that ignores limits", () => {
    const adapter: WikitextParserAdapter = {
      name: "wide",
      version: "1",
      parse(source) {
        return syntaxWithChildren(source, 3);
      },
    };
    const parser = createWikitextParser(adapter);
    expect(parseError(() => parser.parse("a", { maxSyntaxNodes: 2 })).code).toBe(
      "SOURCE_TOO_COMPLEX",
    );
  });

  it("lets the default adapter construct a tree above the default budget when configured", () => {
    const source = "* x\n".repeat(18_000);
    expect(() => parseWikitext(source)).toThrowError(WikitextParseError);
    const document = parseWikitext(source, {
      maxSyntaxNodes: 200_000,
      maxSemanticNodes: 200_000,
      retainSyntax: true,
    });
    expect(document.source).toHaveLength(72_000);
    let syntaxCount = 0;
    const countSyntax = (node: WikitextSyntaxNode): void => {
      syntaxCount++;
      for (const child of node.children) {
        countSyntax(child);
      }
    };
    countSyntax(document.syntax!);
    expect(syntaxCount).toBeGreaterThan(50_000);
    expect(flattenNodes(document.ast).length).toBeGreaterThan(30_000);
    expect(document.meta.parser).toBe("wikiparser-node");
  }, 60_000);

  it("rejects invalid configs", () => {
    expect(parseError(() => createWikiparser({ config: {} as never })).code).toBe("INVALID_CONFIG");
  });

  it("rejects sources over the length limit", () => {
    const error = parseError(() => parseWikitext("abcd", { maxSourceLength: 3 }));
    expect(error.code).toBe("SOURCE_TOO_LONG");
  });

  it("wraps adapter failures with a cause", () => {
    const cause = new Error("boom");
    const adapter: WikitextParserAdapter = {
      name: "failing",
      version: "1",
      parse() {
        throw cause;
      },
    };
    const parser = createWikitextParser(adapter);
    const error = parseError(() => parser.parse("a"));
    expect(error.code).toBe("PARSE_FAILED");
    expect(error.cause).toBe(cause);
  });

  it("rejects an invalid syntax tree", () => {
    const adapter: WikitextParserAdapter = {
      name: "invalid",
      version: "1",
      parse() {
        return undefined as never;
      },
    };
    const parser = createWikitextParser(adapter);
    expect(() => parser.parse("a")).toThrowError(WikitextParseError);
  });
});
