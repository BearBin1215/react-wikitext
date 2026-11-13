import { StrictMode, createElement } from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WikitextRenderSnapshot } from "@/ast";
import { hashText } from "@/ast";
import { createTemplateTableProvider, createWikitextCompiler } from "@/expand";
import { prepareWikitext } from "@/hast";
import { createWikiparser } from "@/parse";
import { useWikitextPreview, type WikitextPreviewExecutor } from "@/preview";
import { createWikitextWorkerHandler } from "@/worker";

const parser = createWikiparser();

function createExecutor(): WikitextPreviewExecutor {
  const compiler = createWikitextCompiler({
    parser,
    provider: createTemplateTableProvider({
      key: "preview",
      revision: "v1",
      templates: { "Template:Echo": "{{{1}}}" },
    }),
  });
  return async (request) => {
    const compilation = await compiler.compile(
      {
        key: request.input.key,
        revision: request.input.revision,
        text: request.input.text,
      },
      {
        ...(request.options?.pageName === undefined ? {} : { pageName: request.options.pageName }),
        ...(request.options?.budget === undefined ? {} : { budget: request.options.budget }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
    );
    return prepareWikitext(compilation.snapshot);
  };
}

interface ProbeProps {
  readonly input: { key: string; revision: string; text: string };
  readonly executor: WikitextPreviewExecutor;
  readonly debounceMs?: number;
  readonly initialSnapshot?: WikitextRenderSnapshot;
  readonly onResult: (result: ReturnType<typeof useWikitextPreview>) => void;
}

function Probe({ input, executor, debounceMs, initialSnapshot, onResult }: ProbeProps) {
  const result = useWikitextPreview({
    input,
    executor,
    ...(debounceMs === undefined ? {} : { debounceMs }),
    ...(initialSnapshot === undefined ? {} : { initialSnapshot }),
  });
  onResult(result);
  return createElement("span", { "data-status": result.status });
}

function input(revision: string, text = "{{Echo|x}}") {
  return { key: "page", revision, text };
}

describe("useWikitextPreview", () => {
  it("runs the first input immediately and exposes a ready snapshot", async () => {
    const executor = vi.fn(createExecutor());
    let latest: ReturnType<typeof useWikitextPreview> | undefined;
    const { container } = render(
      createElement(Probe, {
        input: input("1"),
        executor,
        debounceMs: 5_000,
        onResult: (result: ReturnType<typeof useWikitextPreview>) => {
          latest = result;
        },
      }),
    );
    await waitFor(() => expect(latest?.status).toBe("ready"), { timeout: 2_000 });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(latest?.snapshot?.source).toBe("x");
    expect(latest?.displayedRevision).toBe("1");
    expect(container.querySelector("span")?.getAttribute("data-status")).toBe("ready");
  });

  it("keeps the initial snapshot until the first result arrives", async () => {
    const executor = createExecutor();
    const initial = prepareWikitext(parser.parse("stale", { retainSyntax: false }));
    let latest: ReturnType<typeof useWikitextPreview> | undefined;
    render(
      createElement(Probe, {
        input: input(hashText("stale"), "stale"),
        executor,
        debounceMs: 50,
        initialSnapshot: initial,
        onResult: (result: ReturnType<typeof useWikitextPreview>) => {
          latest = result;
        },
      }),
    );
    expect(latest?.snapshot?.source).toBe("stale");
    await waitFor(() => expect(latest?.displayedRevision).toBe(hashText("stale")), {
      timeout: 2_000,
    });
  });

  it("isolates results when the page key changes", async () => {
    const calls: string[] = [];
    const executor: WikitextPreviewExecutor = async (request) => {
      calls.push(request.input.key);
      await new Promise((resolve) => setTimeout(resolve, request.input.key === "slow" ? 60 : 5));
      return prepareWikitext(parser.parse(`${request.input.key}:${request.input.text}`));
    };
    let latest: ReturnType<typeof useWikitextPreview> | undefined;
    const onResult = (result: ReturnType<typeof useWikitextPreview>) => {
      latest = result;
    };
    const { rerender } = render(
      createElement(Probe, {
        input: { key: "slow", revision: "1", text: "a" },
        executor,
        onResult,
      }),
    );
    // 让第一次请求真正开始，再切换页面。
    await new Promise((resolve) => setTimeout(resolve, 10));
    rerender(
      createElement(Probe, {
        input: { key: "fast", revision: "1", text: "b" },
        executor,
        onResult,
      }),
    );
    await waitFor(() => expect(latest?.snapshot?.source).toBe("fast:b"), { timeout: 2_000 });
    // 旧页面的结果不会覆盖当前页面。
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(latest?.snapshot?.source).toBe("fast:b");
    expect(calls).toContain("slow");
  });

  it("ignores out-of-order results", async () => {
    let resolveFirst: ((snapshot: WikitextRenderSnapshot) => void) | undefined;
    const snapshots = ["first", "second"].map((text) => prepareWikitext(parser.parse(text)));
    const executor: WikitextPreviewExecutor = (request) =>
      new Promise((resolve) => {
        if (request.input.revision === "1") {
          resolveFirst = resolve;
        } else {
          resolve(snapshots[1]!);
        }
      });
    let latest: ReturnType<typeof useWikitextPreview> | undefined;
    const onResult = (result: ReturnType<typeof useWikitextPreview>) => {
      latest = result;
    };
    const { rerender } = render(
      createElement(Probe, { input: input("1"), executor, debounceMs: 0, onResult }),
    );
    rerender(createElement(Probe, { input: input("2"), executor, debounceMs: 0, onResult }));
    await waitFor(() => expect(latest?.snapshot?.source).toBe("second"), { timeout: 2_000 });
    resolveFirst?.(snapshots[0]!);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(latest?.snapshot?.source).toBe("second");
    expect(latest?.displayedRevision).toBe("2");
  });

  it("aborts pending work on unmount", async () => {
    let seenSignal: AbortSignal | undefined;
    const executor: WikitextPreviewExecutor = (request) => {
      seenSignal = request.signal;
      return new Promise(() => {});
    };
    const { unmount } = render(
      createElement(Probe, { input: input("1"), executor, debounceMs: 0, onResult: () => {} }),
    );
    await waitFor(() => expect(seenSignal).toBeDefined(), { timeout: 2_000 });
    unmount();
    expect(seenSignal?.aborted).toBe(true);
  });

  it("stays stable under Strict Mode replays", async () => {
    const executor = vi.fn(createExecutor());
    let latest: ReturnType<typeof useWikitextPreview> | undefined;
    render(
      createElement(
        StrictMode,
        null,
        createElement(Probe, {
          input: input("1"),
          executor,
          debounceMs: 0,
          onResult: (result: ReturnType<typeof useWikitextPreview>) => {
            latest = result;
          },
        }),
      ),
    );
    await waitFor(() => expect(latest?.snapshot?.source).toBe("x"), { timeout: 2_000 });
    expect(latest?.status).toBe("ready");
  });
});

describe("worker handler", () => {
  it("compiles, prepares and returns serialized snapshots", async () => {
    const compiler = createWikitextCompiler({
      parser,
      provider: createTemplateTableProvider({
        key: "worker",
        revision: "v1",
        templates: { "Template:Echo": "{{{1}}}" },
      }),
    });
    const handler = createWikitextWorkerHandler({ compiler });
    const response = await handler({
      type: "compile",
      id: "1",
      input: { key: "page", revision: "1", text: "{{Echo|z}}" },
    });
    expect(response.type).toBe("result");
    if (response.type === "result") {
      expect(response.id).toBe("1");
      expect(response.snapshot.source).toBe("z");
      expect(response.snapshot.kind).toBe("render");
      expect(response.snapshot.graph.sources.length).toBeGreaterThan(0);
    }
    await handler({ type: "dispose" });
    await compiler.dispose();
  });

  it("reports errors as plain data and rejects work after dispose", async () => {
    const compiler = createWikitextCompiler({
      parser,
      provider: createTemplateTableProvider({ key: "worker", revision: "v1", templates: {} }),
    });
    const handler = createWikitextWorkerHandler({ compiler });
    const failed = await handler({
      type: "compile",
      id: "2",
      input: { key: "page", revision: "1", text: "x".repeat(100_001) },
    });
    expect(failed.type).toBe("error");
    if (failed.type === "error") {
      expect(failed.error.name).toBe("WikitextParseError");
      expect(failed.error.code).toBe("SOURCE_TOO_LONG");
    }
    await handler({ type: "dispose" });
    const after = await handler({
      type: "compile",
      id: "3",
      input: { key: "page", revision: "1", text: "x" },
    });
    expect(after).toMatchObject({ type: "error", error: { code: "DISPOSED" } });
    await compiler.dispose();
  });
});
