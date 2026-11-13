import { WikitextExpandError, type WikitextExpandErrorCode } from "../ast/errors";
import { resolveParseLimits, type ResolvedParseLimits } from "../ast/limits";
import {
  AST_SCHEMA_VERSION,
  COMPILATION_SCHEMA_VERSION,
  SYNTAX_SCHEMA_VERSION,
  type WikitextCompilation,
  type WikitextCompilationDependency,
  type WikitextCompilationStats,
  type WikitextCompilationStatus,
  type WikitextDiagnostic,
  type WikitextParsedMeta,
  type WikitextParsedSnapshot,
  type WikitextRoot,
  type WikitextSyntaxRoot,
} from "../ast/model";
import type { WikitextParser, WikitextSyntaxProgram } from "../parser";
import {
  bindSegmentSources,
  createSourceGraphBuilder,
  effectiveSourceId,
  expandedSourceId,
  hashText,
  inputSourceId,
  normalizeWithSegments,
  normalizedSourceId,
  templateSourceId,
} from "../ast/sourceGraph/graph";
import { outputText } from "../ast/sourceGraph/output";
import type {
  WikitextSourceSegment,
  WikitextSourceSpan,
  WikitextTextSource,
} from "../ast/sourceGraph/types";
import { measureAsync, measureSync } from "../instrumentation";
import { assemble, recordInvocations } from "./assemble";
import { WikitextLruCache } from "./cache";
import { Evaluator, type TemplateDemand, type TemplateProgram } from "./evaluate";
import { filterTransclusionSource } from "./include";
import {
  assertTemplateSnapshot,
  type WikitextTemplateProvider,
  type WikitextTemplateRequest,
  type WikitextTemplateSnapshot,
  type WikitextTemplateSource,
} from "./provider";
import { TemplateFetcher, type SharedFetchTasks } from "./scheduler";
import { scanProtectedRegions } from "./syntax";
import type {
  WikitextCompileBudget,
  WikitextCompileCallOptions,
  WikitextCompiler,
  WikitextCompilerLimitsOptions,
  WikitextCompilerOptions,
  WikitextCompilerStats,
  WikitextInput,
} from "./types";

const DEFAULT_MAX_DEPTH = 40;
const DEFAULT_MAX_INVOCATIONS = 1_000;
const DEFAULT_MAX_TEMPLATES = 5_000;
const DEFAULT_MAX_DIAGNOSTICS = 5_000;
const DEFAULT_MAX_TEMPLATE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_SOURCES = 4_096;
const DEFAULT_MAX_SEGMENTS = 250_000;
const DEFAULT_MAX_INVOCATION_RECORDS = 20_000;
const DEFAULT_CACHE_ENTRIES = 500;
const DEFAULT_CACHE_BYTES = 16 * 1024 * 1024;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_BATCH_SIZE = 50;
const TITLE_CACHE_ENTRIES = 512;

/** 缓存条目的近似字节数：UTF-16 文本加固定结构开销。 */
function entryBytes(text: string, overhead: number): number {
  return text.length * 2 + overhead;
}
/** 求值轮次上限：每轮至少解决一层模板嵌套，超过说明需求无法收敛。 */
const MAX_ROUNDS = 256;

interface ResolvedBudgets {
  readonly maxDepth: number;
  readonly maxInvocations: number;
  readonly maxExpandedLength: number;
  readonly maxTemplates: number;
}

interface TemplateProgramEntry extends TemplateProgram {
  readonly sources: readonly WikitextTextSource[];
  readonly segments: readonly WikitextSourceSegment[];
  /** 用于 LRU 字节计量的近似大小。 */
  readonly bytes: number;
}

interface PageProgramEntry {
  readonly program: WikitextSyntaxProgram;
  readonly sources: readonly WikitextTextSource[];
  readonly segments: readonly WikitextSourceSegment[];
  readonly bytes: number;
}

function invalid(message: string): never {
  throw new WikitextExpandError("INVALID_EXPAND_OPTIONS", message);
}

function positive(value: unknown, name: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    invalid(`${name} must be a positive safe integer.`);
  }
  return value;
}

function nonNegative(value: unknown, name: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid(`${name} must be a non-negative safe integer.`);
  }
  return value;
}

function limitsKey(limits: ResolvedParseLimits): string {
  return `${limits.maxSourceLength}:${limits.maxSyntaxNodes}:${limits.maxSemanticNodes}:${limits.maxDepth}`;
}

function resolveBudgets(
  limits: ResolvedParseLimits,
  budget: WikitextCompileBudget = {},
): ResolvedBudgets {
  const maxExpandedLength = nonNegative(
    budget.maxExpandedLength,
    "budget.maxExpandedLength",
    limits.maxSourceLength,
  );
  return {
    maxDepth: positive(budget.maxDepth, "budget.maxDepth", DEFAULT_MAX_DEPTH),
    maxInvocations: nonNegative(
      budget.maxInvocations,
      "budget.maxInvocations",
      DEFAULT_MAX_INVOCATIONS,
    ),
    // 展开长度不能高于最终解析能接受的长度，否则最终解析必然失败。
    maxExpandedLength: Math.min(maxExpandedLength, limits.maxSourceLength),
    maxTemplates: positive(budget.maxTemplates, "budget.maxTemplates", DEFAULT_MAX_TEMPLATES),
  };
}

/** 校验 parser 返回的语法程序；缺失或畸形时报明确的不兼容错误。 */
function assertSyntaxProgram(program: WikitextSyntaxProgram): void {
  const syntax = program.syntax as { type?: unknown; children?: unknown } | undefined;
  if (!syntax || syntax.type !== "root" || !Array.isArray(syntax.children)) {
    throw new WikitextExpandError(
      "INCOMPATIBLE_PARSER",
      "The parser must return a syntax tree for template expansion.",
    );
  }
}

/** 计算 `kept` 片段之间的删除区间。 */
function deletedRanges(
  kept: readonly (readonly [number, number])[],
  length: number,
): Array<readonly [number, number]> {
  const deleted: Array<readonly [number, number]> = [];
  let cursor = 0;
  for (const [start, end] of kept) {
    if (start > cursor) {
      deleted.push([cursor, start]);
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < length) {
    deleted.push([cursor, length]);
  }
  return deleted;
}

/**
 * 创建可复用的 wikitext 编译器。
 *
 * 实例固定 parser 与 provider；缓存、依赖索引与统计归实例所有。每次 compile
 * 使用独立的来源图、预算与取消域，模板获取按确定需求分批进行。
 * @param options 编译器配置。
 */
export function createWikitextCompiler(options: WikitextCompilerOptions): WikitextCompiler {
  if (!options || typeof options !== "object") {
    invalid("createWikitextCompiler requires an options object.");
  }
  const parser: WikitextParser = options.parser;
  if (!parser || typeof parser.compile !== "function" || typeof parser.build !== "function") {
    invalid("The compiler requires a parser with compile() and build().");
  }
  const provider: WikitextTemplateProvider = options.provider;
  if (!provider || typeof provider.open !== "function") {
    invalid("The compiler requires a template provider with open().");
  }
  const profile = options.profile;
  const cacheEntries = positive(
    options.cache?.maxEntries,
    "cache.maxEntries",
    DEFAULT_CACHE_ENTRIES,
  );
  const cacheBytes = positive(options.cache?.maxBytes, "cache.maxBytes", DEFAULT_CACHE_BYTES);
  const concurrency = positive(
    options.fetch?.concurrency,
    "fetch.concurrency",
    DEFAULT_CONCURRENCY,
  );
  const batchSize = positive(options.fetch?.batchSize, "fetch.batchSize", DEFAULT_BATCH_SIZE);
  const limitOptions: WikitextCompilerLimitsOptions = options.limits ?? {};
  const maxSources = positive(limitOptions.maxSources, "limits.maxSources", DEFAULT_MAX_SOURCES);
  const maxSegments = positive(
    limitOptions.maxSegments,
    "limits.maxSegments",
    DEFAULT_MAX_SEGMENTS,
  );
  const maxInvocationRecords = positive(
    limitOptions.maxInvocations,
    "limits.maxInvocations",
    DEFAULT_MAX_INVOCATION_RECORDS,
  );
  const maxDiagnostics = positive(
    limitOptions.maxDiagnostics,
    "limits.maxDiagnostics",
    DEFAULT_MAX_DIAGNOSTICS,
  );
  const maxTemplateBytes = positive(
    limitOptions.maxTemplateBytes,
    "limits.maxTemplateBytes",
    DEFAULT_MAX_TEMPLATE_BYTES,
  );

  const pageCache = new WikitextLruCache<PageProgramEntry>(
    cacheEntries,
    cacheBytes,
    (entry) => entry.bytes,
  );
  const programCache = new WikitextLruCache<TemplateProgramEntry>(
    cacheEntries,
    cacheBytes,
    (entry) => entry.bytes,
  );
  const fetchCache = new WikitextLruCache<WikitextTemplateSource | null>(
    cacheEntries,
    cacheBytes,
    (entry) => (entry === null ? 8 : entryBytes(entry.source, 16)),
  );
  const titleCache = new WikitextLruCache<string | null>(TITLE_CACHE_ENTRIES, cacheBytes, (value) =>
    value === null ? 8 : entryBytes(value, 16),
  );

  let generation = 0;
  let disposed = false;
  const sharedTasks: SharedFetchTasks = new Map();
  const totals = {
    compiles: 0,
    programHits: 0,
    programMisses: 0,
    programCompilations: 0,
    providerRequests: 0,
    batches: 0,
  };

  const resolveTitle = (
    text: string,
    pageName: string | undefined,
    limits: ResolvedParseLimits,
  ): string | undefined => {
    const key = `${pageName ?? ""}\u0000${text}`;
    const cached = titleCache.get(key);
    if (cached !== undefined) {
      return cached ?? undefined;
    }
    let title: string | null = null;
    const snippet = `{{${text}}}`;
    try {
      const program = parser.compile(snippet, {
        ...(pageName === undefined ? {} : { pageName }),
        maxSourceLength: Math.max(limits.maxSourceLength, snippet.length),
      });
      const template = program.syntax.children.find((child) => child.type === "template");
      const parsed = template?.props.name;
      title = typeof parsed === "string" && parsed ? parsed : null;
    } catch {
      title = null;
    }
    titleCache.set(key, title);
    return title ?? undefined;
  };

  /** 页面语法程序：静态或未变文本复用；缓存命中也要按新预算重新校验。 */
  const pageProgram = (
    input: WikitextInput,
    pageName: string | undefined,
    limits: ResolvedParseLimits,
  ): PageProgramEntry => {
    const inputId = inputSourceId(input.key, input.revision);
    const normalizedId = normalizedSourceId(input.key, input.revision);
    const cacheKey = `${parser.key}\u0000${limitsKey(limits)}\u0000${inputId}`;
    const cached = pageCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const normalized = measureSync("normalize", profile, () => normalizeWithSegments(input.text));
    const sources: WikitextTextSource[] = [
      {
        id: inputId,
        key: input.key,
        revision: input.revision,
        role: "input",
        text: input.text,
        ...(pageName === undefined ? {} : { title: pageName }),
      },
      {
        id: normalizedId,
        key: input.key,
        revision: input.revision,
        role: "normalized",
        text: normalized.text,
        ...(pageName === undefined ? {} : { title: pageName }),
      },
    ];
    const segments = bindSegmentSources(normalized.segments, inputId, normalizedId);
    const program = measureSync("page-syntax", profile, () =>
      parser.compile(normalized.text, {
        ...(pageName === undefined ? {} : { pageName }),
        sourceId: normalizedId,
        maxSourceLength: limits.maxSourceLength,
        maxSyntaxNodes: limits.maxSyntaxNodes,
        maxDepth: limits.maxDepth,
      }),
    );
    assertSyntaxProgram(program);
    const entry: PageProgramEntry = {
      program,
      sources,
      segments,
      bytes: entryBytes(normalized.text, 1_024),
    };
    pageCache.set(cacheKey, entry);
    return entry;
  };

  /**
   * 模板语法程序：归一化、include 过滤与语法编译只做一次。
   * @param allowWrite 缓存代次已推进时不写回共享缓存。
   */
  const templateProgram = (
    title: string,
    source: WikitextTemplateSource,
    snapshot: WikitextTemplateSnapshot,
    pageName: string | undefined,
    limits: ResolvedParseLimits,
    allowWrite: boolean,
  ): { entry: TemplateProgramEntry; cached: boolean } => {
    const revision = `${snapshot.revision}.${source.revision ?? hashText(source.source)}`;
    const cacheKey = `${parser.key}\u0000${snapshot.key}\u0000${revision}\u0000${title}\u0000${pageName ?? ""}`;
    const cached = programCache.get(cacheKey);
    if (cached) {
      return { entry: cached, cached: true };
    }
    const rawId = templateSourceId(snapshot.key, revision, title);
    const sources: WikitextTextSource[] = [
      { id: rawId, key: snapshot.key, revision, role: "template", text: source.source, title },
    ];
    const segments: WikitextSourceSegment[] = [];
    const normalized = normalizeWithSegments(source.source);
    let baseId = rawId;
    if (normalized.text !== source.source) {
      const normalizedId = normalizedSourceId(`${snapshot.key}:${title}`, revision);
      sources.push({
        id: normalizedId,
        key: snapshot.key,
        revision,
        role: "normalized",
        text: normalized.text,
        title,
      });
      for (const segment of bindSegmentSources(normalized.segments, rawId, normalizedId)) {
        segments.push(segment);
      }
      baseId = normalizedId;
    }

    const filtered = filterTransclusionSource(
      normalized.text,
      scanProtectedRegions(normalized.text),
    );
    const kept = [...filtered.kept];
    let effective = filtered.text;
    if (effective.endsWith("\n")) {
      effective = effective.slice(0, -1);
      const last = kept[kept.length - 1];
      if (last && last[1] - last[0] === 1) {
        kept.pop();
      } else if (last) {
        kept[kept.length - 1] = [last[0], last[1] - 1];
      }
    }

    const effectiveId = effectiveSourceId(snapshot.key, revision, title);
    sources.push({
      id: effectiveId,
      key: snapshot.key,
      revision,
      role: "effective",
      text: effective,
      title,
    });
    let offset = 0;
    for (const [start, end] of kept) {
      if (end <= start) {
        continue;
      }
      segments.push({
        kind: "copy",
        from: { sourceId: baseId, start, end },
        to: { sourceId: effectiveId, start: offset, end: offset + (end - start) },
        precision: "exact",
      });
      offset += end - start;
    }
    for (const [start, end] of deletedRanges(kept, normalized.text.length)) {
      segments.push({
        kind: "delete",
        from: { sourceId: baseId, start, end },
        precision: "exact",
      });
    }

    const program = parser.compile(effective, {
      ...(pageName === undefined ? {} : { pageName: title }),
      sourceId: effectiveId,
      maxSourceLength: limits.maxSourceLength,
      maxSyntaxNodes: limits.maxSyntaxNodes,
      maxDepth: limits.maxDepth,
    });
    assertSyntaxProgram(program);
    totals.programCompilations++;
    const entry: TemplateProgramEntry = {
      title,
      revision,
      source: {
        id: effectiveId,
        key: snapshot.key,
        revision,
        role: "effective",
        text: effective,
        title,
      },
      syntax: program.syntax,
      sources,
      segments,
      bytes: entryBytes(effective, 1_024) + entryBytes(source.source, 0),
    };
    if (allowWrite) {
      programCache.set(cacheKey, entry);
    }
    return { entry, cached: false };
  };

  const compile = async (
    input: WikitextInput,
    callOptions: WikitextCompileCallOptions = {},
  ): Promise<WikitextCompilation> => {
    if (disposed) {
      throw new WikitextExpandError("DISPOSED", "The compiler has been disposed.");
    }
    if (!input || typeof input !== "object") {
      invalid("compile requires an input object.");
    }
    if (typeof input.key !== "string" || !input.key) {
      invalid("input.key must be a non-empty string.");
    }
    if (typeof input.revision !== "string" || !input.revision) {
      invalid("input.revision must be a non-empty string.");
    }
    if (typeof input.text !== "string") {
      invalid("input.text must be a string.");
    }
    if (
      callOptions.failureMode !== undefined &&
      callOptions.failureMode !== "preserve" &&
      callOptions.failureMode !== "throw"
    ) {
      invalid('failureMode must be "preserve" or "throw".');
    }
    const signal = callOptions.signal;
    if (signal?.aborted) {
      throw new WikitextExpandError("ABORTED", "Template expansion was aborted.", {
        cause: signal.reason,
      });
    }
    const started = Date.now();
    let resolved: ReturnType<WikitextParser["resolveOptions"]>;
    try {
      resolved = parser.resolveOptions(callOptions.parseOptions ?? {});
    } catch (error) {
      throw new WikitextExpandError(
        "INVALID_EXPAND_OPTIONS",
        error instanceof Error ? error.message : "Invalid parse options.",
        { cause: error },
      );
    }
    const limits = resolveParseLimits(resolved);
    const pageName = callOptions.pageName ?? (input.key || undefined);
    const budgets = resolveBudgets(limits, callOptions.budget ?? {});
    // 解析工厂的默认值已经并入 resolved；单次展开选项可以覆盖。
    const retainSyntax = callOptions.retainSyntax ?? resolved.retainSyntax;
    const failureMode = callOptions.failureMode ?? "preserve";
    const cycle = generation;
    const builder = createSourceGraphBuilder({
      maxSources,
      maxSegments,
      maxInvocations: maxInvocationRecords,
    });

    const page = pageProgram(input, pageName, limits);
    for (const source of page.sources) {
      builder.addSource(source);
    }
    for (const segment of page.segments) {
      builder.addSegment(segment);
    }
    const normalizedSource = page.sources[1]!;

    const opened = await provider.open({
      key: input.key,
      revision: input.revision,
      ...(pageName === undefined ? {} : { pageName }),
      ...(signal === undefined ? {} : { signal }),
    });
    assertTemplateSnapshot(opened);
    const fetcher = new TemplateFetcher({
      snapshot: opened,
      cache: fetchCache,
      concurrency,
      batchSize,
      shared: sharedTasks,
      onRequest: (count) => {
        totals.providerRequests += count;
      },
    });

    const programs = new Map<string, TemplateProgramEntry>();
    const failures = new Map<string, { code: WikitextExpandErrorCode; cause?: unknown }>();
    const dependencies = new Map<string, WikitextCompilationDependency>();
    const diagnostics: WikitextDiagnostic[] = [];
    const pushDiagnostic = (diagnostic: WikitextDiagnostic): void => {
      if (diagnostics.length < maxDiagnostics) {
        diagnostics.push(diagnostic);
      }
    };
    const demandRef = new Map<string, TemplateDemand>();
    let programHits = 0;
    let programMisses = 0;
    let batches = 0;
    let fetchedTemplates = 0;
    let templateBytes = 0;

    const buildEvaluator = (): Evaluator =>
      new Evaluator({
        pageSource: normalizedSource,
        ...(pageName === undefined ? {} : { pageName }),
        program: (title) => programs.get(title),
        failure: (title) => {
          const failure = failures.get(title);
          if (!failure) {
            return undefined;
          }
          return {
            code: failure.code,
            message:
              failure.code === "TEMPLATE_NOT_FOUND"
                ? `Template "${title}" was not found.`
                : failure.code === "TEMPLATE_RESOLVE_FAILED"
                  ? `Template provider failed for "${title}".`
                  : `Template "${title}" could not be compiled.`,
            ...(failure.cause === undefined ? {} : { cause: failure.cause }),
          };
        },
        demand: (demand) => {
          if (!demandRef.has(demand.title)) {
            demandRef.set(demand.title, demand);
          }
        },
        normalizeTitle: (text, contextPageName) => resolveTitle(text, contextPageName, limits),
        diagnostics,
        maxDepth: budgets.maxDepth,
        maxInvocations: budgets.maxInvocations,
        maxLength: budgets.maxExpandedLength,
        failureMode,
      });

    try {
      let evaluation = measureSync("evaluate", profile, () =>
        buildEvaluator().evaluate(page.program.syntax, normalizedSource),
      );
      for (let round = 0; round < MAX_ROUNDS; round++) {
        if (demandRef.size === 0) {
          break;
        }
        if (signal?.aborted) {
          throw new WikitextExpandError("ABORTED", "Template expansion was aborted.", {
            cause: signal.reason,
          });
        }
        const pending = [...demandRef.keys()].filter(
          (title) => !programs.has(title) && !failures.has(title),
        );
        if (pending.length === 0) {
          break;
        }
        if (fetchedTemplates + pending.length > budgets.maxTemplates) {
          throw new WikitextExpandError(
            "EXPANSION_BUDGET_EXCEEDED",
            `The compilation reached the template limit of ${budgets.maxTemplates}.`,
          );
        }
        // 本轮需求已经确定；先快照再清空，供 provider 请求携带真实调用位置。
        const demands = new Map(demandRef);
        demandRef.clear();
        batches++;
        totals.batches++;
        const fetched = await measureAsync("fetch", profile, () =>
          fetcher.fetch(
            pending,
            (title) => {
              const demand = demands.get(title);
              const location: WikitextSourceSpan = demand?.location ?? {
                sourceId: normalizedSource.id,
                start: 0,
                end: normalizedSource.text.length,
              };
              const request: WikitextTemplateRequest = {
                title,
                ...(pageName === undefined ? {} : { pageName }),
                ...(demand?.callerTitle === undefined ? {} : { callerTitle: demand.callerTitle }),
                location,
                ...(signal === undefined ? {} : { signal }),
              };
              return request;
            },
            signal,
          ),
        );
        for (const [title, result] of fetched) {
          dependencies.set(title, {
            title,
            revision: result.source?.revision ?? "",
            found: result.ok,
            cached: result.cached,
          });
          if (!result.ok) {
            failures.set(title, {
              code: result.code ?? "TEMPLATE_NOT_FOUND",
              ...(result.cause === undefined ? {} : { cause: result.cause }),
            });
            continue;
          }
          fetchedTemplates++;
          templateBytes += (result.source?.source.length ?? 0) * 2;
          if (templateBytes > maxTemplateBytes) {
            throw new WikitextExpandError(
              "EXPANSION_TOO_LARGE",
              `Template sources exceed the byte limit of ${maxTemplateBytes}.`,
            );
          }
          let entry: TemplateProgramEntry;
          let cached: boolean;
          try {
            ({ entry, cached } = measureSync("template", profile, () =>
              templateProgram(
                title,
                result.source!,
                opened,
                pageName,
                limits,
                cycle === generation,
              ),
            ));
          } catch (error) {
            if (
              error instanceof WikitextExpandError &&
              (error.code === "ABORTED" || error.code === "DISPOSED")
            ) {
              throw error;
            }
            // 单个模板解析失败只影响该标题的调用点，不影响其他模板。
            failures.set(title, { code: "TEMPLATE_PARSE_FAILED", cause: error });
            continue;
          }
          if (cached) {
            programHits++;
            totals.programHits++;
          } else {
            programMisses++;
            totals.programMisses++;
          }
          programs.set(title, entry);
          for (const source of entry.sources) {
            builder.addSource(source);
          }
          for (const segment of entry.segments) {
            builder.addSegment(segment);
          }
        }
        // 需求集合在本轮已经被消费；下一轮重新收集。
        demandRef.clear();
        evaluation = measureSync("evaluate", profile, () =>
          buildEvaluator().evaluate(page.program.syntax, normalizedSource),
        );
      }

      if (demandRef.size > 0) {
        throw new WikitextExpandError(
          "UNRESOLVED_DEPENDENCY",
          "Template expansion did not converge; the dependency graph is too deep.",
        );
      }

      const expandedText = outputText(evaluation.output);
      if (expandedText.length > budgets.maxExpandedLength) {
        // 超过硬上限时不能截断文本或伪造来源，整次编译失败。
        throw new WikitextExpandError(
          "EXPANSION_TOO_LARGE",
          `The expanded source exceeds the length limit of ${budgets.maxExpandedLength}.`,
          {
            location: {
              sourceId: normalizedSource.id,
              start: 0,
              end: normalizedSource.text.length,
            },
          },
        );
      }
      const expandedId = expandedSourceId(input.key, input.revision, expandedText);
      builder.addSource({
        id: expandedId,
        key: input.key,
        revision: input.revision,
        role: "expanded",
        text: expandedText,
        ...(pageName === undefined ? {} : { title: pageName }),
      });
      measureSync("assemble", profile, () => {
        assemble(builder, evaluation.output, expandedId);
        recordInvocations(builder, evaluation.invocations, evaluation.output.marks, expandedId);
      });

      const status: WikitextCompilationStatus =
        evaluation.unresolved || evaluation.invocations.some((draft) => draft.status !== "expanded")
          ? "partial"
          : "complete";

      let finalAst: WikitextRoot;
      let finalSyntax: WikitextSyntaxRoot;
      let activeSource: WikitextTextSource;
      let attemptedSourceId: string | undefined;
      const parseDiagnostics: WikitextDiagnostic[] = [];
      try {
        const program = measureSync("final-syntax", profile, () =>
          parser.compile(expandedText, {
            ...(pageName === undefined ? {} : { pageName }),
            sourceId: expandedId,
            maxSourceLength: budgets.maxExpandedLength,
          }),
        );
        finalSyntax = program.syntax;
        finalAst = measureSync("build", profile, () =>
          parser.build(program, {
            ...(callOptions.parseOptions === undefined ? {} : callOptions.parseOptions),
            diagnostics: parseDiagnostics,
          }),
        );
        activeSource = {
          id: expandedId,
          key: input.key,
          revision: input.revision,
          role: "expanded",
          text: expandedText,
          ...(pageName === undefined ? {} : { title: pageName }),
        };
      } catch (error) {
        if (
          error instanceof WikitextExpandError &&
          (error.code === "ABORTED" || error.code === "DISPOSED")
        ) {
          throw error;
        }
        if ((error as { code?: unknown } | undefined)?.code === "SOURCE_TOO_LONG") {
          throw new WikitextExpandError(
            "EXPANSION_TOO_LARGE",
            "The expanded source exceeds the expanded length limit.",
            { cause: error },
          );
        }
        if (failureMode === "throw") {
          throw new WikitextExpandError(
            "FINAL_PARSE_FAILED",
            "The expanded source could not be parsed.",
            {
              cause: error,
              location: { sourceId: expandedId, start: 0, end: expandedText.length },
            },
          );
        }
        if (normalizedSource.text.length > budgets.maxExpandedLength) {
          // 回退快照本身超过展开长度上限时无法返回有效快照。
          throw new WikitextExpandError(
            "EXPANSION_TOO_LARGE",
            "The original source exceeds the expanded length limit, so no fallback snapshot can be returned.",
            { cause: error },
          );
        }
        attemptedSourceId = expandedId;
        pushDiagnostic({
          code: "FINAL_PARSE_FALLBACK",
          stage: "expand",
          severity: "error",
          message: `The expanded source could not be parsed; the original snapshot was returned. ${
            error instanceof Error ? error.message : String(error)
          }`,
          location: { sourceId: expandedId, start: 0, end: expandedText.length },
          related: [
            {
              location: {
                sourceId: normalizedSource.id,
                start: 0,
                end: normalizedSource.text.length,
              },
              message: "Original page source.",
              stage: "expand",
            },
          ],
        });
        const fallbackDiagnostics: WikitextDiagnostic[] = [];
        finalAst = measureSync("build", profile, () =>
          parser.build(page.program, { diagnostics: fallbackDiagnostics }),
        );
        for (const diagnostic of fallbackDiagnostics) {
          pushDiagnostic(diagnostic);
        }
        finalSyntax = page.program.syntax;
        activeSource = normalizedSource;
      }
      for (const diagnostic of parseDiagnostics) {
        pushDiagnostic(diagnostic);
      }

      const meta: WikitextParsedMeta = {
        astSchemaVersion: AST_SCHEMA_VERSION,
        ...(retainSyntax ? { syntaxSchemaVersion: SYNTAX_SCHEMA_VERSION } : {}),
        parser: parser.name,
        parserVersion: parser.version,
        ...(pageName === undefined ? {} : { pageName }),
        sourceNormalized: normalizedSource.text !== input.text,
        originalLength: input.text.length,
        limits,
        retainSyntax,
      };
      const snapshot: WikitextParsedSnapshot = {
        kind: "parsed",
        id: activeSource.id,
        activeSourceId: activeSource.id,
        graph: builder.finalize(),
        source: activeSource.text,
        ast: finalAst,
        ...(retainSyntax ? { syntax: finalSyntax } : {}),
        meta,
        diagnostics: diagnostics,
      };

      const stats: WikitextCompilationStats = {
        providerRequests: [...dependencies.values()].filter((entry) => !entry.cached).length,
        batches,
        programCacheHits: programHits,
        programCacheMisses: programMisses,
        programCompilations: totals.programCompilations,
        invocationCount: evaluation.invocations.length,
        segmentCount: snapshot.graph.segments.length,
        sourceCount: snapshot.graph.sources.length,
        durationMs: Date.now() - started,
      };
      totals.compiles++;
      return {
        schemaVersion: COMPILATION_SCHEMA_VERSION,
        status: attemptedSourceId === undefined ? status : "fallback",
        inputSourceId: page.sources[0]!.id,
        outputSourceId: activeSource.id,
        ...(attemptedSourceId === undefined ? {} : { attemptedSourceId }),
        snapshot,
        dependencies: [...dependencies.values()],
        stats,
      };
    } finally {
      // 共享获取任务由 compiler 统一取消；这里只释放本次会话。
      try {
        await opened.release?.();
      } catch {
        // release 失败不应掩盖编译结果或原始错误。
      }
    }
  };

  return {
    parser,
    providerKey: provider.key,
    compile,
    invalidate() {
      generation++;
      programCache.clear();
      pageCache.clear();
      titleCache.clear();
    },
    clearCache() {
      generation++;
      programCache.clear();
      pageCache.clear();
      fetchCache.clear();
      titleCache.clear();
      totals.programHits = 0;
      totals.programMisses = 0;
    },
    getStats(): WikitextCompilerStats {
      return {
        compiles: totals.compiles,
        programCacheHits: totals.programHits,
        programCacheMisses: totals.programMisses,
        programCompilations: totals.programCompilations,
        providerRequests: totals.providerRequests,
        batches: totals.batches,
        fetch: fetchCache.stats,
        program: programCache.stats,
      };
    },
    async dispose() {
      disposed = true;
      generation++;
      for (const task of sharedTasks.values()) {
        task.controller.abort();
      }
      sharedTasks.clear();
      programCache.clear();
      pageCache.clear();
      fetchCache.clear();
      titleCache.clear();
    },
  };
}
