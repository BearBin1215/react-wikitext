import { describe, expect, it, vi } from "vitest";
import { getBrowserParser } from "@/parse/loadParser";

describe("parser loading", () => {
  it("captures the browser parser after the IIFE runs", () => {
    const parser = getBrowserParser();
    expect(typeof parser.parse).toBe("function");
  });

  it("throws PARSER_UNAVAILABLE when the IIFE did not initialize", async () => {
    const original = (globalThis as { Parser?: unknown }).Parser;
    (globalThis as { Parser?: unknown }).Parser = undefined;
    vi.resetModules();
    vi.doMock("wikiparser-node/bundle/bundle.min.js", () => ({}));
    try {
      const module = await import("@/parse/loadParser");
      expect(() => module.getBrowserParser()).toThrow(/Parser/u);
      try {
        module.getBrowserParser();
      } catch (error) {
        expect((error as { code?: string }).code).toBe("PARSER_UNAVAILABLE");
      }
    } finally {
      vi.doUnmock("wikiparser-node/bundle/bundle.min.js");
      vi.resetModules();
      if (original !== undefined) {
        (globalThis as { Parser?: unknown }).Parser = original;
      }
    }
  });
});
