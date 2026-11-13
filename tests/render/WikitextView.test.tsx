import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parse, prepare, renderView } from "../helpers/parse";
import { WikitextView } from "@/view";

describe("WikitextView text and structure", () => {
  it("renders paragraphs, decodes entities, and folds single newlines", () => {
    const html = renderView("a &amp; b\nc\n\nd");
    expect(html.match(/<p class="wikitext-paragraph">/gu)).toHaveLength(2);
    expect(html).toContain("a &amp; b c");
  });

  it("keeps spaces between adjacent inline nodes", () => {
    const html = renderView("[[A]] [[B]]");
    expect(html).toContain('</span> <span class="wikitext-link"');
  });

  it("renders headings with stable ids and deduplicates them", () => {
    const html = renderView("== Same ==\n== Same ==\n=== 中文 ===");
    expect(html).toContain('id="Same"');
    expect(html).toContain('id="Same_2"');
    expect(html).toContain('id="中文"');
  });

  it("generates an isolated prefix when idPrefix is omitted", () => {
    const html = renderToStaticMarkup(<WikitextView snapshot={prepare("== A ==")} />);
    expect(html).toMatch(/id="wikitext-[A-Za-z0-9_-]+-A"/u);
  });

  it("renders bold, italic, and combined quotes", () => {
    const html = renderView("''italic'' '''bold''' '''''both'''''");
    expect(html).toContain("<i>italic</i>");
    expect(html).toContain("<b>bold</b>");
    expect(html).toContain("<i><b>both</b></i>");
  });

  it("ignores comments and syntax markers in the preview", () => {
    const html = renderView("a<!-- hidden -->b");
    expect(html).not.toContain("hidden");
    expect(html).toContain("ab");
  });

  it("rejects a parse snapshot at runtime", () => {
    expect(() => renderToStaticMarkup(<WikitextView snapshot={parse("text") as never} />)).toThrow(
      /parse snapshot/u,
    );
  });
});

describe("WikitextView links", () => {
  it("renders internal links as non-navigable text by default", () => {
    const html = renderView("[[Target|Label]]");
    expect(html).toContain('class="wikitext-link"');
    expect(html).toContain('title="Target"');
    expect(html).toContain("Label");
    expect(html).not.toContain("<a ");
  });

  it("uses the page title without the fragment for internal link titles", () => {
    const html = renderView("[[Page#Section|Label]]");
    expect(html).toContain('title="Page"');
    expect(html).not.toContain('title="Page#Section"');
  });

  it("fills empty internal link labels with pipe-trick titles", () => {
    const html = renderView("[[Page (disambiguation)|]] [[Page|]] [[Namespace:Page (context)|]]");
    expect(html.match(/>Page<\/span>/gu)).toHaveLength(3);
    expect(html).not.toMatch(/>\s*<\/span>/u);
  });

  it("uses a resolver for internal links and sanitizes its href", () => {
    const html = renderView(
      "[[Target|Label]]",
      {},
      {
        resolveLink: (request) => ({ href: `/wiki/${request.target}` }),
      },
    );
    expect(html).toContain('href="/wiki/Target"');
    const blocked = renderView(
      "[[Target|Label]]",
      {},
      {
        resolveLink: () => ({ href: "javascript:alert(1)" }),
      },
    );
    expect(blocked).not.toContain("<a ");
  });

  it("maps fragment hrefs into the instance prefix", () => {
    const html = renderView(
      "[[A#Sec|label]]",
      { idPrefix: "one-" },
      {
        resolveLink: () => ({ href: "#Sec" }),
        headingIdStrategy: "instance",
      },
    );
    expect(html).toContain('href="#one-Sec"');
  });

  it("renders safe external links with MediaWiki rel and no default target", () => {
    const html = renderView("[https://example.com text] https://example.org");
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('rel="nofollow"');
    expect(html).not.toContain("target=");
    expect(html).toContain(">text</a>");
    expect(html).toContain("https://example.org");
  });

  it("adds MediaWiki rel tokens when external links open a new window", () => {
    const html = renderView(
      "[https://example.com text]",
      {},
      { policy: { externalLinkTarget: "_blank" } },
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="nofollow noreferrer noopener"');
  });

  it("distinguishes external link kinds and numbers label-less links", () => {
    const html = renderView("[https://example.com] [https://example.com text] https://example.com");
    expect(html).toContain('class="wikitext-ext-link external autonumber"');
    expect(html).toContain('class="wikitext-ext-link external text"');
    expect(html).toContain('class="wikitext-ext-link external free"');
    expect(html).toContain(">[1]</a>");
  });

  it("can omit the external link target", () => {
    const html = renderView(
      "[https://example.com text]",
      {},
      { policy: { externalLinkTarget: null } },
    );
    expect(html).not.toContain("target=");
    expect(html).toContain('rel="nofollow"');
  });

  it("does not create anchors for dangerous protocols", () => {
    const html = renderView("[javascript:alert(1) click]");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain('href="javascript');
  });

  it("renders magic links as plain text without links or cards", () => {
    const html = renderView("ISBN 978-0-306-40615-7, ISBN 0306406152, RFC 1234 and PMID 12345678");
    expect(html).toContain("ISBN 978-0-306-40615-7");
    expect(html).toContain("ISBN 0306406152");
    expect(html).toContain("RFC 1234");
    expect(html).toContain("PMID 12345678");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("wikitext-unknown");
  });

  it("keeps the target text for blocked external links without a label", () => {
    const html = renderView("[javascript:alert(1)]");
    expect(html).not.toContain("<a ");
    expect(html).toContain("javascript:alert(1)");
  });

  it("follows externalLinkTarget for resolver results", () => {
    const html = renderView(
      "[[Target|Label]]",
      {},
      {
        resolveLink: () => ({ href: "https://example.com" }),
        policy: { externalLinkTarget: "_self" },
      },
    );
    expect(html).toContain('target="_self"');
    expect(html).toContain('rel="nofollow"');
  });

  it("lets resolver target win over the external default", () => {
    const html = renderView(
      "[[Target|Label]]",
      {},
      {
        resolveLink: () => ({ href: "https://example.com", target: "_self" }),
      },
    );
    expect(html).toContain('target="_self"');
  });

  it("supports a resolver text label and a semantic Link component", () => {
    const html = renderView(
      "[[Target|Label]]",
      {
        semanticComponents: {
          link: ({ target, href, children }) => (
            <span data-custom-link={href} title={target}>
              {children}
            </span>
          ),
        },
      },
      { resolveLink: () => ({ href: "/wiki/Target", label: "custom" }) },
    );
    expect(html).toContain('data-custom-link="/wiki/Target"');
    expect(html).toContain("custom");
  });

  it("marks mailto resolver links as external for semantic components", () => {
    const html = renderView(
      "[[Mail|mail]]",
      {
        semanticComponents: {
          link: ({ external }) => <span data-external={String(external)} />,
        },
      },
      { resolveLink: () => ({ href: "mailto:test@example.com" }) },
    );
    expect(html).toContain('data-external="true"');
  });
});

describe("WikitextView fallbacks", () => {
  it("supports label overrides at prepare time", () => {
    const html = renderView("[[File:X.png]]", {}, { labels: { filePlaceholder: "文件" } });
    expect(html).toContain("文件: X.png");
  });

  it("renders redirects only for the first semantic node", () => {
    const html = renderView("#REDIRECT [[Target#section]]\nbody");
    expect(html).toContain('class="redirectMsg wikitext-redirect"');
    expect(html).toContain('class="wikitext-redirect__label"');
    expect(html).toContain("Redirect to:");
    expect(html).toContain('class="redirectText wikitext-redirect__list"');
    expect(html).toContain("Target#section");
    expect(html).not.toContain("body");
  });

  it("resolves redirect targets through resolveLink", () => {
    const html = renderView(
      "#REDIRECT [[Target#section]]",
      {},
      { resolveLink: (request) => ({ href: `/wiki/${request.target}` }) },
    );
    expect(html).toContain(
      '<a class="wikitext-redirect__target" title="Target" href="/wiki/Target#section">Target#section</a>',
    );
  });

  it("renders red links when the resolver reports a missing page", () => {
    const html = renderView(
      "[[Missing page]]",
      {},
      {
        resolveLink: () => ({
          href: "/w/index.php?title=Missing_page&action=edit&redlink=1",
          exists: false,
        }),
      },
    );
    expect(html).toContain('class="wikitext-link wikitext-link--resolved new"');
    expect(html).toContain('title="Missing page (page does not exist)"');
  });

  it("applies lang and dir on the container", () => {
    const html = renderView("text", { lang: "ar", dir: "rtl" });
    expect(html).toContain('lang="ar"');
    expect(html).toContain('dir="rtl"');
  });

  it("supports instance prefixes and container props", () => {
    const html = renderView(
      "== A ==",
      {
        idPrefix: "host-",
        className: "extra",
        containerProps: {
          id: "root",
          role: "region",
          "aria-label": "document",
          className: "inner",
        },
      },
      { headingIdStrategy: "instance" },
    );
    expect(html).toContain('id="host-A"');
    expect(html).toContain('class="wikitext-view extra inner"');
    expect(html).toContain('id="root"');
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="document"');
  });

  it("sanitizes invalid instance prefixes and rejects an empty prefix", () => {
    const html = renderView(
      "== A ==",
      { idPrefix: 'bad "prefix' },
      { headingIdStrategy: "instance" },
    );
    expect(html).toContain('id="badprefixA"');
    const empty = renderView("== A ==", { idPrefix: "" }, { headingIdStrategy: "instance" });
    expect(empty).not.toContain('id="A"');
    expect(empty).toMatch(/id="wikitext-[^"]+-A"/u);
  });

  it("keeps mediawiki anchors without an instance prefix", () => {
    const html = renderToStaticMarkup(
      <WikitextView
        snapshot={prepare("== A ==", { headingIdStrategy: "mediawiki" })}
        idPrefix="host-"
      />,
    );
    expect(html).toContain('id="A"');
    expect(html).not.toContain('id="host-A"');
  });
});
