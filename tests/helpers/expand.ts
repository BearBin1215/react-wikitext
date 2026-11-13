import { WikitextExpandError, WikitextParseError } from "@/ast/errors";
import type { WikitextInvocationStatus } from "@/ast";
import type {
  WikitextCompilationStatus,
  WikitextDiagnostic,
  WikitextParsedSnapshot,
  WikitextRange,
} from "@/ast/model";
import { hashText } from "@/ast/sourceGraph/graph";
import {
  createTemplateTableProvider,
  createWikitextCompiler,
  type WikitextTemplateProvider,
  type WikitextTemplateRequest,
  type WikitextTemplateSnapshot,
  type WikitextTemplateTable,
} from "@/expand";
import type { WikitextStageSink } from "@/instrumentation";
import {
  createWikiparser,
  parseWikitext,
  type WikitextParseOptions,
  type WikitextParser,
} from "@/parse";

/** 测试用的顶层调用记录视图；由来源图中的调用记录派生。 */
export interface TestExpansionRecord {
  readonly kind: "template" | "parserFunction" | "argument";
  readonly name: string;
  readonly originalRange: WikitextRange;
  readonly expandedRange: WikitextRange;
  readonly status: WikitextInvocationStatus;
}

/** 测试用展开结果；保留原始与最终快照，以及派生的顶层记录。 */
export interface TestExpansion {
  readonly original: WikitextParsedSnapshot;
  readonly snapshot: WikitextParsedSnapshot;
  readonly expansion: {
    readonly status: WikitextCompilationStatus;
    readonly records: readonly TestExpansionRecord[];
    readonly diagnostics: readonly WikitextDiagnostic[];
  };
}

/** 旧的测试入口签名；实现已经改为编译器。 */
export interface WikitextExpandOptions {
  readonly parser?: WikitextParser;
  readonly pageName?: string;
  readonly parseOptions?: Omit<WikitextParseOptions, "pageName">;
  readonly templates?: WikitextTemplateTable | undefined;
  readonly resolveTemplate?: WikitextTemplateResolver | undefined;
  readonly maxDepth?: number;
  readonly maxInvocations?: number;
  readonly maxExpandedLength?: number;
  readonly strict?: boolean;
  readonly signal?: AbortSignal;
  readonly profile?: WikitextStageSink;
}

/** 旧测试回调签名；`invocation` 现在只是调用位置的偏移视图。 */
export type WikitextTemplateResolver = (
  request: WikitextTemplateRequest & { readonly invocation: WikitextRange },
) => string | null | undefined | Promise<string | null | undefined>;

function invalidOptions(message: string): never {
  throw new WikitextExpandError("INVALID_EXPAND_OPTIONS", message);
}

function providerFor(options: WikitextExpandOptions): WikitextTemplateProvider {
  const table = options.templates;
  const remote = options.resolveTemplate;
  if (remote !== undefined && typeof remote !== "function") {
    invalidOptions("resolveTemplate must be a function.");
  }
  const copy = new Map<string, string>();
  if (table) {
    const entries =
      typeof (table as ReadonlyMap<string, string>).get === "function"
        ? [...(table as ReadonlyMap<string, string>).entries()]
        : Object.entries(table as Record<string, string>);
    for (const [title, source] of entries) {
      copy.set(title, source);
    }
  }
  const base = createTemplateTableProvider({
    key: "test:offline",
    revision: "test-v1",
    templates: copy,
  });
  if (!remote) {
    return base;
  }
  return {
    key: "test:mixed",
    open(context) {
      const snapshot = base.open(context) as WikitextTemplateSnapshot;
      return {
        key: "test:mixed",
        revision: "test-v1",
        async get(title, request) {
          const local = copy.get(title);
          if (local !== undefined) {
            return { title, source: local };
          }
          const response = await remote({
            title,
            location: request.location,
            ...(request.pageName === undefined ? {} : { pageName: request.pageName }),
            ...(request.callerTitle === undefined ? {} : { callerTitle: request.callerTitle }),
            invocation: [request.location.start, request.location.end],
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          });
          return response === null || response === undefined ? null : { title, source: response };
        },
        ...(snapshot.release === undefined ? {} : { release: snapshot.release }),
      };
    },
  };
}

function recordsFrom(snapshot: WikitextParsedSnapshot): TestExpansionRecord[] {
  return snapshot.graph.invocations
    .filter((invocation) => invocation.parentId === undefined)
    .map((invocation) => ({
      kind: invocation.kind,
      name: invocation.name,
      originalRange: [invocation.start, invocation.end] as const,
      expandedRange: (invocation.outputs[0]
        ? [invocation.outputs[0].start, invocation.outputs[0].end]
        : [invocation.start, invocation.end]) as unknown as WikitextRange,
      status: invocation.status,
    }));
}

/**
 * 测试入口：用编译器执行展开，并派生旧的顶层记录视图。
 * 生产代码不再提供该包装；测试断言仍然检查真实输出与来源图。
 */
export async function expandWikitext(
  source: string,
  options: WikitextExpandOptions = {},
): Promise<TestExpansion> {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    invalidOptions("expandWikitext requires an options object.");
  }
  const parser = options.parser ?? createWikiparser();
  const compiler = createWikitextCompiler({
    parser,
    provider: providerFor(options),
    fetch: { concurrency: 1 },
    limits: { maxDiagnostics: 1_000 },
    ...(options.profile === undefined ? {} : { profile: options.profile }),
  });
  try {
    const compilation = await compiler.compile(
      { key: "test", revision: hashText(source), text: source },
      {
        ...(options.pageName === undefined ? {} : { pageName: options.pageName }),
        ...(options.parseOptions === undefined ? {} : { parseOptions: options.parseOptions }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        failureMode: options.strict === true ? "throw" : "preserve",
        budget: {
          ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
          ...(options.maxInvocations === undefined
            ? {}
            : { maxInvocations: options.maxInvocations }),
          ...(options.maxExpandedLength === undefined
            ? {}
            : { maxExpandedLength: options.maxExpandedLength }),
        },
      },
    );
    const original = parseWikitext(source, {
      ...(options.pageName === undefined ? {} : { pageName: options.pageName }),
      ...(options.parseOptions === undefined ? {} : options.parseOptions),
    });
    return {
      original,
      snapshot: compilation.snapshot,
      expansion: {
        status: compilation.status,
        records: recordsFrom(compilation.snapshot),
        diagnostics: compilation.snapshot.diagnostics.filter(
          (diagnostic) => diagnostic.stage === "expand",
        ),
      },
    };
  } finally {
    await compiler.dispose();
  }
}

/** 包装默认 parser：原始源码、模板源码或最终源码与 `marker` 相同时抛解析错误。 */
export function parserThrowingOn(marker: string): WikitextParser {
  const base = createWikiparser();
  return {
    name: "marker-parser",
    version: "1.0.0",
    key: "marker-parser@1.0.0",
    resolveOptions: (options) => base.resolveOptions(options),
    compile(source, compileOptions) {
      if (source === marker) {
        throw new WikitextParseError("PARSE_FAILED", `Rejected marker source: ${marker}`);
      }
      return base.compile(source, compileOptions);
    },
    build(program, buildOptions) {
      return base.build(program, buildOptions);
    },
    parse(source, parseOptions) {
      if (source === marker) {
        throw new WikitextParseError("PARSE_FAILED", `Rejected marker source: ${marker}`);
      }
      return base.parse(source, parseOptions);
    },
  };
}

export { WikitextExpandError };
