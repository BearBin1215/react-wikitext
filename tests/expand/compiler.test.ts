import { describe, expect, it, vi } from "vitest";
import { hashText } from "@/ast";
import {
  createTemplateTableProvider,
  createWikitextCompiler,
  type WikitextTemplateProvider,
  type WikitextTemplateRequest,
  type WikitextTemplateSnapshot,
  type WikitextTemplateSource,
} from "@/expand";
import { createWikiparser } from "@/parse";

const parser = createWikiparser();

interface CountingProvider extends WikitextTemplateProvider {
  readonly getCalls: string[];
  readonly batchCalls: string[][];
}

/** 记录请求的 provider；`getMany` 与 `get` 二选一模拟远程源。 */
function countingProvider(
  templates: Record<string, string>,
  options: { readonly many?: boolean; readonly delayMs?: number } = {},
): CountingProvider {
  const getCalls: string[] = [];
  const batchCalls: string[][] = [];
  const lookup = (title: string): WikitextTemplateSource | null =>
    templates[title] === undefined ? null : { title, source: templates[title]! };
  const snapshot: WikitextTemplateSnapshot = {
    key: "test",
    revision: "v1",
    async get(title) {
      getCalls.push(title);
      if (options.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      return lookup(title);
    },
    ...(options.many
      ? {
          async getMany(titles: readonly string[]) {
            batchCalls.push([...titles]);
            return new Map(titles.map((title) => [title, lookup(title)]));
          },
        }
      : {}),
  };
  return {
    key: "test",
    getCalls,
    batchCalls,
    open() {
      return snapshot;
    },
  };
}

function compileInput(text: string, revision = hashText(text)) {
  return { key: "page", revision, text };
}

describe("compiler caching", () => {
  it("reuses template programs across compiles of the same version", async () => {
    const compiler = createWikitextCompiler({
      parser,
      provider: countingProvider({ "Template:T": "{{{1}}}" }),
    });
    const input = compileInput("{{T|a}}");
    const first = await compiler.compile(input);
    const second = await compiler.compile(input);
    expect(first.snapshot.source).toBe("a");
    expect(second.snapshot.source).toBe("a");
    expect(compiler.getStats().programCompilations).toBe(1);
    await compiler.dispose();
  });

  it("keeps instance caches isolated", async () => {
    const provider = countingProvider({ "Template:T": "a" });
    const one = createWikitextCompiler({ parser, provider });
    const two = createWikitextCompiler({ parser, provider });
    await one.compile(compileInput("{{T}}"));
    await two.compile(compileInput("{{T}}"));
    // 两个实例各自编译一次；不共享模板语法程序。
    expect(one.getStats().programCompilations).toBe(1);
    expect(two.getStats().programCompilations).toBe(1);
    await one.dispose();
    await two.dispose();
  });

  it("rejects compiles after dispose", async () => {
    const compiler = createWikitextCompiler({ parser, provider: countingProvider({}) });
    await compiler.dispose();
    await expect(compiler.compile(compileInput("x"))).rejects.toMatchObject({ code: "DISPOSED" });
  });
});

describe("compiler scheduling", () => {
  it("batches statically known independent titles", async () => {
    const provider = countingProvider({ "Template:A": "a", "Template:B": "b" }, { many: true });
    const compiler = createWikitextCompiler({ parser, provider, fetch: { batchSize: 10 } });
    const result = await compiler.compile(compileInput("{{A}}{{B}}"));
    expect(result.snapshot.source).toBe("ab");
    expect(provider.batchCalls).toEqual([["Template:A", "Template:B"]]);
    expect(result.stats.batches).toBe(1);
    await compiler.dispose();
  });

  it("does not fetch templates from untaken branches", async () => {
    const provider = countingProvider({ "Template:A": "a", "Template:B": "b" });
    const compiler = createWikitextCompiler({ parser, provider });
    const result = await compiler.compile(compileInput("{{#if:1|{{A}}|{{B}}}}"));
    expect(result.snapshot.source).toBe("a");
    expect(provider.getCalls).toEqual(["Template:A"]);
    await compiler.dispose();
  });

  it("shares an unfinished fetch between concurrent compiles", async () => {
    const provider = countingProvider({ "Template:T": "ok" }, { delayMs: 20 });
    const compiler = createWikitextCompiler({ parser, provider });
    const input = compileInput("{{T}}");
    const [first, second] = await Promise.all([
      compiler.compile(input),
      compiler.compile({ ...input, text: "{{T}}" }),
    ]);
    expect(first.snapshot.source).toBe("ok");
    expect(second.snapshot.source).toBe("ok");
    expect(provider.getCalls).toHaveLength(1);
    await compiler.dispose();
  });

  it("cancels one subscriber without aborting the shared task", async () => {
    const provider = countingProvider({ "Template:T": "ok" }, { delayMs: 30 });
    const compiler = createWikitextCompiler({ parser, provider });
    const controller = new AbortController();
    const cancelled = compiler.compile(compileInput("{{T}}"), { signal: controller.signal });
    const survivor = compiler.compile(compileInput("{{T}}"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();

    await expect(cancelled).rejects.toMatchObject({ code: "ABORTED" });
    await expect(survivor).resolves.toMatchObject({ status: "complete" });
    expect(provider.getCalls).toHaveLength(1);
    await compiler.dispose();
  });

  it("produces the same output for getMany and get at any concurrency", async () => {
    const templates = { "Template:A": "[{{B}}]", "Template:B": "b", "Template:C": "c" };
    const sources = ["{{A}}{{C}}", "{{C}}{{A}}"];
    const outputs: string[][] = [];
    for (const many of [false, true]) {
      for (const concurrency of [1, 4]) {
        const compiler = createWikitextCompiler({
          parser,
          provider: countingProvider(templates, { many }),
          fetch: { concurrency, batchSize: 1 },
        });
        const results: string[] = [];
        for (const source of sources) {
          results.push((await compiler.compile(compileInput(source))).snapshot.source);
        }
        outputs.push(results);
        await compiler.dispose();
      }
    }
    expect(outputs[0]).toEqual(["[b]c", "c[b]"]);
    for (const output of outputs) {
      expect(output).toEqual(outputs[0]);
    }
  });

  it("keeps working when cache entries are evicted immediately", async () => {
    const compiler = createWikitextCompiler({
      parser,
      provider: createTemplateTableProvider({
        key: "table",
        revision: "v1",
        templates: { "Template:T": "{{{1}}}" },
      }),
      cache: { maxEntries: 1, maxBytes: 64 },
    });
    for (const value of ["a", "b", "c"]) {
      const result = await compiler.compile(compileInput(`{{T|${value}}}`));
      expect(result.snapshot.source).toBe(value);
    }
    await compiler.dispose();
  });
});

describe("compiler source graph", () => {
  it("keeps nested invocation records with scopes and outputs", async () => {
    const compiler = createWikitextCompiler({
      parser,
      provider: countingProvider({ "Template:T": "[{{{1}}}]", "Template:U": "u" }),
    });
    const result = await compiler.compile(compileInput("{{T|{{U}}}}"));
    expect(result.snapshot.source).toBe("[u]");
    const invocations = result.snapshot.graph.invocations;
    const outer = invocations.find((invocation) => invocation.name === "Template:T");
    const inner = invocations.find((invocation) => invocation.name === "Template:U");
    expect(outer?.status).toBe("expanded");
    expect(outer?.outputs).toHaveLength(1);
    const reference = invocations.find((invocation) => invocation.kind === "argument");
    // 因果链：页面 -> 模板 T -> 参数引用 -> 参数里的模板 U。
    expect(inner?.parentId).toBe(reference?.id);
    expect(reference?.parentId).toBe(outer?.id);
    // 参数值在调用方作用域求值，因此它捕获的是页面根作用域。
    expect(inner?.scopeId).toBe("scope:root");
    // 页面调用位置与模板体失败位置分别记录，不再压成一个顶层范围。
    const calls = result.snapshot.graph.invocations.map((invocation) => invocation.kind);
    expect(calls).toContain("argument");
    await compiler.dispose();
  });

  it("records fallback without rewriting attempted output spans", async () => {
    const compiler = createWikitextCompiler({
      parser: {
        ...parser,
        compile(source, options) {
          if (source === "ab") {
            throw new Error("rejected final source");
          }
          return parser.compile(source, options);
        },
      },
      provider: countingProvider({ "Template:A": "a", "Template:B": "b" }),
    });
    const result = await compiler.compile(compileInput("{{A}}{{B}}"));
    expect(result.status).toBe("fallback");
    expect(result.snapshot.source).toBe("{{A}}{{B}}");
    expect(result.attemptedSourceId).toMatch(/^expanded:/u);
    const fallback = result.snapshot.diagnostics.at(-1);
    expect(fallback).toMatchObject({ code: "FINAL_PARSE_FALLBACK" });
    expect(fallback?.location?.sourceId).toBe(result.attemptedSourceId);
    await compiler.dispose();
  });

  it("fails the whole compile when the expanded text exceeds the hard limit", async () => {
    const compiler = createWikitextCompiler({
      parser,
      provider: countingProvider({ "Template:Long": "0123456789" }),
    });
    await expect(
      compiler.compile(compileInput("{{Long}}"), { budget: { maxExpandedLength: 5 } }),
    ).rejects.toMatchObject({ code: "EXPANSION_TOO_LARGE" });
    await compiler.dispose();
  });
});

describe("provider contract", () => {
  it("releases the opened session even when compilation fails", async () => {
    const release = vi.fn();
    const compiler = createWikitextCompiler({
      parser,
      provider: {
        key: "test",
        open() {
          return {
            key: "test",
            revision: "v1",
            get: () => {
              throw new Error("boom");
            },
            release,
          };
        },
      },
    });
    const result = await compiler.compile(compileInput("{{T}}"));
    expect(result.status).toBe("partial");
    expect(release).toHaveBeenCalledTimes(1);
    await compiler.dispose();
  });

  it("rejects a provider that returns a malformed snapshot", async () => {
    const compiler = createWikitextCompiler({
      parser,
      provider: {
        key: "test",
        open: () => ({ key: "test" }) as unknown as WikitextTemplateSnapshot,
      },
    });
    await expect(compiler.compile(compileInput("x"))).rejects.toMatchObject({
      code: "INVALID_PROVIDER",
    });
    await compiler.dispose();
  });
});

describe("request context", () => {
  it("passes page context and the real call location", async () => {
    const requests: WikitextTemplateRequest[] = [];
    const compiler = createWikitextCompiler({
      parser,
      provider: {
        key: "test",
        open() {
          return {
            key: "test",
            revision: "v1",
            get(_title, request) {
              requests.push(request);
              return { title: request.title, source: "x" };
            },
          };
        },
      },
    });
    await compiler.compile(compileInput("{{T}}"), { pageName: "Demo" });
    expect(requests[0]).toMatchObject({
      title: "Template:T",
      pageName: "Demo",
      location: { start: 0, end: 5 },
    });
    expect(requests[0]?.callerTitle).toBeUndefined();
    await compiler.dispose();
  });
});
