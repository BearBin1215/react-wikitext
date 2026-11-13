import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Element, Root, RootContent } from "hast";
import type { VFile } from "vfile";
import { isWikitextParentNode, type WikitextNode, type WikitextRoot } from "@/ast/model";
import { findNodeById, flattenNodes, getSourceText } from "@/ast";
import {
  WikitextPrepareError,
  type WikitextPrepareOptions,
  prepareWikitext,
  prepareWikitextAsync,
  restoreWikitextRenderSnapshot,
  serializeWikitextRenderSnapshot,
} from "@/hast";
import { WikitextError } from "@/ast/errors";
import { WikitextView } from "@/view";
import { configWithHtmlTags } from "../helpers/configs";
import { parse } from "../helpers/parse";

function renderRestoreError(value: unknown): WikitextError {
  try {
    restoreWikitextRenderSnapshot(value);
  } catch (error) {
    expect(error).toBeInstanceOf(WikitextError);
    return error as WikitextError;
  }
  throw new Error("Expected restoring the render document to fail.");
}

function prepareError(run: () => unknown): WikitextPrepareError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(WikitextPrepareError);
    return error as WikitextPrepareError;
  }
  throw new Error("Expected preparation to fail.");
}

function walkWiki(node: WikitextNode, visit: (node: WikitextNode) => void): void {
  visit(node);
  if (isWikitextParentNode(node)) {
    for (const child of node.children) {
      walkWiki(child, visit);
    }
  }
}

const asyncPlugin = () => async (tree: WikitextRoot) => {
  await Promise.resolve();
  return tree;
};

const insertMarkup = () => (tree: Root) => {
  tree.children.push({
    type: "element",
    tagName: "tt",
    properties: { className: ["custom-token"] },
    children: [{ type: "text", value: "mono" }],
  });
};

const insertImage = () => (tree: Root) => {
  tree.children.push({
    type: "element",
    tagName: "img",
    properties: { src: "https://example.com/plugin.png", alt: "Plugin" },
    children: [],
  });
};

const resolveRelativeLink = () => ({ href: "/wiki/A" });

const addCallout = () => (tree: WikitextRoot) => {
  (tree as unknown as { children: WikitextNode[] }).children.push({
    type: "callout",
    id: "callout",
    children: [{ type: "text", id: "callout-text", value: "note" }],
  } as unknown as WikitextNode);
};

function renderPrepared(options: WikitextPrepareOptions): string {
  return renderToStaticMarkup(
    <WikitextView
      snapshot={prepareWikitext(parse("x"), { rehypePlugins: [insertMarkup], ...options })}
      idPrefix=""
    />,
  );
}

function preparePluginImage(allowPluginImages: boolean) {
  return prepareWikitext(parse("x"), {
    rehypePlugins: [insertImage],
    policy: { allowPluginImages },
  });
}

function walkHast(node: Root | RootContent, visit: (node: RootContent) => void): void {
  if (node.type === "root") {
    for (const child of node.children) {
      walkHast(child, visit);
    }
    return;
  }
  visit(node);
  if (node.type === "element") {
    for (const child of node.children) {
      walkHast(child, visit);
    }
  }
}

describe("prepare pipeline", () => {
  it("applies wiki plugins without mutating the original snapshot", () => {
    const document = parse("hello");
    const prepared = prepareWikitext(document, {
      wikitextPlugins: [
        () => (tree: WikitextRoot) => {
          walkWiki(tree, (node) => {
            if (node.type === "text") {
              (node as { value: string }).value = "changed";
            }
          });
        },
      ],
    });
    const originalText = flattenNodes(document.ast).find((node) => node.type === "text");
    expect(originalText?.type === "text" ? originalText.value : undefined).toBe("hello");
    const preparedText = flattenNodes(prepared.ast).find((node) => node.type === "text");
    expect(preparedText?.type === "text" ? preparedText.value : undefined).toBe("changed");
    expect(getSourceText(prepared, preparedText!)).toBe("hello");
  });

  it("refreshes query caches after plugins insert copied nodes", () => {
    const document = parse("one\n\ntwo");
    const prepared = prepareWikitext(document, {
      wikitextPlugins: [
        () => (tree: WikitextRoot) => {
          flattenNodes(tree);
          findNodeById(tree, "0.0");
          const first = tree.children[0];
          if (first) {
            (tree as unknown as { children: WikitextNode[] }).children.unshift(
              structuredClone(first),
            );
          }
        },
      ],
    });
    const flat = flattenNodes(prepared.ast);
    let traversed = 0;
    walkWiki(prepared.ast, () => traversed++);
    expect(flat).toHaveLength(traversed);
    for (const node of flat) {
      expect(findNodeById(prepared.ast, node.id)).toBe(node);
    }
    expect(findNodeById(prepared.ast, "0.0")?.id).toBe("0.0");
  });

  it("rejects async plugins on the sync path and supports the async path", async () => {
    const document = parse("x");
    try {
      prepareWikitext(document, { wikitextPlugins: [asyncPlugin] });
      throw new Error("expected sync prepare to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(WikitextError);
      expect((error as WikitextError).code).toBe("ASYNC_PLUGIN_IN_SYNC_PATH");
    }
    const prepared = await prepareWikitextAsync(document, { wikitextPlugins: [asyncPlugin] });
    expect(prepared.ast.children.length).toBeGreaterThan(0);
  });

  it("preserves allowed plugin classes and strips dangerous attributes and resources", () => {
    const document = parse("x");
    const prepared = prepareWikitext(document, {
      rehypePlugins: [
        () => (tree: Root) => {
          const target = tree.children[0] as Element;
          target.children = [
            {
              type: "element",
              tagName: "span",
              properties: {
                className: ["hljs-keyword"],
                onclick: "alert(1)",
                style: "color:red; background:url(javascript:alert(1))",
              },
              children: [{ type: "text", value: "highlighted" }],
            },
            {
              type: "element",
              tagName: "img",
              properties: { src: "https://example.com/plugin.png" },
              children: [],
            },
          ];
        },
      ],
    });
    const html = renderToStaticMarkup(<WikitextView snapshot={prepared} idPrefix="" />);
    expect(html).toContain('class="hljs-keyword"');
    expect(html).not.toContain("onclick");
    expect(html).toContain("color:red");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
  });

  it("supports label-only links and relative image policy", () => {
    const labelOnly = prepareWikitext(parse("[[A|label]]"), {
      resolveLink: () => ({ label: "custom" }),
    });
    const labelHtml = renderToStaticMarkup(<WikitextView snapshot={labelOnly} idPrefix="" />);
    expect(labelHtml).not.toContain("<a ");
    expect(labelHtml).toContain("custom");

    const defaultImages = prepareWikitext(parse("[[File:X.png]]"), {
      resolveImage: () => ({ src: "/img/x.png" }),
    });
    expect(
      renderToStaticMarkup(<WikitextView snapshot={defaultImages} idPrefix="" />),
    ).not.toContain("<img");

    const relativeImages = prepareWikitext(parse("[[File:X.png]]"), {
      resolveImage: () => ({ src: "/img/x.png" }),
      policy: { allowRelativeImages: true },
    });
    expect(renderToStaticMarkup(<WikitextView snapshot={relativeImages} idPrefix="" />)).toContain(
      'src="/img/x.png"',
    );
  });

  it("maps instance ids independently for multiple views", () => {
    const prepared = prepareWikitext(parse("== A =="));
    const first = renderToStaticMarkup(<WikitextView snapshot={prepared} idPrefix="one-" />);
    const second = renderToStaticMarkup(<WikitextView snapshot={prepared} idPrefix="two-" />);
    expect(first).toContain('id="one-A"');
    expect(second).toContain('id="two-A"');
    expect(second).not.toContain('id="one-A"');
  });

  it("restores a serialized render document", () => {
    const prepared = prepareWikitext(parse("== A ==\n[[B|label]]"));
    const json = JSON.parse(JSON.stringify(serializeWikitextRenderSnapshot(prepared)));
    const restored = restoreWikitextRenderSnapshot(json);
    expect(restored.headings).toEqual(prepared.headings);
    expect(renderToStaticMarkup(<WikitextView snapshot={restored} idPrefix="" />)).toBe(
      renderToStaticMarkup(<WikitextView snapshot={prepared} idPrefix="" />),
    );
  });

  it("rejects serialized render documents without effective limits", () => {
    const serialized = JSON.parse(
      JSON.stringify(serializeWikitextRenderSnapshot(prepareWikitext(parse("text")))),
    );
    const meta = { ...serialized.meta };
    delete meta.limits;
    expect(renderRestoreError({ ...serialized, meta }).code).toBe("INVALID_DOCUMENT");
  });

  it("runs real rehype plugins by walking the HAST tree", () => {
    const prepared = prepareWikitext(parse("text"), {
      rehypePlugins: [
        () => (tree: Root) => {
          walkHast(tree, (node) => {
            if (node.type === "text") {
              node.value = node.value.toUpperCase();
            }
          });
        },
      ],
    });
    expect(prepared.hast.type).toBe("root");
    expect(JSON.stringify(prepared.hast)).toContain("TEXT");
  });

  it("re-sanitizes a tampered serialized render document", () => {
    const serialized = JSON.parse(
      JSON.stringify(serializeWikitextRenderSnapshot(prepareWikitext(parse("text")))),
    );
    serialized.hast.children[0].properties = {
      className: ["wikitext-paragraph"],
      onclick: "alert(1)",
    };
    serialized.hast.children.push(
      {
        type: "element",
        tagName: "script",
        properties: {},
        children: [{ type: "text", value: "alert(1)" }],
      },
      {
        type: "element",
        tagName: "img",
        properties: { src: "https://evil.example/x.png", alt: "leak" },
        children: [],
      },
      {
        type: "element",
        tagName: "a",
        properties: { href: "https://example.com", target: "_top" },
        children: [{ type: "text", value: "link" }],
      },
    );

    const restored = restoreWikitextRenderSnapshot(serialized);
    const json = JSON.stringify(restored.hast);
    expect(json).not.toContain("onclick");
    expect(json).not.toContain("alert(1)");
    expect(json).not.toContain("evil.example");
    expect(json).not.toContain("_top");
    expect(restored.diagnostics).toContainEqual(
      expect.objectContaining({ code: "UNAUTHORIZED_IMAGE", stage: "finalize" }),
    );
  });

  it("rejects serialized render documents with over-budget trees", () => {
    const serialized = serializeWikitextRenderSnapshot(prepareWikitext(parse("text")));

    let deep: RootContent = { type: "text", value: "x" };
    for (let index = 0; index < 1_100; index++) {
      deep = { type: "element", tagName: "span", properties: {}, children: [deep] };
    }
    const tampered = JSON.parse(JSON.stringify(serialized));
    tampered.hast.children = [deep];
    expect(renderRestoreError(tampered).code).toBe("INVALID_DOCUMENT");
  });

  it("honors extraTags and stripTags", () => {
    const strict = renderPrepared({});
    expect(strict).not.toContain("<tt");
    expect(strict).not.toContain("custom-token");
    expect(strict).toContain("mono");

    const relaxed = renderPrepared({ policy: { extraTags: ["tt"] } });
    expect(relaxed).toContain("<tt");
    expect(relaxed).toContain("custom-token");

    const stripped = renderPrepared({ policy: { extraTags: ["tt"], stripTags: ["tt"] } });
    expect(stripped).not.toContain("<tt");
    expect(stripped).not.toContain("mono");
  });

  it("drops plugin images unless allowPluginImages is set", () => {
    const strict = renderToStaticMarkup(
      <WikitextView snapshot={preparePluginImage(false)} idPrefix="" />,
    );
    expect(strict).not.toContain("<img");
    expect(strict).toContain("Plugin");

    const relaxed = renderToStaticMarkup(
      <WikitextView snapshot={preparePluginImage(true)} idPrefix="" />,
    );
    expect(relaxed).toContain('src="https://example.com/plugin.png"');
    expect(relaxed).toContain('loading="lazy"');
  });

  it("authorizes source HTML images separately from plugin images", () => {
    const sourceImage = '<img src="https://example.com/source.png" alt="source">\n\n[[File:X.png]]';
    const config = configWithHtmlTags(["img"]);
    const strict = renderToStaticMarkup(
      <WikitextView
        snapshot={prepareWikitext(parse(sourceImage, { config }), {
          policy: { allowPluginImages: true },
        })}
        idPrefix=""
      />,
    );
    expect(strict).not.toContain("source.png");
    const relaxed = renderToStaticMarkup(
      <WikitextView
        snapshot={prepareWikitext(parse(sourceImage, { config }), {
          policy: { allowSourceImages: true },
          resolveImage: () => ({ src: "https://example.com/resolver.png" }),
        })}
        idPrefix=""
      />,
    );
    expect(relaxed).toContain("https://example.com/source.png");
    expect(relaxed).toContain("https://example.com/resolver.png");
  });

  it("honors allowRelativeLinks for resolver results", () => {
    const strict = renderToStaticMarkup(
      <WikitextView
        snapshot={prepareWikitext(parse("[[A|label]]"), {
          resolveLink: resolveRelativeLink,
          policy: { allowRelativeLinks: false },
        })}
        idPrefix=""
      />,
    );
    expect(strict).not.toContain("<a ");
    expect(strict).not.toContain('href="/wiki/A"');

    const relaxed = renderToStaticMarkup(
      <WikitextView
        snapshot={prepareWikitext(parse("[[A|label]]"), { resolveLink: resolveRelativeLink })}
        idPrefix=""
      />,
    );
    expect(relaxed).toContain('href="/wiki/A"');
  });

  it("collects plugin messages as stage-tagged diagnostics", () => {
    const prepared = prepareWikitext(parse("text"), {
      wikitextPlugins: [
        () => (tree: WikitextRoot, file: VFile) => {
          void tree;
          file.message("custom warning", { ruleId: "TEST_RULE" });
        },
      ],
      rehypePlugins: [
        () => (tree: Root, file: VFile) => {
          void tree;
          file.message("rehype warning", { ruleId: "REHYPE_RULE" });
        },
      ],
    });
    expect(prepared.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "TEST_RULE", stage: "wikitext", severity: "warning" }),
        expect.objectContaining({ code: "REHYPE_RULE", stage: "rehype", severity: "warning" }),
      ]),
    );
  });

  it("renders custom semantic nodes through handlers and reports unhandled ones", () => {
    const unhandled = prepareWikitext(parse("x"), { wikitextPlugins: [addCallout] });
    expect(unhandled.diagnostics).toContainEqual(
      expect.objectContaining({ code: "UNKNOWN_NODE", stage: "hast" }),
    );
    expect(renderToStaticMarkup(<WikitextView snapshot={unhandled} idPrefix="" />)).toContain(
      "Unsupported node: callout",
    );

    const handled = prepareWikitext(parse("x"), {
      wikitextPlugins: [addCallout],
      handlers: {
        callout: () => ({
          type: "element",
          tagName: "span",
          properties: { className: ["wikitext-callout"] },
          children: [{ type: "text", value: "handled" }],
        }),
      },
    });
    expect(renderToStaticMarkup(<WikitextView snapshot={handled} idPrefix="" />)).toContain(
      "handled",
    );
    expect(handled.diagnostics.some((diagnostic) => diagnostic.code === "UNKNOWN_NODE")).toBe(
      false,
    );
  });

  it("reports prepare failures with the failing stage", () => {
    const nonRoot = prepareError(() =>
      prepareWikitext(parse("x"), {
        wikitextPlugins: [() => () => ({ type: "paragraph", id: "0", children: [] }) as never],
      }),
    );
    expect(nonRoot.code).toBe("PREPARE_FAILED");
    expect(nonRoot.stage).toBe("wikitext");

    let deepNode = { type: "text", id: "deep", value: "x" } as WikitextNode;
    for (let index = 0; index < 1_100; index++) {
      deepNode = {
        type: "paragraph",
        id: `p-${index}`,
        children: [deepNode],
      } as unknown as WikitextNode;
    }
    const tooDeep = prepareError(() =>
      prepareWikitext(parse("x"), {
        wikitextPlugins: [
          () => () => ({ type: "root", id: "0", children: [deepNode] }) as unknown as WikitextRoot,
        ],
      }),
    );
    expect(tooDeep.code).toBe("PREPARE_FAILED");
    expect(tooDeep.stage).toBe("wikitext");

    const invalidDocument = prepareError(() => prepareWikitext({} as never));
    expect(invalidDocument.code).toBe("INVALID_DOCUMENT");
    expect(invalidDocument.stage).toBe("prepare");
  });

  it("rejects a render snapshot at runtime", () => {
    const prepared = prepareWikitext(parse("text"));
    const error = prepareError(() => prepareWikitext(prepared as never));
    expect(error.code).toBe("INVALID_DOCUMENT");
    expect(error.message).toMatch(/render snapshot/u);
  });
});
