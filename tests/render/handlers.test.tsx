import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ElementContent } from "hast";
import { prepareWikitext, type WikitextPrepareOptions } from "@/hast";
import { WikitextView } from "@/view";
import { parse } from "../helpers/parse";

const render = (source: string, options: WikitextPrepareOptions): string =>
  renderToStaticMarkup(<WikitextView document={prepareWikitext(parse(source), options)} />);

describe("HAST handlers", () => {
  it("falls back to the built-in conversion when a handler returns undefined", () => {
    const html = render("before {{Tpl}} after", {
      handlers: { template: () => undefined },
    });
    expect(html).toContain("wikitext-template");
    expect(html).toContain("Template not expanded");
  });

  it("drops a node when a handler returns null", () => {
    const html = render("hidden paragraph", { handlers: { paragraph: () => null } });
    expect(html).not.toContain("hidden paragraph");
  });

  it("lets a handler replace a built-in node", () => {
    const replacement: ElementContent = {
      type: "element",
      tagName: "div",
      properties: { "data-custom": "heading" },
      children: [{ type: "text", value: "replaced" }],
    };
    const html = render("== Head ==", { handlers: { heading: () => replacement } });
    expect(html).toContain('data-custom="heading"');
    expect(html).toContain("replaced");
  });
});
