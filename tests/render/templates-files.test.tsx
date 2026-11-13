import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { WikitextImageResolver } from "@/hast";
import { WikitextView } from "@/view";
import { ZH_CONFIG } from "../helpers/configs";
import { prepare, renderView, renderViewWithConfig } from "../helpers/parse";

function render(source: string, resolveImage?: WikitextImageResolver): string {
  return renderViewWithConfig(source, ZH_CONFIG, {}, resolveImage ? { resolveImage } : {});
}

describe("templates and parser functions", () => {
  it("renders standalone templates as block cards with parameters", () => {
    const html = render("{{Infobox|name=x|1|2}}");
    expect(html).toContain("wikitext-template--block");
    expect(html).toContain("Template not expanded: Infobox");
    expect(html).toContain("wikitext-template__param-name");
    expect(html).toContain("name");
    expect(html).toContain("1");
  });

  it("renders inline templates as compact badges", () => {
    const html = render("before {{Tpl}} after");
    expect(html).toContain("wikitext-template--inline");
    expect(html).toContain("before");
    expect(html).toContain("after");
  });

  it("renders parser functions and arguments without evaluating them", () => {
    const html = render("{{#if:a|b}}\n\n{{{arg|fallback}}}");
    expect(html).toContain("Parser function not evaluated: if");
    expect(html).toContain("wikitext-magic-word--block");
    expect(html).toContain("wikitext-template__param-name");
    expect(html).toContain("wikitext-argument");
    expect(html).toContain("fallback");
  });

  it("renders nested templates inside parameters as inline badges", () => {
    const html = render("{{Outer|p={{Inner|x}}}}");
    expect(html).toContain("Template not expanded: Outer");
    expect(html).toContain("Template not expanded: Inner");
  });

  it("uses semantic component overrides for templates and files", () => {
    const template = renderToStaticMarkup(
      <WikitextView
        snapshot={prepare("{{Tpl}}")}
        semanticComponents={{
          template: () => <span data-custom="template">custom template</span>,
        }}
      />,
    );
    expect(template).toContain('data-custom="template"');
    expect(template).not.toContain("Template not expanded");
    const file = renderToStaticMarkup(
      <WikitextView
        snapshot={prepare("[[File:X.png]]")}
        semanticComponents={{
          file: () => <span data-custom="file">custom file</span>,
        }}
      />,
    );
    expect(file).toContain('data-custom="file"');
    expect(file).not.toContain("wikitext-file__label");
  });
});

describe("files", () => {
  it("renders a placeholder with file name and caption", () => {
    const html = render("[[File:X.png|thumb|9999px|Cap [[L]]]]");
    expect(html).toContain("wikitext-file--block");
    expect(html).toContain("wikitext-file--placeholder");
    expect(html).toContain("File: X.png");
    expect(html).toContain("wikitext-link");
    expect(html).toContain("Cap");
    expect(html).not.toContain("<img");
  });

  it("renders inline file placeholders inside paragraphs", () => {
    const html = render("before [[File:X.png]] after");
    expect(html).toContain("wikitext-file--inline");
    expect(html).toContain("before");
    expect(html).toContain("after");
  });

  it("uses the MediaWiki 1.43 wrapper, typeof and description link", () => {
    const html = renderView(
      "[[File:X.png|thumb|right|200px|Caption]]",
      {},
      {
        resolveImage: () => ({ src: "https://example.com/x.png" }),
        resolveLink: (request) => ({ href: `/wiki/${request.target}` }),
      },
    );
    expect(html).toContain(
      '<figure class="wikitext-file wikitext-file--block wikitext-file--media mw-halign-right" typeof="mw:File/Thumb"',
    );
    expect(html).toContain(
      '<a class="mw-file-description wikitext-file__link" href="/wiki/File:X.png">',
    );
    expect(html).toContain('class="wikitext-file__image mw-file-element"');
    expect(html).toContain('<figcaption class="wikitext-file__caption">Caption</figcaption>');
  });

  it("treats inline thumbnails as block figures and keeps plain images inline", () => {
    const thumb = renderView(
      "abc [[File:X.png|thumb|Caption]] def",
      {},
      {
        resolveImage: () => ({ src: "https://example.com/x.png" }),
      },
    );
    expect(thumb).toContain('<p class="wikitext-paragraph">abc</p><figure');
    expect(thumb).toContain('</figure><p class="wikitext-paragraph">def</p>');
    expect(thumb).toContain('typeof="mw:File/Thumb"');

    const plain = renderView(
      "[[File:X.png|200px|Caption]]",
      {},
      {
        resolveImage: () => ({ src: "https://example.com/x.png" }),
      },
    );
    expect(plain).toContain('class="wikitext-file wikitext-file--inline wikitext-file--media"');
    expect(plain).toContain('typeof="mw:File"');
    expect(plain).not.toContain("wikitext-file__caption");
  });

  it("maps frame and frameless formats to MediaWiki types and wrappers", () => {
    const framed = renderView(
      "[[File:X.png|frame|Caption]]",
      {},
      {
        resolveImage: () => ({ src: "https://example.com/x.png" }),
      },
    );
    expect(framed).toContain('typeof="mw:File/Frame"');
    expect(framed).not.toContain("mw-default-size");
    expect(framed).toContain("<figcaption");

    const frameless = renderView(
      "[[File:X.png|frameless|120px|right|Caption]]",
      {},
      {
        resolveImage: () => ({ src: "https://example.com/x.png" }),
      },
    );
    expect(frameless).toContain('typeof="mw:File/Frameless"');
    expect(frameless).toContain("mw-halign-right");
  });

  it("adds MediaWiki border and vertical alignment modifier classes", () => {
    const html = renderView(
      "[[File:X.png|thumb|border|baseline|Caption]]",
      {},
      {
        resolveImage: () => ({ src: "https://example.com/x.png" }),
      },
    );
    expect(html).toContain("mw-image-border");
    expect(html).toContain("mw-valign-baseline");
    expect(html).toContain("wikitext-file--media");
  });

  it("uses a safe resolver image with lazy loading and clamped dimensions", () => {
    const html = render("[[File:X.png|9999px|Caption]]", () => ({
      src: "https://example.com/x.png",
      width: 9_999,
      height: 5,
    }));
    expect(html).toContain('src="https://example.com/x.png"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('class="wikitext-file__image mw-file-element"');
    expect(html).toContain('width="4096"');
    expect(html).toContain('height="5"');
    expect(html).toContain('alt="Caption"');
  });

  it("adds MediaWiki file classes for default size and alignment", () => {
    const html = render("[[File:X.png|thumb|left|class=foo|Caption]]", () => ({
      src: "https://example.com/x.png",
    }));
    expect(html).toContain(
      'class="wikitext-file wikitext-file--block wikitext-file--media mw-default-size mw-halign-left foo"',
    );
    expect(html).toContain('class="wikitext-file__image mw-file-element"');
  });

  it("rejects unsafe resolver image URLs", () => {
    const html = render("[[File:X.png]]", () => ({ src: "javascript:alert(1)" }));
    expect(html).not.toContain("<img");
    expect(html).toContain("File: X.png");
  });

  it("renders block content in template parameter values", () => {
    const html = render("{{T\n|1=\n* a\n* b\n}}");
    expect(html).toContain('class="wikitext-template wikitext-template--block"');
    expect(html).toContain('class="wikitext-list wikitext-list--ul"');
    expect(html.match(/class="wikitext-list__item"/gu)).toHaveLength(2);
    expect(html).not.toContain("Unsupported node");
  });

  it("uses explicit alt text and the last unnamed caption", () => {
    const html = render(
      "[[File:X.png|thumb|alt=Alt text|First|Last|lang=zh|class=foo|upright=1.2]]",
      () => ({ src: "https://example.com/x.png" }),
    );
    expect(html).toContain('alt="Alt text"');
    expect(html).toContain("Last");
    expect(html).not.toContain("First");
    expect(html).not.toContain("lang=zh");
  });

  it("strips the caption= key from explicit captions", () => {
    const html = render("[[File:X.png|thumb|Unnamed|caption=Cap text]]", () => ({
      src: "https://example.com/x.png",
    }));
    expect(html).toContain("Cap text");
    expect(html).not.toContain("Unnamed");
    expect(html).not.toContain("caption=");
  });

  it("honors link= on files", () => {
    const html = render("[[File:X.png|link=Target]]", () => ({
      src: "https://example.com/x.png",
    }));
    expect(html).toContain('href="Target"');
  });

  it("applies dimensions from file parameters", () => {
    const html = render("[[File:X.png|200x100px]]", () => ({
      src: "https://example.com/x.png",
    }));
    expect(html).toContain('width="200"');
    expect(html).toContain('height="100"');
  });

  it("calls resolveImage with a request and resolver context", () => {
    const resolver = vi.fn((..._args: unknown[]) => ({ src: "https://example.com/x.png" }));
    render("[[File:X.png]]", resolver);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver.mock.calls[0]).toHaveLength(2);
    expect(resolver.mock.calls[0]?.[0]).toMatchObject({ name: "X.png" });
  });

  it("supports an img component slot", () => {
    const html = renderToStaticMarkup(
      <WikitextView
        snapshot={prepare("[[File:X.png]]", {
          resolveImage: () => ({ src: "https://example.com/x.png", alt: "custom alt" }),
        })}
        components={{
          img: ({ src, alt }) => <span data-custom-image={src}>{alt}</span>,
        }}
      />,
    );
    expect(html).toContain('data-custom-image="https://example.com/x.png"');
    expect(html).toContain("custom alt");
    expect(html).not.toContain("<img");
  });
});
