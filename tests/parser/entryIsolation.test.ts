import { describe, expect, it, vi } from "vitest";

describe("entry isolation", () => {
  it("view entry does not initialize globalThis.Parser", async () => {
    const original = (globalThis as { Parser?: unknown }).Parser;
    (globalThis as { Parser?: unknown }).Parser = undefined;
    vi.resetModules();
    try {
      const view = await import("@/view");
      expect(typeof view.WikitextView).toBe("function");
      expect((globalThis as { Parser?: unknown }).Parser).toBeUndefined();
    } finally {
      vi.resetModules();
      if (original !== undefined) {
        (globalThis as { Parser?: unknown }).Parser = original;
      }
    }
  });

  it("ast entry does not initialize globalThis.Parser", async () => {
    const original = (globalThis as { Parser?: unknown }).Parser;
    (globalThis as { Parser?: unknown }).Parser = undefined;
    vi.resetModules();
    try {
      const module = await import("@/ast");
      expect(typeof module.flattenNodes).toBe("function");
      expect(typeof module.getSourceText).toBe("function");
      expect((globalThis as { Parser?: unknown }).Parser).toBeUndefined();
    } finally {
      vi.resetModules();
      if (original !== undefined) {
        (globalThis as { Parser?: unknown }).Parser = original;
      }
    }
  });

  it("devtools entry does not initialize globalThis.Parser", async () => {
    const original = (globalThis as { Parser?: unknown }).Parser;
    (globalThis as { Parser?: unknown }).Parser = undefined;
    vi.resetModules();
    try {
      const module = await import("@/devtools");
      expect(typeof module.AstTree).toBe("function");
      expect(typeof module.NodeInspector).toBe("function");
      expect((globalThis as { Parser?: unknown }).Parser).toBeUndefined();
    } finally {
      vi.resetModules();
      if (original !== undefined) {
        (globalThis as { Parser?: unknown }).Parser = original;
      }
    }
  });

  it("root entry exposes the source component and initializes globalThis.Parser", async () => {
    const original = (globalThis as { Parser?: unknown }).Parser;
    (globalThis as { Parser?: unknown }).Parser = undefined;
    vi.resetModules();
    try {
      const root = await import("@/index");
      expect(typeof root.Wikitext).toBe("function");
      expect(typeof root.WikitextView).toBe("function");
      expect((globalThis as { Parser?: unknown }).Parser).toBeDefined();
    } finally {
      vi.resetModules();
      if (original !== undefined) {
        (globalThis as { Parser?: unknown }).Parser = original;
      }
    }
  });
});
