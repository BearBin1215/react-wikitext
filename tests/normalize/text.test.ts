import { describe, expect, it } from "vitest";
import {
  decodeRawText,
  decodeText,
  normalizeInlineText,
  splitParagraphText,
} from "@/normalize/text";

describe("splitParagraphText", () => {
  it("splits on blank lines", () => {
    expect(splitParagraphText("a\n\nb")).toEqual(["a", "b"]);
    expect(splitParagraphText("a\n \n b")).toEqual(["a", " b"]);
    expect(splitParagraphText("a\n\n\nb")).toEqual(["a", "b"]);
  });

  it("keeps single newlines inside a paragraph", () => {
    expect(splitParagraphText("a\nb")).toEqual(["a\nb"]);
  });

  it("handles leading and trailing blank lines", () => {
    expect(splitParagraphText("\n\na\n\n")).toEqual(["", "a", ""]);
  });

  it("collapses single newlines for inline output", () => {
    expect(normalizeInlineText("a\nb")).toBe("a b");
  });

  it("decodes entities once, folding inline newlines for semantic text", () => {
    expect(decodeText("a &amp;\nb")).toBe("a & b");
    expect(decodeRawText("&lt;b&gt;")).toBe("<b>");
  });
});
