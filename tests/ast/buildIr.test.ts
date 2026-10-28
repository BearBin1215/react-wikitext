import { describe, expect, it } from "vitest";
import { buildSyntaxTree } from "@/parse/buildSyntax";
import type { TokenLike } from "@/parse/loadParser";
import { parseWikitext, WikitextParseError } from "@/parse";
import { flattenNodes } from "@/ast";
import { parse } from "../helpers/parse";

describe("semantic AST construction", () => {
  it("records typed semantic nodes and child order", () => {
    const doc = parse("text\n\n{{Tpl|a=1}}");
    expect(doc.ast.type).toBe("root");
    expect(doc.ast.children.map((node) => node.type)).toEqual(["paragraph", "template"]);
    const template = doc.ast.children[1]!;
    expect(template.type).toBe("template");
    if (template.type !== "template") {
      return;
    }
    expect(template.name).toBe("Template:Tpl");
    expect(template.displayName).toBe("Tpl");
    expect(template.children[0]?.type).toBe("templateParameter");
  });

  it("uses path ids and produces unique ids", () => {
    const doc = parse("== H ==\ntext");
    const ids = flattenNodes(doc.ast).map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("0");
    expect(ids[1]).toBe("0.0");
  });

  it("orders sibling origins without overlap", () => {
    const doc = parse("a [[b]] {{c|d=1}}\n== e ==");
    let previousEnd = 0;
    for (const child of doc.ast.children) {
      expect(child.origin?.range[0] ?? 0).toBeGreaterThanOrEqual(previousEnd);
      const range = child.origin?.range ?? [0, 0];
      expect(range[1]).toBeGreaterThanOrEqual(range[0]);
      previousEnd = range[1];
    }
  });

  it("throws SOURCE_TOO_COMPLEX when the semantic budget is exceeded", () => {
    expect(() => parseWikitext("a [[b]]", { maxSemanticNodes: 2 })).toThrowError(
      WikitextParseError,
    );
    try {
      parseWikitext("a [[b]]", { maxSemanticNodes: 2 });
    } catch (error) {
      expect((error as WikitextParseError).code).toBe("SOURCE_TOO_COMPLEX");
    }
  });

  it("throws SOURCE_TOO_COMPLEX when syntax nesting is too deep", () => {
    let token: TokenLike = { type: "leaf", toString: () => "" };
    for (let index = 0; index < 1_500; index++) {
      const child = token;
      token = { type: "nested", childNodes: [child], toString: () => "" };
    }
    const rootToken: TokenLike = { type: "root", childNodes: [token], toString: () => "" };
    expect(() => buildSyntaxTree(rootToken, "")).toThrowError(WikitextParseError);
  });

  it("applies constructor budgets to the root and stops before later siblings", () => {
    const leaf: TokenLike = { type: "text", toString: () => "a" };
    const nested: TokenLike = {
      type: "paragraph",
      childNodes: [leaf],
      toString: () => "a",
    };
    let siblingVisited = false;
    const sibling: TokenLike = {
      type: "text",
      toString: () => {
        siblingVisited = true;
        return "b";
      },
    };
    const rootToken: TokenLike = {
      type: "root",
      childNodes: [nested, sibling],
      toString: () => "ab",
    };
    expect(() => buildSyntaxTree(rootToken, "ab", { maxSyntaxNodes: 2 })).toThrowError(
      WikitextParseError,
    );
    expect(siblingVisited).toBe(false);
  });

  it("allows the exact node budget and counts the root at depth zero", () => {
    const rootToken: TokenLike = {
      type: "root",
      childNodes: [
        { type: "text", toString: () => "a" },
        { type: "text", toString: () => "b" },
      ],
      toString: () => "ab",
    };
    expect(buildSyntaxTree(rootToken, "ab", { maxSyntaxNodes: 3 }).children).toHaveLength(2);
    expect(() => buildSyntaxTree(rootToken, "ab", { maxSyntaxNodes: 2 })).toThrowError(
      WikitextParseError,
    );
    expect(buildSyntaxTree(rootToken, "ab", { maxDepth: 1 }).type).toBe("root");
    expect(() => buildSyntaxTree(rootToken, "ab", { maxDepth: 0 })).toThrowError(
      WikitextParseError,
    );
  });

  it("keeps template parameters traversable instead of a scalar dictionary", () => {
    const doc = parse("{{Tpl|a=1|2}}");
    const template = flattenNodes(doc.ast).find((node) => node.type === "template");
    expect(template?.type).toBe("template");
    if (template?.type !== "template") {
      return;
    }
    expect(template.children.map((child) => child.type)).toEqual([
      "templateParameter",
      "templateParameter",
    ]);
    const [named, anonymous] = template.children;
    expect(named?.type === "templateParameter" ? named.name : undefined).toBe("a");
    expect(anonymous?.type === "templateParameter" ? anonymous.anonymous : undefined).toBe(true);
    expect(anonymous?.type === "templateParameter" ? anonymous.index : undefined).toBe(1);
  });
});
