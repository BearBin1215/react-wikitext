import type { Element, Root } from "hast";
import { describe, expect, it } from "vitest";
import { prepareWikitext, type WikitextPrepareOptions } from "@/hast";
import { parse } from "../helpers/parse";

function withRehype(
  source: string,
  plugin: (tree: Root) => void,
  options: WikitextPrepareOptions = {},
) {
  return prepareWikitext(parse(source), {
    ...options,
    rehypePlugins: [() => plugin],
  });
}

function findElements(root: Root | Element, tagName: string): Element[] {
  const found: Element[] = [];
  const visitChildren = (node: Root | Element): void => {
    for (const child of node.children) {
      if (child.type !== "element") {
        continue;
      }
      if (child.tagName === tagName) {
        found.push(child);
      }
      visitChildren(child);
    }
  };
  visitChildren(root);
  return found;
}

describe("finalize link and image policy", () => {
  it("applies the MediaWiki default rel to plugin links", () => {
    const document = withRehype("x", (tree) => {
      tree.children.push({
        type: "element",
        tagName: "a",
        properties: { href: "https://example.com/page" },
        children: [{ type: "text", value: "external" }],
      });
    });
    const [link] = findElements(document.hast, "a");
    expect(link?.properties.target).toBeUndefined();
    expect(link?.properties.rel).toEqual(["nofollow"]);
  });

  it("keeps rel but drops the default target when policy disables it", () => {
    const document = withRehype(
      "x",
      (tree) => {
        tree.children.push({
          type: "element",
          tagName: "a",
          properties: { href: "https://example.com/page" },
          children: [{ type: "text", value: "external" }],
        });
      },
      { policy: { externalLinkTarget: null } },
    );
    const [link] = findElements(document.hast, "a");
    expect(link?.properties.target).toBeUndefined();
    expect(link?.properties.rel).toEqual(["nofollow"]);
  });

  it("drops relative hrefs when relative links are disabled", () => {
    const document = withRehype(
      "x",
      (tree) => {
        tree.children.push({
          type: "element",
          tagName: "a",
          properties: { href: "/wiki/A" },
          children: [{ type: "text", value: "relative" }],
        });
      },
      { policy: { allowRelativeLinks: false } },
    );
    const [link] = findElements(document.hast, "a");
    expect(link?.properties.href).toBeUndefined();
  });

  it("marks plugin images with lazy loading and decoding only when allowed", () => {
    const document = withRehype(
      "x",
      (tree) => {
        tree.children.push({
          type: "element",
          tagName: "img",
          properties: { src: "https://example.com/x.png", alt: "x" },
          children: [],
        });
      },
      { policy: { allowPluginImages: true } },
    );
    const [image] = findElements(document.hast, "img");
    expect(image?.properties.loading).toBe("lazy");
    expect(image?.properties.decoding).toBe("async");
    expect(document.diagnostics).toHaveLength(0);
  });

  it("removes plugin images with relative sources when relative images are disabled", () => {
    const document = withRehype(
      "x",
      (tree) => {
        tree.children.push({
          type: "element",
          tagName: "img",
          properties: { src: "/x.png", alt: "alt text" },
          children: [],
        });
      },
      { policy: { allowPluginImages: true, allowRelativeImages: false } },
    );
    expect(findElements(document.hast, "img")).toHaveLength(0);
    expect(document.diagnostics.map((entry) => entry.code)).toContain("UNAUTHORIZED_IMAGE");
  });

  it("removes unauthorized plugin images with a diagnostic", () => {
    const document = withRehype("x", (tree) => {
      tree.children.push({
        type: "element",
        tagName: "img",
        properties: { src: "https://example.com/x.png", alt: "alt text" },
        children: [],
      });
    });
    expect(findElements(document.hast, "img")).toHaveLength(0);
    expect(document.diagnostics.map((entry) => entry.code)).toContain("UNAUTHORIZED_IMAGE");
  });
});

describe("finalize table metadata", () => {
  it("marks table rows with their semantic node", () => {
    const document = prepareWikitext(
      parse('{| class="wikitable"\n|+ align="bottom" | Caption\n|-\n| a || b\n|}'),
    );
    const [row] = findElements(document.hast, "tr");
    expect(row?.data).toMatchObject({ wikitext: { type: "tableRow" } });
    const [caption] = findElements(document.hast, "caption");
    expect(caption?.properties.align).toBe("bottom");
  });
});
