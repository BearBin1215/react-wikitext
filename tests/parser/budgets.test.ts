import { describe, expect, it } from "vitest";
import {
  createWikitextParser,
  parseWikitext,
  WikitextParseError,
  type WikitextParserAdapter,
  type WikitextSyntaxRoot,
} from "@/parse";
import { MINIMUM_CONFIG } from "../helpers/configs";
import { normalizeConfig } from "@/configs/config";
import { createPositionIndex } from "@/ast/position";
import type { ParserConfig } from "@/configs";

function emptyRoot(source: string): WikitextSyntaxRoot {
  return {
    id: "0",
    type: "root",
    range: [0, source.length],
    position: createPositionIndex(source).position([0, source.length]),
    props: {},
    attributes: [],
    children: [],
  };
}

function adapterWith(root: WikitextSyntaxRoot): WikitextParserAdapter {
  return { name: "fixture", version: "1", parse: () => root };
}

function parseError(run: () => unknown): WikitextParseError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(WikitextParseError);
    return error as WikitextParseError;
  }
  throw new Error("Expected a WikitextParseError.");
}

describe("parse budgets", () => {
  it.each([
    ["maxSourceLength", { maxSourceLength: Number.NaN }],
    ["maxSourceLength", { maxSourceLength: Number.POSITIVE_INFINITY }],
    ["maxSyntaxNodes", { maxSyntaxNodes: Number.NaN }],
    ["maxSemanticNodes", { maxSemanticNodes: Number.POSITIVE_INFINITY }],
    ["maxDepth", { maxDepth: -1 }],
    ["maxDepth", { maxDepth: 1.5 }],
    ["maxSourceLength", { maxSourceLength: 0 }],
    ["maxDepth", { maxDepth: 0 }],
  ])("rejects an invalid %s", (_name, options) => {
    expect(parseError(() => parseWikitext("a", options)).code).toBe("INVALID_CONFIG");
  });

  it("rejects invalid default budgets when the parser is created", () => {
    expect(
      parseError(() =>
        createWikitextParser(adapterWith(emptyRoot("a")), {
          defaults: { maxDepth: Number.NaN },
        }),
      ).code,
    ).toBe("INVALID_CONFIG");
  });

  it("rejects a syntax tree whose root is not a root", () => {
    const root = { ...emptyRoot("a"), type: "text" } as unknown as WikitextSyntaxRoot;
    expect(parseError(() => createWikitextParser(adapterWith(root)).parse("a")).code).toBe(
      "PARSE_FAILED",
    );
  });

  it("rejects a root without children", () => {
    const root = { ...emptyRoot("a"), children: undefined } as unknown as WikitextSyntaxRoot;
    expect(parseError(() => createWikitextParser(adapterWith(root)).parse("a")).code).toBe(
      "PARSE_FAILED",
    );
  });

  it("rejects non-finite ranges", () => {
    const root = emptyRoot("a");
    const broken = {
      ...root,
      children: [
        {
          ...root,
          id: "0.0",
          type: "text",
          range: [Number.NaN, 1],
        },
      ],
    } as unknown as WikitextSyntaxRoot;
    expect(parseError(() => createWikitextParser(adapterWith(broken)).parse("a")).code).toBe(
      "PARSE_FAILED",
    );
  });

  it("rejects a position that disagrees with the range", () => {
    const root = emptyRoot("abc");
    const broken = {
      ...root,
      children: [
        {
          ...root,
          id: "0.0",
          type: "text",
          range: [1, 2],
        },
      ],
    } as unknown as WikitextSyntaxRoot;
    expect(parseError(() => createWikitextParser(adapterWith(broken)).parse("abc")).code).toBe(
      "PARSE_FAILED",
    );
  });
});

describe("normalize depth budget", () => {
  it("rejects extreme list prefixes with a library error instead of RangeError", () => {
    const error = parseError(() => parseWikitext(`${"*".repeat(3_000)} x`));
    expect(error.code).toBe("SOURCE_TOO_COMPLEX");
  });

  it("stops nesting block HTML at the effective maxDepth", () => {
    const source = `${"<div>".repeat(8)}x${"</div>".repeat(8)}`;
    expect(parseError(() => parseWikitext(source, { maxDepth: 5 })).code).toBe(
      "SOURCE_TOO_COMPLEX",
    );
  });

  it("keeps deeply nested block HTML instead of truncating it silently", () => {
    const depth = 24;
    const document = parseWikitext(`${"<div>".repeat(depth)}x${"</div>".repeat(depth)}`);
    let node = document.ast.children[0];
    let levels = 0;
    while (node && node.type === "htmlElement") {
      levels++;
      node = node.children[0];
    }
    expect(levels).toBe(depth);
  });
});

function minimumConfig(): ParserConfig {
  return structuredClone(MINIMUM_CONFIG) as ParserConfig;
}

describe("parser config tuples", () => {
  const base = minimumConfig;

  it.each([
    ["doubleUnderscore", { doubleUnderscore: [null, [], {}, {}] }],
    ["doubleUnderscore", { doubleUnderscore: [[], [], null, {}] }],
    ["doubleUnderscore", { doubleUnderscore: [["toc", 1], [], {}, {}] }],
    ["parserFunction", { parserFunction: [null, {}, [], []] }],
    ["parserFunction", { parserFunction: [{}, {}, null, []] }],
    ["html", { html: [[], null, []] }],
    ["ext", { ext: [null] }],
  ])("rejects malformed %s tuple elements", (_field, override) => {
    const config = { ...base(), ...override } as unknown as ParserConfig;
    expect(parseError(() => normalizeConfig(config)).code).toBe("INVALID_CONFIG");
  });
});
