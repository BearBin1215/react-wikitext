import { renderToStaticMarkup } from "react-dom/server";
import type { Root } from "hast";
import { describe, expect, it } from "vitest";
import { prepareWikitext } from "@/hast";
import { WikitextView } from "@/view";
import type { WikitextSemanticComponents } from "@/view";
import { ZH_CONFIG } from "../helpers/configs";
import { parse, renderViewWithConfig } from "../helpers/parse";

function renderWithComponents(
  source: string,
  semanticComponents: WikitextSemanticComponents,
): string {
  return renderToStaticMarkup(
    <WikitextView
      document={prepareWikitext(parse(source, { config: ZH_CONFIG }))}
      semanticComponents={semanticComponents}
    />,
  );
}

function render(source: string): string {
  return renderViewWithConfig(source, ZH_CONFIG);
}

describe("extension tags", () => {
  it("renders nowiki as decoded plain text without parsing markup", () => {
    const html = render("<nowiki>[[x]] &amp; {{y}}</nowiki>");
    expect(html).toContain('class="wikitext-nowiki"');
    expect(html).toContain("[[x]] &amp; {{y}}");
    expect(html).not.toContain('class="wikitext-link"');
  });

  it("renders pre with preserved whitespace", () => {
    const html = render("<pre>line 1\n  line 2</pre>");
    expect(html).toContain('<pre class="wikitext-ext-pre"');
    expect(html).toContain("line 1\n  line 2");
  });

  it("renders math and syntaxhighlight placeholders", () => {
    const math = render("<math>x^2</math>");
    expect(math).toContain('class="wikitext-math"');
    expect(math).toContain("x^2");
    const code = render('<syntaxhighlight lang="js">const a = 1;</syntaxhighlight>');
    expect(code).toContain('class="wikitext-ext-code language-js"');
    expect(code).toContain('class="language-js"');
    expect(code).toContain("const a = 1;");
  });

  it("renders gallery placeholders as caption cards", () => {
    const html = render("<gallery>File:A.png|Caption A\nFile:B.png</gallery>");
    expect(html).toContain('class="wikitext-gallery"');
    expect(html.match(/class="wikitext-gallery__item"/gu)).toHaveLength(2);
    expect(html).toContain("A.png");
    expect(html).toContain("B.png");
    expect(html).toContain("Caption A");
  });

  it("resolves gallery images and renders poem stanzas", () => {
    const gallery = renderViewWithConfig(
      "<gallery>File:A.png|Caption A</gallery>",
      ZH_CONFIG,
      {},
      { resolveImage: () => ({ src: "https://example.com/a.png" }) },
    );
    expect(gallery).toContain('src="https://example.com/a.png"');
    expect(gallery).toContain("<figcaption");

    const poem = render("<poem>first\nsecond\n\nthird</poem>");
    expect(poem).toContain('class="wikitext-poem"');
    expect(poem.match(/class="wikitext-poem__stanza"/gu)).toHaveLength(2);
  });

  it("renders unknown extensions as block source cards when standalone", () => {
    const html = render('<templatestyles src="x"/>');
    expect(html).toContain("Unsupported node: ext");
    expect(html).toContain("templatestyles");
    expect(html).toContain('class="wikitext-unknown wikitext-unknown--block"');
  });

  it("keeps unsupported inline extensions inside the paragraph", () => {
    const html = render("before <templatedata>x</templatedata> after");
    expect(html).toContain('class="wikitext-paragraph"');
    expect(html).toContain('class="wikitext-unknown wikitext-unknown--inline"');
    expect(html).toContain("&lt;templatedata&gt;x&lt;/templatedata&gt;");
  });

  it("lets the Extension slot take over unsupported tags", () => {
    const html = renderWithComponents("<poem>x</poem>", {
      extension: ({ name, block }) => (
        <span data-custom-extension={name} data-block={String(block)} />
      ),
    });
    expect(html).toContain('data-custom-extension="poem"');
    expect(html).toContain('data-block="true"');
    expect(html).not.toContain("Unsupported node");
  });

  it("supports an Extension component slot", () => {
    const html = renderWithComponents("<math>x</math>", {
      extension: ({ name, block }) => (
        <span data-custom-extension={name} data-block={String(block)} />
      ),
    });
    expect(html).toContain('data-custom-extension="math"');
    expect(html).not.toContain('class="wikitext-math"');
  });

  it("bridges extraTags and plugin tags through components", () => {
    const document = prepareWikitext(parse("x"), {
      policy: { extraTags: ["custom-tag"] },
      rehypePlugins: [
        () => (tree: Root) => {
          tree.children.push({
            type: "element",
            tagName: "custom-tag",
            properties: {},
            children: [{ type: "text", value: "plugin content" }],
          });
        },
      ],
    });
    const html = renderToStaticMarkup(
      <WikitextView
        document={document}
        components={{
          "custom-tag": ({ children }) => <span data-bridged="yes">{children}</span>,
        }}
      />,
    );
    expect(html).toContain('data-bridged="yes"');
    expect(html).toContain("plugin content");
    expect(html).not.toContain("custom-tag");
  });

  it("prefers the Reference slot for ref", () => {
    const html = renderWithComponents('<ref name="r">note</ref>', {
      reference: ({ node, number }) => (
        <span data-reference={String(node.name)} data-number={String(number)} />
      ),
      extension: () => <span data-custom-extension="unused" />,
    });
    expect(html).toContain('data-reference="r"');
    expect(html).toContain('data-number="1"');
    expect(html).not.toContain("unused");
    expect(html).toMatch(/id="[^"]*cite_note-1"/u);
  });
});
