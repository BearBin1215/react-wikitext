import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Element, Root, RootContent } from "hast";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WikitextView } from "@/view";
import { prepare, renderView } from "../helpers/parse";
import { readSourceFiles } from "../helpers/sources";

afterEach(cleanup);

function renderSource(source: string): string {
  return renderView(source);
}

function collectAnchors(root: Root): Element[] {
  const anchors: Element[] = [];
  const visit = (node: Root | RootContent): void => {
    if (node.type === "root") {
      for (const child of node.children) {
        visit(child);
      }
      return;
    }
    if (node.type !== "element") {
      return;
    }
    if (node.tagName === "a") {
      anchors.push(node);
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
  return anchors;
}

function ThrowingUnknown(): never {
  throw new Error("render failure");
}

describe("security", () => {
  it("never uses dangerouslySetInnerHTML in library code", () => {
    const sources = readSourceFiles("src");
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      // 类型层用 Omit 排除该属性是安全的；这里只禁止实际传值。
      expect(source).not.toMatch(/dangerouslySetInnerHTML\s*[:=]/u);
    }
  });

  it("escapes banned HTML instead of emitting it", () => {
    const html = renderSource('<script>alert(1)</script>\n<img src="x" onerror="alert(1)">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
  });

  it("rejects entity-encoded javascript resolver URLs", () => {
    const html = renderToStaticMarkup(
      <WikitextView
        document={prepare("[[A|label]]", {
          resolveLink: () => ({ href: "&#106;avascript:alert(1)" }),
        })}
      />,
    );
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("javascript");
  });

  it("normalizes plugin rel values into safe string arrays", () => {
    const prepared = prepare("x", {
      rehypePlugins: [
        () => (tree: Root) => {
          tree.children.unshift(
            {
              type: "element",
              tagName: "a",
              // 插件可能写入非法类型，模拟运行时输入。
              properties: {
                href: "https://example.com/string",
                rel: "noopener bad" as unknown as string[],
              },
              children: [{ type: "text", value: "string" }],
            },
            {
              type: "element",
              tagName: "a",
              properties: { href: "https://example.com/array", rel: ["noreferrer", "bad"] },
              children: [{ type: "text", value: "array" }],
            },
            {
              type: "element",
              tagName: "a",
              properties: { href: "https://example.com/missing" },
              children: [{ type: "text", value: "missing" }],
            },
          );
        },
      ],
    });
    const anchors = prepared.hast.children.filter(
      (node): node is Element => node.type === "element" && node.tagName === "a",
    );
    expect(anchors).toHaveLength(3);
    for (const anchor of anchors) {
      expect(Array.isArray(anchor.properties.rel)).toBe(true);
      expect(new Set(anchor.properties.rel as string[])).toEqual(
        new Set(["nofollow", "noopener", "noreferrer"]),
      );
      expect(anchor.properties.rel).not.toContain("bad");
    }
  });

  it("applies the same rel rule to source, resolver and plugin links", () => {
    const prepared = prepare("[[A|resolver]] [mailto:test@example.com mail] [[B|relative]]", {
      resolveLink: (request) => {
        if (request.target === "A") {
          return { href: "mailto:resolver@example.com" };
        }
        if (request.target === "B") {
          return { href: "/wiki/B", target: "_blank" };
        }
        return undefined;
      },
      rehypePlugins: [
        () => (tree: Root) => {
          tree.children.push({
            type: "element",
            tagName: "a",
            properties: { href: "mailto:plugin@example.com" },
            children: [{ type: "text", value: "plugin" }],
          });
        },
      ],
    });
    const anchors = collectAnchors(prepared.hast);
    const byHref = new Map(
      anchors.map((anchor) => [String(anchor.properties.href), anchor] as const),
    );
    for (const href of [
      "mailto:test@example.com",
      "mailto:resolver@example.com",
      "mailto:plugin@example.com",
    ]) {
      const anchor = byHref.get(href);
      expect(anchor, href).toBeDefined();
      expect(new Set(anchor?.properties.rel as string[])).toEqual(
        new Set(["nofollow", "noopener", "noreferrer"]),
      );
    }
    const relative = byHref.get("/wiki/B");
    expect(relative).toBeDefined();
    expect(new Set(relative?.properties.rel as string[])).toEqual(
      new Set(["noopener", "noreferrer"]),
    );

    const html = renderToStaticMarkup(<WikitextView document={prepared} idPrefix="" />);
    for (const anchor of anchors) {
      expect(html).toContain(`href="${String(anchor.properties.href)}"`);
      expect(html).toContain(`rel="${(anchor.properties.rel as string[]).join(" ")}"`);
    }
  });

  it("applies the same rel rule to file links", () => {
    const prepared = prepare("[[File:X.png|link=mailto:file@example.com]]", {
      resolveImage: () => ({ src: "https://example.com/x.png" }),
    });
    const fileLink = collectAnchors(prepared.hast).find((anchor) =>
      (anchor.properties.className as string[] | undefined)?.includes("wikitext-file__link"),
    );
    expect(fileLink).toBeDefined();
    expect(new Set(fileLink?.properties.rel as string[])).toEqual(
      new Set(["nofollow", "noopener", "noreferrer"]),
    );
  });

  it("keeps rendering other blocks when one block throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <WikitextView
        document={prepare("<tt>x</tt>\n\n== Healthy heading ==")}
        semanticComponents={{ unknown: ThrowingUnknown }}
      />,
    );
    expect(screen.getByText("Render failed: html")).toBeTruthy();
    expect(screen.getByText("Healthy heading")).toBeTruthy();
    error.mockRestore();
  });

  it("reports render errors with the failing node", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const onRenderError = vi.fn();
    render(
      <WikitextView
        document={prepare("<tt>x</tt>")}
        semanticComponents={{ unknown: ThrowingUnknown }}
        onRenderError={onRenderError}
      />,
    );
    expect(onRenderError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        node: expect.objectContaining({ type: "unknown", parserType: "html" }),
      }),
    );
    error.mockRestore();
  });

  it("clears the error state when the document changes", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <WikitextView
        document={prepare("<tt>x</tt>")}
        semanticComponents={{ unknown: ThrowingUnknown }}
      />,
    );
    expect(screen.getByText("Render failed: html")).toBeTruthy();
    rerender(<WikitextView document={prepare("<tt>y</tt>")} />);
    expect(screen.queryByText("Render failed: html")).toBeNull();
    expect(screen.getByText("y")).toBeTruthy();
    error.mockRestore();
  });
});
