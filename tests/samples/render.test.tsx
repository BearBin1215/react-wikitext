// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { prepareWikitext } from "@/hast";
import { WikitextView } from "@/view";
import { ZH_CONFIG } from "../helpers/configs";
import { loadSampleCorpusFixtures } from "../helpers/sampleCorpus";
import { parse } from "../helpers/parse";

const pages = loadSampleCorpusFixtures();

describe("sample corpus rendering", () => {
  it("renders sample pages without unsafe DOM", () => {
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      const doc = parse(page.text.replace(/\r\n?/gu, "\n"), {
        config: ZH_CONFIG,
        pageName: page.title,
      });
      const html = renderToStaticMarkup(<WikitextView snapshot={prepareWikitext(doc)} />);
      const dom = new JSDOM(html);
      const document = dom.window.document;
      expect(document.querySelector("script"), page.title).toBeNull();
      expect(document.querySelector("iframe, object, embed, form"), page.title).toBeNull();
      expect(document.querySelector("[onerror], [onclick]"), page.title).toBeNull();
      expect(
        document.querySelector('[style*="url("], [style*="expression"]'),
        page.title,
      ).toBeNull();
      expect(
        document.querySelector('a[href^="javascript:"], a[href^="data:"]'),
        page.title,
      ).toBeNull();
      expect(html.length).toBeGreaterThan(100);
    }
  }, 120_000);
});
