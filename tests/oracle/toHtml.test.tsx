import { decodeHTML } from "entities";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WikitextView } from "@/view";
import { oracleHtml, prepare } from "../helpers/parse";

function tagSequence(html: string): string[] {
  return (html.match(/<\/?([a-z0-9]+)[^>]*>/giu) ?? [])
    .map((tag) =>
      tag
        .replace(/^<\//u, "<")
        .replace(/^</u, "")
        .replace(/[^a-z0-9].*$/iu, "")
        .toLowerCase(),
    )
    .map((tag) => (tag === "em" ? "i" : tag === "strong" ? "b" : tag));
}

function textContent(html: string): string {
  return decodeHTML(html.replace(/<[^>]*>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();
}

function browserHtml(source: string): string {
  const rendered = renderToStaticMarkup(
    <WikitextView
      document={prepare(source, {
        resolveLink: (request) => ({ href: `/wiki/${request.target}` }),
      })}
      idPrefix=""
    />,
  );
  return rendered.replace(/^<div class="wtr-view">/u, "").replace(/<\/div>$/u, "");
}

describe("toHtml oracle for structure-stable fixtures", () => {
  const fixtures = [
    "''italic'' '''bold''' with '''''both'''''",
    "a\n\nb",
    "[[A|label]] and [https://example.com text]",
  ];

  for (const source of fixtures) {
    it(`matches normalized structure for ${JSON.stringify(source)}`, () => {
      const expected = oracleHtml(source);
      const actual = browserHtml(source);
      expect(tagSequence(actual)).toEqual(tagSequence(expected));
      expect(textContent(actual)).toBe(textContent(expected));
    });
  }
});
