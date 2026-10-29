import { describe, expect, it } from "vitest";
import {
  expandWikitext,
  WikitextExpandError,
  type WikitextExpandOptions,
  type WikitextTemplateResolver,
} from "@/expand";
import { WikitextParseError } from "@/ast/errors";
import { createWikiparser, type WikitextParser } from "@/parse";
import { parserThrowingOn } from "../helpers/expand";

async function expectExpandError(
  source: string,
  templates: Record<string, string>,
  options: Partial<WikitextExpandOptions> = {},
): Promise<WikitextExpandError> {
  try {
    await expandWikitext(source, { templates, ...options });
  } catch (error) {
    expect(error).toBeInstanceOf(WikitextExpandError);
    return error as WikitextExpandError;
  }
  throw new Error("Expected expansion to fail.");
}

describe("source and resolver failures", () => {
  it("propagates original parse failures as WikitextParseError", async () => {
    await expect(
      expandWikitext("{{T}}", { parseOptions: { maxSourceLength: 2 } }),
    ).rejects.toBeInstanceOf(WikitextParseError);
    await expect(expandWikitext(42 as unknown as string)).rejects.toBeInstanceOf(
      WikitextParseError,
    );
  });

  it("preserves missing templates and records a diagnostic", async () => {
    const result = await expandWikitext("a{{Missing}}b");
    expect(result.document.source).toBe("a{{Missing}}b");
    expect(result.expansion.status).toBe("partial");
    expect(result.expansion.records[0]).toMatchObject({
      kind: "template",
      name: "Template:Missing",
      status: "preserved",
    });
    expect(result.expansion.diagnostics[0]).toMatchObject({
      code: "TEMPLATE_NOT_FOUND",
      templateTitle: "Template:Missing",
    });
    expect(result.document.diagnostics[0]?.code).toBe("TEMPLATE_NOT_FOUND");
  });

  it("treats an empty string as a valid template", async () => {
    const result = await expandWikitext("a{{Empty}}b", {
      templates: { "Template:Empty": "" },
    });
    expect(result.document.source).toBe("ab");
    expect(result.expansion.status).toBe("complete");
    expect(result.expansion.records[0]).toMatchObject({
      status: "expanded",
      expandedRange: [1, 1],
    });
  });

  it("handles resolver exceptions and non-string results", async () => {
    const failure = new Error("network down");
    const thrown = await expandWikitext("{{T}}", {
      resolveTemplate: () => {
        throw failure;
      },
    });
    expect(thrown.document.source).toBe("{{T}}");
    expect(thrown.expansion.status).toBe("partial");
    expect(thrown.expansion.records[0]?.status).toBe("preserved");
    expect(thrown.expansion.diagnostics[0]).toMatchObject({
      code: "TEMPLATE_RESOLVE_FAILED",
      templateTitle: "Template:T",
    });
    const rejected = await expandWikitext("{{T}}", {
      resolveTemplate: async () => {
        throw failure;
      },
    });
    expect(rejected.document.source).toBe("{{T}}");
    expect(rejected.expansion.diagnostics[0]?.code).toBe("TEMPLATE_RESOLVE_FAILED");
    const invalid = await expandWikitext("{{T}}", {
      resolveTemplate: (() => 1) as unknown as WikitextTemplateResolver,
    });
    expect(invalid.document.source).toBe("{{T}}");
    expect(invalid.expansion.records[0]?.status).toBe("preserved");
    expect(invalid.expansion.diagnostics[0]?.code).toBe("TEMPLATE_RESOLVE_FAILED");
    const strict = await expectExpandError(
      "{{T}}",
      {},
      {
        strict: true,
        resolveTemplate: () => {
          throw failure;
        },
      },
    );
    expect(strict.code).toBe("TEMPLATE_RESOLVE_FAILED");
    expect(strict.cause).toBe(failure);
  });

  it("reports template source length and parse failures", async () => {
    const tooLong = await expandWikitext("{{T}}", {
      templates: { "Template:T": "01234567890" },
      parseOptions: { maxSourceLength: 10 },
    });
    expect(tooLong.document.source).toBe("{{T}}");
    expect(tooLong.expansion.records[0]?.status).toBe("preserved");
    expect(tooLong.expansion.diagnostics[0]?.code).toBe("TEMPLATE_PARSE_FAILED");
    const parseFailure = await expandWikitext("{{T}}", {
      templates: { "Template:T": "BAD" },
      parser: parserThrowingOn("BAD"),
    });
    expect(parseFailure.document.source).toBe("{{T}}");
    expect(parseFailure.expansion.records[0]?.status).toBe("preserved");
    expect(parseFailure.expansion.diagnostics[0]?.code).toBe("TEMPLATE_PARSE_FAILED");
  });

  it("normalizes CRLF in template source", async () => {
    const result = await expandWikitext("{{T}}", {
      templates: { "Template:T": "a\r\nb" },
    });
    expect(result.document.source).toBe("a\nb");
  });
});

describe("unsupported calls and loops", () => {
  it("preserves unsupported parser functions, magic words and modifiers", async () => {
    const sources = ["{{#time:x}}", "{{PAGENAME}}", "{{ns:1}}"];
    const results = await Promise.all(sources.map((source) => expandWikitext(source)));
    for (const [index, source] of sources.entries()) {
      const result = results[index]!;
      expect(result.document.source).toBe(source);
      expect(result.expansion.records[0]).toMatchObject({
        kind: "parserFunction",
        status: "preserved",
      });
      expect(result.expansion.diagnostics[0]?.code).toBe("UNSUPPORTED_CALL");
    }
    const substitution = await expandWikitext("{{subst:Tpl}}");
    expect(substitution.document.source).toBe("{{subst:Tpl}}");
    expect(substitution.expansion.records[0]).toMatchObject({
      kind: "template",
      status: "preserved",
    });
    expect(substitution.expansion.diagnostics[0]?.code).toBe("UNSUPPORTED_CALL");
    const dynamic = await expandWikitext("{{subst:{{Missing}}}}", {
      resolveTemplate: () => {
        throw new Error("resolver must not run");
      },
    });
    expect(dynamic.document.source).toBe("{{subst:{{Missing}}}}");
    expect(dynamic.expansion.diagnostics.map((item) => item.code)).toEqual(["UNSUPPORTED_CALL"]);
  });

  it("detects direct and indirect loops while allowing repeated siblings", async () => {
    const templates = {
      "Template:Echo": "{{{1}}}",
      "Template:Self": "{{Self}}",
      "Template:A": "{{B}}",
      "Template:B": "{{A}}",
    };
    const direct = await expandWikitext("{{Self}}", { templates });
    expect(direct.expansion.diagnostics[0]?.code).toBe("TEMPLATE_LOOP");
    expect(direct.expansion.status).toBe("partial");
    const indirect = await expandWikitext("{{A}}", { templates });
    expect(indirect.expansion.diagnostics[0]?.code).toBe("TEMPLATE_LOOP");
    const siblings = await expandWikitext("{{Echo|a}}{{Echo|b}}", { templates });
    expect(siblings.document.source).toBe("ab");
    expect(siblings.expansion.status).toBe("complete");
  });

  it("throws in strict mode for unsupported calls and loops", async () => {
    expect((await expectExpandError("{{#time:x}}", {}, { strict: true })).code).toBe(
      "UNSUPPORTED_CALL",
    );
    expect(
      (await expectExpandError("{{Self}}", { "Template:Self": "{{Self}}" }, { strict: true })).code,
    ).toBe("TEMPLATE_LOOP");
  });
});

describe("budgets", () => {
  const chain = {
    "Template:Chain1": "{{Chain2}}",
    "Template:Chain2": "{{Chain3}}",
    "Template:Chain3": "end",
  };

  it("limits evaluation depth", async () => {
    const result = await expandWikitext("{{Chain1}}", { templates: chain, maxDepth: 2 });
    expect(result.document.source).toBe("{{Chain3}}");
    expect(result.expansion.status).toBe("partial");
    expect(result.expansion.diagnostics[0]?.code).toBe("DEPTH_BUDGET_EXCEEDED");
    const strict = await expectExpandError("{{Chain1}}", chain, { strict: true, maxDepth: 2 });
    expect(strict.code).toBe("EXPANSION_BUDGET_EXCEEDED");
  });

  it("limits total invocations", async () => {
    const result = await expandWikitext("{{Echo|a}}{{Echo|b}}", {
      templates: { "Template:Echo": "{{{1}}}" },
      maxInvocations: 1,
    });
    expect(result.document.source).toBe("{{{1}}}{{Echo|b}}");
    expect(result.expansion.records.map((record) => record.status)).toEqual([
      "expanded",
      "preserved",
    ]);
    expect(result.expansion.diagnostics[0]?.code).toBe("INVOCATION_BUDGET_EXCEEDED");
    const two = await expandWikitext("{{Echo|a}}{{Echo|b}}", {
      templates: { "Template:Echo": "{{{1}}}" },
      maxInvocations: 2,
    });
    expect(two.document.source).toBe("a{{Echo|b}}");
    expect(two.expansion.records.map((record) => record.status)).toEqual(["expanded", "preserved"]);
  });

  it("limits the expanded length without exceeding the final source", async () => {
    const result = await expandWikitext("{{Long}}", {
      templates: { "Template:Long": "0123456789" },
      maxExpandedLength: 8,
    });
    expect(result.document.source).toBe("{{Long}}");
    expect(result.expansion.records[0]?.status).toBe("preserved");
    expect(result.expansion.diagnostics[0]?.code).toBe("LENGTH_BUDGET_EXCEEDED");
    const thrown = await expectExpandError(
      "{{Long}}",
      { "Template:Long": "0123456789" },
      { maxExpandedLength: 5 },
    );
    expect(thrown.code).toBe("EXPANSION_TOO_LARGE");
  });

  it("validates budget options before parsing", async () => {
    const invalidOptions = [
      { maxDepth: 0 },
      { maxInvocations: -1 },
      { maxExpandedLength: 1.5 },
      { parseOptions: { maxSourceLength: -1 } },
    ];
    await Promise.all(
      invalidOptions.map((options) =>
        expect(expandWikitext("x", options)).rejects.toMatchObject({
          code: "INVALID_EXPAND_OPTIONS",
        }),
      ),
    );
  });
});

describe("final parse fallback", () => {
  const templates = { "Template:A": "x", "Template:B": "y" };

  it("returns the original snapshot when the expanded source cannot be parsed", async () => {
    const result = await expandWikitext("{{A}}{{B}}", {
      templates,
      parser: parserThrowingOn("xy"),
    });
    expect(result.expansion.status).toBe("fallback");
    expect(result.document.source).toBe("{{A}}{{B}}");
    expect(result.document.ast).toBe(result.original.ast);
    expect(result.expansion.records.map((record) => record.status)).toEqual([
      "preserved",
      "preserved",
    ]);
    expect(result.expansion.records[0]?.expandedRange).toEqual([0, 5]);
    expect(result.expansion.records[1]?.expandedRange).toEqual([5, 10]);
    const fallback = result.expansion.diagnostics.at(-1);
    expect(fallback).toMatchObject({ code: "FINAL_PARSE_FALLBACK", stage: "expand" });
    expect(fallback?.position).toBeUndefined();
    expect(result.document.diagnostics.at(-1)?.code).toBe("FINAL_PARSE_FALLBACK");
  });

  it("throws when the fallback snapshot exceeds the expanded length limit", async () => {
    const thrown = await expectExpandError("{{A}}{{B}}", templates, {
      maxExpandedLength: 2,
      parser: parserThrowingOn("xy"),
    });
    expect(thrown.code).toBe("EXPANSION_TOO_LARGE");
  });

  it("throws in strict mode when final parsing fails", async () => {
    const thrown = await expectExpandError("{{A}}{{B}}", templates, {
      strict: true,
      parser: parserThrowingOn("xy"),
    });
    expect(thrown.code).toBe("FINAL_PARSE_FAILED");
  });

  it("rejects incompatible parsers that omit the syntax tree", async () => {
    const base = createWikiparser();
    const incompatible: WikitextParser = {
      name: "no-syntax",
      version: "1.0.0",
      resolveOptions: (options) => base.resolveOptions(options),
      parse(source, options) {
        const document = base.parse(source, options);
        return {
          source: document.source,
          ast: document.ast,
          meta: document.meta,
          diagnostics: document.diagnostics,
        };
      },
    };
    await expect(expandWikitext("x", { parser: incompatible })).rejects.toMatchObject({
      code: "INCOMPATIBLE_PARSER",
    });
  });
});

describe("cancellation", () => {
  it("rejects before parsing when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(expandWikitext("x", { signal: controller.signal })).rejects.toMatchObject({
      code: "ABORTED",
    });
  });

  it("rejects while waiting for the resolver and passes the signal through", async () => {
    const controller = new AbortController();
    let settle: ((value: string | null) => void) | undefined;
    let started: (() => void) | undefined;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    let seenSignal: AbortSignal | undefined;
    const promise = expandWikitext("{{T}}", {
      signal: controller.signal,
      resolveTemplate: (request) => {
        seenSignal = request.signal;
        started?.();
        return new Promise<string | null>((resolve) => {
          settle = resolve;
        });
      },
    });
    await startedPromise;
    expect(seenSignal).toBe(controller.signal);
    const reason = new Error("stop");
    controller.abort(reason);
    const error = await promise.catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: "ABORTED", cause: reason });
    settle?.("late");
    await Promise.resolve();
  });
});

describe("coordinates and snapshots", () => {
  it("normalizes CRLF and keeps UTF-16 ranges", async () => {
    const result = await expandWikitext("{{Echo|😀}}\r\n{{Echo|中}}", {
      templates: { "Template:Echo": "{{{1}}}" },
    });
    expect(result.document.source).toBe("😀\n中");
    expect(result.expansion.records.map((record) => record.originalRange)).toEqual([
      [0, 11],
      [12, 22],
    ]);
    expect(result.expansion.records.map((record) => record.expandedRange)).toEqual([
      [0, 2],
      [3, 4],
    ]);
  });

  it("keeps syntax trees internal unless retainSyntax is requested", async () => {
    const plain = await expandWikitext("x");
    expect(plain.original.syntax).toBeUndefined();
    expect(plain.document.syntax).toBeUndefined();
    expect(plain.original.meta.retainSyntax).toBe(false);
    expect(plain.document.meta.retainSyntax).toBe(false);
    const retained = await expandWikitext("x", {
      parseOptions: { retainSyntax: true },
    });
    expect(retained.original.syntax).toBeDefined();
    expect(retained.document.syntax).toBeDefined();
    expect(retained.original.meta.retainSyntax).toBe(true);
    expect(retained.document.meta.retainSyntax).toBe(true);
  });

  it("does not mutate the original snapshot", async () => {
    const result = await expandWikitext("{{Echo|a}}", {
      templates: { "Template:Echo": "{{{1}}}" },
    });
    expect(result.original.source).toBe("{{Echo|a}}");
    expect(result.original.ast.type).toBe("root");
    expect(result.original.diagnostics).toEqual([]);
    expect(result.document).not.toBe(result.original);
  });

  it("passes pageName, callerTitle and invocation to the resolver", async () => {
    const requests: Array<Record<string, unknown>> = [];
    await expandWikitext("{{Outer}}", {
      pageName: "Demo",
      resolveTemplate: (request) => {
        requests.push(request as unknown as Record<string, unknown>);
        return request.title === "Template:Outer" ? "{{Inner}}" : "ok";
      },
    });
    expect(requests[0]).toMatchObject({
      title: "Template:Outer",
      pageName: "Demo",
      invocation: [0, 9],
    });
    expect(requests[0]?.callerTitle).toBeUndefined();
    expect(requests[1]).toMatchObject({
      title: "Template:Inner",
      pageName: "Demo",
      callerTitle: "Template:Outer",
      invocation: [0, 9],
    });
  });
});
