import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  WikitextExpandError,
  createTemplateTableProvider,
  type WikitextTemplateRequest,
  type WikitextTemplateSnapshot,
} from "@/expand";
import type { WikitextParser } from "@/parse";
import { expandWikitext, parserThrowingOn, type WikitextExpandOptions } from "../helpers/expand";

const request: WikitextTemplateRequest = {
  title: "Template:Own",
  location: { sourceId: "input:test@1", start: 0, end: 0 },
};

function snapshotOf(table: unknown): WikitextTemplateSnapshot {
  const provider = createTemplateTableProvider({
    key: "test",
    revision: "v1",
    templates: table as never,
  });
  return provider.open({ key: "page", revision: "1" }) as WikitextTemplateSnapshot;
}

const asTable = (value: unknown) => value as WikitextExpandOptions["templates"];

function expectInvalid(message: string, code: string, run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(WikitextExpandError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(message);
}

describe("template sources", () => {
  it("looks up records and maps by the exact requested title", async () => {
    const fromRecord = await expandWikitext("{{Box}}/{{Missing}}", {
      templates: { "Template:Box": "box" },
    });
    expect(fromRecord.snapshot.source).toBe("box/{{Missing}}");
    expect(fromRecord.expansion.status).toBe("partial");
    expect(fromRecord.expansion.diagnostics[0]).toMatchObject({
      code: "TEMPLATE_NOT_FOUND",
      templateTitle: "Template:Missing",
    });

    const fromMap = await expandWikitext("{{Box}}", {
      templates: new Map([["Template:Box", "map"]]),
    });
    expect(fromMap.snapshot.source).toBe("map");
    expect(fromMap.expansion.status).toBe("complete");

    const empty = await expandWikitext("{{Box}}", { templates: {} });
    expect(empty.snapshot.source).toBe("{{Box}}");
    expect(empty.expansion.status).toBe("partial");
  });

  it("does not fall back to short or differently cased keys", async () => {
    const result = await expandWikitext("{{Box}}", {
      templates: { Box: "short", "template:box": "lower" },
    });
    expect(result.snapshot.source).toBe("{{Box}}");
    expect(result.expansion.diagnostics[0]).toMatchObject({
      code: "TEMPLATE_NOT_FOUND",
      templateTitle: "Template:Box",
    });
  });

  it("prefers local entries and treats an empty string as a hit", async () => {
    const resolveTemplate = vi.fn((_request: WikitextTemplateRequest) => "remote");
    const result = await expandWikitext("{{Box}}{{Empty}}{{Other}}", {
      templates: { "Template:Box": "local", "Template:Empty": "" },
      resolveTemplate,
    });
    expect(result.snapshot.source).toBe("localremote");
    expect(resolveTemplate).toHaveBeenCalledTimes(1);
    expect(resolveTemplate.mock.calls[0]?.[0]).toMatchObject({ title: "Template:Other" });
  });

  it("does not fall back when a local template fails to parse", async () => {
    const resolveTemplate = vi.fn(() => "remote");
    const result = await expandWikitext("{{Box}}", {
      templates: { "Template:Box": "BROKEN" },
      resolveTemplate,
      parser: parserThrowingOn("BROKEN"),
    });
    expect(result.snapshot.source).toBe("{{Box}}");
    expect(result.expansion.diagnostics[0]?.code).toBe("TEMPLATE_PARSE_FAILED");
    expect(resolveTemplate).not.toHaveBeenCalled();

    await expect(
      expandWikitext("{{Box}}", {
        templates: { "Template:Box": "BROKEN" },
        resolveTemplate,
        parser: parserThrowingOn("BROKEN"),
        strict: true,
      }),
    ).rejects.toMatchObject({ code: "TEMPLATE_PARSE_FAILED", templateTitle: "Template:Box" });
  });

  it("uses the callback when the table is empty", async () => {
    const resolveTemplate = vi.fn((_request: WikitextTemplateRequest) => "remote");
    const result = await expandWikitext("{{Box}}", { templates: {}, resolveTemplate });
    expect(result.snapshot.source).toBe("remote");
    expect(resolveTemplate).toHaveBeenCalledTimes(1);
  });

  it("copies the table when the call starts", async () => {
    const templates: Record<string, string> = { "Template:A": "first" };
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = expandWikitext("{{A}}{{B}}", {
      templates,
      resolveTemplate: async () => {
        await gate;
        return "remote";
      },
    });
    templates["Template:A"] = "second";
    templates["Template:B"] = "late";
    release?.();
    const result = await pending;
    expect(result.snapshot.source).toBe("firstremote");

    const next = await expandWikitext("{{A}}{{B}}", { templates });
    expect(next.snapshot.source).toBe("secondlate");
  });

  it("resolves nested templates across mixed sources and caches by title", async () => {
    const resolveTemplate = vi.fn(({ title }: { title: string }) =>
      title === "Template:Middle" ? "{{Inner}}" : null,
    );
    const result = await expandWikitext("{{Outer}}{{Outer}}", {
      templates: { "Template:Outer": "[{{Middle}}]", "Template:Inner": "inner" },
      resolveTemplate,
    });
    expect(result.snapshot.source).toBe("[inner][inner]");
    expect(result.expansion.status).toBe("complete");
    expect(resolveTemplate).toHaveBeenCalledTimes(1);

    const missing = vi.fn(() => null);
    const cachedMissing = await expandWikitext("{{Nope}}{{Nope}}", {
      resolveTemplate: missing,
    });
    expect(missing).toHaveBeenCalledTimes(1);
    expect(cachedMissing.expansion.diagnostics.map((entry) => entry.code)).toEqual([
      "TEMPLATE_NOT_FOUND",
      "TEMPLATE_NOT_FOUND",
    ]);

    const failing = vi.fn(() => {
      throw new Error("boom");
    });
    const cachedFailure = await expandWikitext("{{Nope}}{{Nope}}", {
      resolveTemplate: failing,
    });
    expect(failing).toHaveBeenCalledTimes(1);
    expect(cachedFailure.expansion.diagnostics.map((entry) => entry.code)).toEqual([
      "TEMPLATE_RESOLVE_FAILED",
      "TEMPLATE_RESOLVE_FAILED",
    ]);
  });
});

describe("template table normalization", () => {
  it("copies only own enumerable entries", () => {
    const table = Object.create({ "Template:Inherited": "inherited" }) as Record<string, string>;
    table["Template:Own"] = "own";
    Object.defineProperty(table, "Template:Hidden", { value: "hidden", enumerable: false });
    const snapshot = snapshotOf(table);
    expect(snapshot.get("Template:Own", request)).toMatchObject({ source: "own" });
    expect(snapshot.get("Template:Inherited", request)).toBeNull();
    expect(snapshot.get("Template:Hidden", request)).toBeNull();
  });

  it("keeps prototype-ish keys as plain data", () => {
    const table = { ["__proto__"]: "proto", toString: "stringified" } as Record<string, string>;
    const snapshot = snapshotOf(table);
    expect(snapshot.get("__proto__", request)).toMatchObject({ source: "proto" });
    expect(snapshot.get("toString", request)).toMatchObject({ source: "stringified" });
    expect(snapshot.get("constructor", request)).toBeNull();
  });

  it("accepts objects without a prototype", () => {
    const table = Object.assign(Object.create(null) as Record<string, string>, {
      "Template:Box": "bare",
    });
    expect(snapshotOf(table).get("Template:Box", request)).toMatchObject({ source: "bare" });
  });

  it("iterates maps through entries", () => {
    const table = new Map<string, string>([
      ["Template:A", "a"],
      ["Template:B", ""],
    ]);
    const snapshot = snapshotOf(table);
    expect(snapshot.get("Template:A", request)).toMatchObject({ source: "a" });
    expect(snapshot.get("Template:B", request)).toMatchObject({ source: "" });
    expect(snapshot.get("Template:C", request)).toBeNull();
  });

  it("accepts records and maps from another realm", () => {
    const record = runInNewContext('({ "Template:Box": "record" })') as Record<string, string>;
    const map = runInNewContext('new Map([["Template:Box", "map"]])') as Map<string, string>;
    expect(snapshotOf(record).get("Template:Box", request)).toMatchObject({ source: "record" });
    expect(snapshotOf(map).get("Template:Box", request)).toMatchObject({ source: "map" });
  });

  it("rejects exotic containers and iterables without pairs", () => {
    const exotic: readonly unknown[] = [
      new Set([["Template:A", "a"]]),
      new WeakMap(),
      new String("Template:A"),
      {
        get: () => undefined,
        has: () => false,
        [Symbol.iterator]: () => ["Template:A"][Symbol.iterator](),
      },
    ];
    expect(exotic).toHaveLength(4);
    for (const table of exotic) {
      expectInvalid("Expected INVALID_PROVIDER.", "INVALID_PROVIDER", () =>
        snapshotOf(asTable(table)),
      );
    }
  });
});

describe("option validation", () => {
  it("rejects invalid tables and resolvers before parsing", async () => {
    const parse = vi.fn();
    const parser = { name: "trace", version: "1.0.0", parse } as unknown as WikitextParser;
    const invalid: readonly (WikitextExpandOptions | null)[] = [
      null,
      [] as unknown as WikitextExpandOptions,
      { parser, templates: asTable("templates") },
      { parser, templates: asTable(null) },
      { parser, templates: asTable([]) },
      { parser, templates: asTable({ "Template:A": 1 }) },
      { parser, templates: asTable(new Map([[1, "x"]])) },
      { parser, templates: asTable(new Map([["Template:A", 1]])) },
      { parser, resolveTemplate: 1 as never },
    ];
    for (const options of invalid) {
      // 选项本身非法与模板表非法分别使用 INVALID_EXPAND_OPTIONS / INVALID_PROVIDER。
      await expect(
        expandWikitext("x", options as unknown as WikitextExpandOptions),
      ).rejects.toMatchObject({
        name: "WikitextExpandError",
        code: expect.stringMatching(/^INVALID_(?:EXPAND_OPTIONS|PROVIDER)$/u),
      });
    }
    expect(parse).not.toHaveBeenCalled();
  });

  it("accepts omitted options and omitted sources", async () => {
    await expect(expandWikitext("text")).resolves.toMatchObject({
      expansion: { status: "complete" },
    });
    const undefinedOptions = await expandWikitext("text", undefined);
    expect(undefinedOptions.snapshot.source).toBe("text");
    const noSources = await expandWikitext("{{Box}}", {
      templates: undefined,
      resolveTemplate: undefined,
    });
    expect(noSources.snapshot.source).toBe("{{Box}}");
    expect(noSources.expansion.status).toBe("partial");
  });

  it("expands pure functions without any template source", async () => {
    const result = await expandWikitext("{{#if:1|ok|no}}");
    expect(result.snapshot.source).toBe("ok");
    expect(result.expansion.status).toBe("complete");
  });

  it("treats unsourced templates as missing, or throws in strict mode", async () => {
    const result = await expandWikitext("{{Box}}");
    expect(result.expansion.records[0]).toMatchObject({
      name: "Template:Box",
      status: "preserved",
    });
    expect(result.expansion.diagnostics[0]?.code).toBe("TEMPLATE_NOT_FOUND");

    await expect(expandWikitext("{{Box}}", { strict: true })).rejects.toMatchObject({
      code: "TEMPLATE_NOT_FOUND",
      templateTitle: "Template:Box",
    });
  });
});
