import type { Root } from "hast";
import { describe, expect, it } from "vitest";
import {
  prepareWikitext,
  restoreWikitextRenderDocument,
  serializeWikitextRenderDocument,
  WikitextError,
  WikitextPrepareError,
} from "@/hast";
import { RENDER_SCHEMA_VERSION } from "@/ast";
import { RENDER_HAST_BUDGET } from "@/hast/budget";
import { parseWikitext } from "@/parse";
import { prepare } from "../helpers/parse";
import { countFillers, sparseTableSource } from "../helpers/sparseTables";

function invalidDocument(run: () => unknown): WikitextError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(WikitextError);
    return error as WikitextError;
  }
  throw new Error("Expected an INVALID_DOCUMENT error.");
}

function snapshot(source: string) {
  return serializeWikitextRenderDocument(prepare(source)) as unknown as Record<string, unknown>;
}

function modifyFirstFiller() {
  return (tree: Root) => {
    const visit = (node: unknown): boolean => {
      if (!node || typeof node !== "object") {
        return false;
      }
      const element = node as {
        tagName?: string;
        properties?: { className?: unknown };
        children?: unknown[];
      };
      const className = element.properties?.className;
      if (
        element.tagName === "td" &&
        Array.isArray(className) &&
        className.includes("wikitext-table__cell--filler")
      ) {
        element.children?.push({ type: "text", value: "kept by plugin" });
        return true;
      }
      return (element.children ?? []).some((child) => visit(child));
    };
    visit(tree);
  };
}

function fillBeyondBudget() {
  return (tree: Root) => {
    for (let index = 0; index <= RENDER_HAST_BUDGET.maxNodes; index++) {
      tree.children.push({ type: "element", tagName: "span", properties: {}, children: [] });
    }
  };
}

describe("render snapshot roundtrip", () => {
  const source = [
    "== Head ==",
    "Text with [[Link]] and a {{Template}}.",
    "",
    '{| class="wikitable"',
    "| a || b",
    "|}",
    "",
    "A footnote<ref>note</ref>.",
    "",
    "== Second ==",
    "Tail.",
  ].join("\n");

  it("serializes and restores the same HAST and headings", () => {
    const prepared = prepare(source);
    const serialized = serializeWikitextRenderDocument(prepared);
    const restored = restoreWikitextRenderDocument(
      JSON.parse(JSON.stringify(serialized)) as unknown,
    );
    expect(restored.hast).toEqual(JSON.parse(JSON.stringify(prepared.hast)) as unknown);
    expect(restored.headings).toEqual(prepared.headings);
    expect(restored.meta).toEqual(JSON.parse(JSON.stringify(prepared.meta)) as unknown);
    expect(restored.diagnostics).toHaveLength(prepared.diagnostics.length);
  });

  it("rejects snapshots without a well-formed meta", () => {
    const value = snapshot("== Head ==");
    const withoutMeta = { ...value, meta: undefined };
    expect(invalidDocument(() => restoreWikitextRenderDocument(withoutMeta)).code).toBe(
      "INVALID_DOCUMENT",
    );
    const withoutPolicy = { ...value, meta: { ...(value.meta as object), policy: undefined } };
    expect(invalidDocument(() => restoreWikitextRenderDocument(withoutPolicy)).message).toContain(
      "policy",
    );
    const missingTagsField = {
      ...value,
      meta: {
        ...(value.meta as Record<string, unknown>),
        policy: {
          ...((value.meta as Record<string, unknown>).policy as object),
          extraTags: undefined,
        },
      },
    };
    expect(invalidDocument(() => restoreWikitextRenderDocument(missingTagsField)).code).toBe(
      "INVALID_DOCUMENT",
    );
  });

  it("rejects snapshots with malformed labels, headings or diagnostics", () => {
    const value = snapshot("== Head ==");
    const meta = value.meta as Record<string, unknown>;
    expect(
      invalidDocument(() =>
        restoreWikitextRenderDocument({
          ...value,
          meta: { ...meta, labels: { ...(meta.labels as object), toc: 1 } },
        }),
      ).code,
    ).toBe("INVALID_DOCUMENT");
    expect(
      invalidDocument(() =>
        restoreWikitextRenderDocument({
          ...value,
          meta: { ...meta, headingIdStrategy: "nope" },
        }),
      ).code,
    ).toBe("INVALID_DOCUMENT");
    expect(
      invalidDocument(() => restoreWikitextRenderDocument({ ...value, headings: [{ nodeId: 1 }] }))
        .code,
    ).toBe("INVALID_DOCUMENT");
    expect(
      invalidDocument(() =>
        restoreWikitextRenderDocument({
          ...value,
          diagnostics: [{ code: "X", stage: "nowhere", severity: "warning", message: "m" }],
        }),
      ).code,
    ).toBe("INVALID_DOCUMENT");
  });

  it("rejects tampered schema versions", () => {
    const value = snapshot("== Head ==");
    expect(
      invalidDocument(() =>
        restoreWikitextRenderDocument({
          ...value,
          renderSchemaVersion: RENDER_SCHEMA_VERSION + 1,
        }),
      ).code,
    ).toBe("INVALID_DOCUMENT");
  });
});

describe("prepare input validation", () => {
  it("rejects non-documents with INVALID_DOCUMENT", () => {
    expect(invalidDocument(() => prepareWikitext(undefined as never)).code).toBe(
      "INVALID_DOCUMENT",
    );
    expect(invalidDocument(() => prepareWikitext({} as never)).message).toContain("source");
  });

  it("rejects a document whose meta is missing", () => {
    const document = parseWikitext("a");
    const broken = { ...document, meta: undefined } as never;
    expect(invalidDocument(() => prepareWikitext(broken)).message).toContain("meta");
  });

  it("rejects a document whose AST is not a root", () => {
    const document = parseWikitext("a");
    const broken = { ...document, ast: { type: "text", id: "0" } } as never;
    expect(invalidDocument(() => prepareWikitext(broken)).code).toBe("INVALID_DOCUMENT");
  });

  it("rejects invalid prepare options before touching the document", () => {
    const document = parseWikitext("a");
    expect(
      invalidDocument(() =>
        prepareWikitext(document, { policy: { allowRelativeLinks: "yes" as never } }),
      ),
    ).toBeInstanceOf(WikitextPrepareError);
    expect(() => prepareWikitext(document, { headingIdStrategy: "nope" as never })).toThrowError(
      WikitextPrepareError,
    );
  });
});

describe("prepare HAST budget", () => {
  it("omits generated filler cells instead of failing an over-budget table layout", () => {
    const prepared = prepareWikitext(parseWikitext(sparseTableSource()));

    const fillerDiagnostics = prepared.diagnostics.filter(
      (item) => item.code === "TABLE_FILLER_BUDGET_EXCEEDED",
    );
    expect(fillerDiagnostics).toHaveLength(45);
    expect(fillerDiagnostics[0]?.position?.start.line).toBeGreaterThan(0);
    expect(countFillers(prepared.hast)).toBe(0);
    const restored = restoreWikitextRenderDocument(serializeWikitextRenderDocument(prepared));
    expect(countFillers(restored.hast)).toBe(0);
    expect(restored.hast).toEqual(prepared.hast);
  });

  it("keeps fillers for ordinary tables that stay within the budget", () => {
    const prepared = prepareWikitext(
      parseWikitext(['{| class="wikitable"', "! a !! b !! c", "|-", "| 1", "|}"].join("\n")),
    );
    expect(prepared.diagnostics.some((item) => item.code === "TABLE_FILLER_BUDGET_EXCEEDED")).toBe(
      false,
    );
    expect(countFillers(prepared.hast)).toBeGreaterThan(0);
  });

  it("keeps fillers that plugins modified", () => {
    const prepared = prepareWikitext(parseWikitext(sparseTableSource()), {
      rehypePlugins: [modifyFirstFiller],
    });
    expect(countFillers(prepared.hast)).toBe(1);
    expect(
      prepared.diagnostics.filter((item) => item.code === "TABLE_FILLER_BUDGET_EXCEEDED"),
    ).toHaveLength(45);
  });

  it("does not apply the fallback to HTML tables", () => {
    const header = `<tr>${Array.from({ length: 100 }, (_, index) => `<th>h${index}</th>`).join("")}</tr>`;
    const sparse = Array.from({ length: 10 }, () => "<tr><td>y</td></tr>").join("");
    const source = Array.from({ length: 45 }, () => `<table>${header}${sparse}</table>`).join(
      "\n\n",
    );
    expect(() => prepareWikitext(parseWikitext(source))).toThrowError(WikitextPrepareError);
  });

  it("still rejects non-filler nodes that exceed the render budget", () => {
    let error: unknown;
    try {
      prepareWikitext(parseWikitext("x"), { rehypePlugins: [fillBeyondBudget] });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(WikitextPrepareError);
    expect((error as WikitextPrepareError).stage).toBe("finalize");
    expect((error as WikitextPrepareError).message).toContain("HAST node count");
  });
});
