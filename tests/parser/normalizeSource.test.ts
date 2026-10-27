import { describe, expect, it } from "vitest";
import { normalizeSource, WikitextParseError } from "@/ast";

describe("normalizeSource", () => {
  it("converts CRLF and CR to LF", () => {
    const result = normalizeSource("a\r\nb\rc\nd");
    expect(result.source).toBe("a\nb\nc\nd");
    expect(result.normalized).toBe(true);
    expect(result.originalLength).toBe(8);
  });

  it("leaves LF input untouched", () => {
    const result = normalizeSource("a\nb");
    expect(result.source).toBe("a\nb");
    expect(result.normalized).toBe(false);
    expect(result.originalLength).toBe(3);
  });

  it("checks the normalized length", () => {
    expect(() => normalizeSource("abcd", 3)).toThrowError(WikitextParseError);
    try {
      normalizeSource("abcd", 3);
    } catch (error) {
      expect((error as WikitextParseError).code).toBe("SOURCE_TOO_LONG");
    }
  });

  it("uses the normalized length for the limit", () => {
    expect(normalizeSource("a\r\nb", 3).source).toBe("a\nb");
  });
});
