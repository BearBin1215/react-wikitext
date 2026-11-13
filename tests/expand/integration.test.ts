import { describe, expect, it } from "vitest";
import { expandWikitext } from "../helpers/expand";
import { prepareWikitext } from "@/hast";
import { flattenNodes, isNodeType } from "@/ast";

describe("expanded pipeline", () => {
  it("re-parses expanded output into semantic structure", async () => {
    const result = await expandWikitext("{{Box}}", {
      templates: { "Template:Box": "== Head ==\n[[A|label]]" },
    });
    expect(result.snapshot.ast.children.some((node) => node.type === "heading")).toBe(true);
    const link = flattenNodes(result.snapshot.ast).find((node) => isNodeType(node, "link"));
    expect(link).toMatchObject({ target: "A" });
  });

  it("keeps sanitization and diagnostic propagation in the existing pipeline", async () => {
    const result = await expandWikitext("{{Unsafe}}{{Missing}}", {
      templates: {
        "Template:Unsafe": '<script>alert(1)</script><a href="javascript:x">bad</a>',
      },
    });
    const prepared = prepareWikitext(result.snapshot);
    const elements: Array<{ tagName: string; properties: Record<string, unknown> }> = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") {
        return;
      }
      const candidate = node as {
        tagName?: string;
        properties?: Record<string, unknown>;
        children?: unknown[];
      };
      if (typeof candidate.tagName === "string") {
        elements.push({ tagName: candidate.tagName, properties: candidate.properties ?? {} });
      }
      for (const child of candidate.children ?? []) {
        walk(child);
      }
    };
    walk(prepared.hast);
    expect(elements.some((element) => element.tagName === "script")).toBe(false);
    expect(
      elements.some((element) => String(element.properties.href ?? "").startsWith("javascript:")),
    ).toBe(false);
    expect(prepared.diagnostics.some((item) => item.code === "TEMPLATE_NOT_FOUND")).toBe(true);
    expect(prepared.diagnostics.find((item) => item.code === "TEMPLATE_NOT_FOUND")?.stage).toBe(
      "expand",
    );
  });

  it("prepares documents with or without retained syntax", async () => {
    const plain = await expandWikitext("{{Box}}", { templates: { "Template:Box": "text" } });
    expect(plain.snapshot.meta.retainSyntax).toBe(false);
    const plainPrepared = prepareWikitext(plain.snapshot);
    const retained = await expandWikitext("{{Box}}", {
      templates: { "Template:Box": "text" },
      parseOptions: { retainSyntax: true },
    });
    expect(retained.snapshot.meta.retainSyntax).toBe(true);
    const retainedPrepared = prepareWikitext(retained.snapshot);
    expect(JSON.stringify(retainedPrepared.hast)).toBe(JSON.stringify(plainPrepared.hast));
  });

  it("does not run the resolver again during preparation", async () => {
    const requests: string[] = [];
    const result = await expandWikitext("{{Box}}", {
      resolveTemplate: ({ title }) => {
        requests.push(title);
        return "text";
      },
    });
    prepareWikitext(result.snapshot);
    expect(requests).toEqual(["Template:Box"]);
  });
});
