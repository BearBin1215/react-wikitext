import { WikitextExpandError } from "../ast/errors";
import type { WikitextLruCache } from "./cache";
import type {
  WikitextTemplateRequest,
  WikitextTemplateSnapshot,
  WikitextTemplateSource,
} from "./provider";

/** 单标题获取结果。 */
export interface TemplateFetchResult {
  readonly title: string;
  readonly ok: boolean;
  /** 命中的模板；缺失与失败时省略。 */
  readonly source?: WikitextTemplateSource;
  /** 缺失（provider 明确返回 null）。 */
  readonly missing?: boolean;
  /** 失败原因码。 */
  readonly code?: "TEMPLATE_RESOLVE_FAILED" | "TEMPLATE_NOT_FOUND";
  readonly message?: string;
  readonly cause?: unknown;
  /** 是否由 fetch 缓存命中。 */
  readonly cached: boolean;
}

/** 共享的未完成获取任务；键包含 provider 来源与版本。 */
export interface BatchTask {
  readonly promise: Promise<readonly TemplateFetchResult[]>;
  readonly subscribers: Set<AbortSignal | undefined>;
  readonly controller: AbortController;
}

/** 同一 provider 快照的未完成任务表；由 compiler 持有并在实例间共享。 */
export type SharedFetchTasks = Map<string, BatchTask>;

function abortError(signal: AbortSignal): WikitextExpandError {
  return new WikitextExpandError("ABORTED", "Template expansion was aborted.", {
    cause: signal.reason,
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal);
  }
}

/** 等待一个 Promise，但不让第一个订阅者的取消影响共享任务。 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(abortError(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
        return undefined;
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
        return undefined;
      },
    );
  });
}

/** 有界并发执行器；保持提交顺序稳定。 */
async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) {
        return;
      }
      results[index] = await run(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 获取缓存值；`null` 表示明确缺失，与失败区分。 */
export type TemplateFetchCache = WikitextLruCache<WikitextTemplateSource | null>;

export interface TemplateFetcherOptions {
  readonly snapshot: WikitextTemplateSnapshot;
  readonly cache: TemplateFetchCache;
  readonly concurrency: number;
  readonly batchSize: number;
  /** 编译器持有的共享任务表；并发编译可以订阅同一个未完成请求。 */
  readonly shared?: SharedFetchTasks;
  /** 编译级统计；只记录实际发出的请求。 */
  readonly onRequest: (count: number) => void;
}

/**
 * 模板获取层：批量、去重、受控并发与可取消等待。
 *
 * 基础任务使用独立取消信号，不绑定第一个调用者的 signal；只有最后一个订阅者
 * 退出时才中断基础任务。同一 provider 快照的未完成任务由编译器共享。
 */
export class TemplateFetcher {
  private readonly pending: SharedFetchTasks;
  private disposed = false;

  constructor(private readonly options: TemplateFetcherOptions) {
    this.pending = options.shared ?? new Map();
  }

  /** 读取已缓存结果；`undefined` 表示需要获取。 */
  peek(title: string): TemplateFetchResult | undefined {
    const cached = this.options.cache.peek(this.cacheKey(title));
    if (cached === undefined) {
      return undefined;
    }
    return cached === null
      ? { title, ok: false, missing: true, code: "TEMPLATE_NOT_FOUND", cached: true }
      : { title, ok: true, source: cached, cached: true };
  }

  /**
   * 批量获取确定需求的标题。
   * @param titles 本轮确定需要的标题；重复项会被合并。
   * @param requestFor 生成单个标题的请求上下文。
   * @param signal 本次订阅的取消信号；只影响这个订阅者。
   */
  async fetch(
    titles: readonly string[],
    requestFor: (title: string) => WikitextTemplateRequest,
    signal?: AbortSignal,
  ): Promise<Map<string, TemplateFetchResult>> {
    throwIfAborted(signal);
    if (this.disposed) {
      throw new WikitextExpandError("DISPOSED", "The compiler has been disposed.");
    }
    const results = new Map<string, TemplateFetchResult>();
    const missing: string[] = [];
    for (const title of new Set(titles)) {
      const cached = this.peek(title);
      if (cached) {
        results.set(title, cached);
      } else {
        missing.push(title);
      }
    }
    if (missing.length === 0) {
      return results;
    }

    const batches = this.batchesFor(missing);
    const fetched = await mapPool(batches, this.options.concurrency, async (batch) =>
      this.runBatch(batch, requestFor, signal),
    );
    for (const batch of fetched) {
      for (const result of batch) {
        results.set(result.title, result);
      }
    }
    return results;
  }

  /** 按 `getMany` 能力切分批次；标题顺序稳定，不依赖网络返回顺序。 */
  private batchesFor(titles: readonly string[]): string[][] {
    if (this.options.snapshot.getMany === undefined) {
      return titles.map((title) => [title]);
    }
    const size = Math.max(1, this.options.batchSize);
    const batches: string[][] = [];
    for (let index = 0; index < titles.length; index += size) {
      batches.push(titles.slice(index, index + size));
    }
    return batches;
  }

  private taskKey(batch: readonly string[]): string {
    return `${this.options.snapshot.key}\u0000${this.options.snapshot.revision}\u0000${batch.join("\u0000")}`;
  }

  /** 缓存条目属于 provider 的某个快照版本；模板更新必须通过新的 revision 进入。 */
  private cacheKey(title: string): string {
    return `${this.options.snapshot.key}\u0000${this.options.snapshot.revision}\u0000${title}`;
  }

  private async runBatch(
    batch: readonly string[],
    requestFor: (title: string) => WikitextTemplateRequest,
    signal: AbortSignal | undefined,
  ): Promise<readonly TemplateFetchResult[]> {
    const key = this.taskKey(batch);
    const existing = this.pending.get(key);
    if (existing) {
      return this.subscribe(existing, signal);
    }
    const controller = new AbortController();
    const promise = this.execute(batch, requestFor, controller.signal).finally(() => {
      this.pending.delete(key);
    });
    const task: BatchTask = { controller, subscribers: new Set(), promise };
    this.pending.set(key, task);
    return this.subscribe(task, signal);
  }

  private async subscribe(
    task: BatchTask,
    signal: AbortSignal | undefined,
  ): Promise<readonly TemplateFetchResult[]> {
    task.subscribers.add(signal);
    const onAbort = (): void => {
      task.subscribers.delete(signal);
      if (task.subscribers.size === 0) {
        task.controller.abort(signal?.reason);
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await raceAbort(task.promise, signal);
    } finally {
      signal?.removeEventListener("abort", onAbort);
      task.subscribers.delete(signal);
    }
  }

  private async execute(
    batch: readonly string[],
    requestFor: (title: string) => WikitextTemplateRequest,
    signal: AbortSignal,
  ): Promise<readonly TemplateFetchResult[]> {
    const requests = batch.map((title) => requestFor(title));
    this.options.onRequest(batch.length);
    try {
      if (this.options.snapshot.getMany) {
        const response = await this.options.snapshot.getMany(batch, requests);
        return this.fromBatch(batch, response);
      }
      const results: TemplateFetchResult[] = [];
      for (const [index, title] of batch.entries()) {
        const response = await this.options.snapshot.get(title, requests[index]!);
        results.push(this.fromSingle(title, response));
      }
      return results;
    } catch (error) {
      if (signal.aborted) {
        throw abortError(signal);
      }
      return batch.map((title) => ({
        title,
        ok: false,
        code: "TEMPLATE_RESOLVE_FAILED",
        message: `Template provider failed for "${title}".`,
        cause: error,
        cached: false,
      }));
    }
  }

  private fromBatch(
    batch: readonly string[],
    response:
      | ReadonlyMap<string, WikitextTemplateSource | null>
      | Readonly<Record<string, WikitextTemplateSource | null>>,
  ): readonly TemplateFetchResult[] {
    const lookup = (title: string): WikitextTemplateSource | null | undefined => {
      if (response instanceof Map) {
        return response.get(title);
      }
      const record = response as Readonly<Record<string, WikitextTemplateSource | null>>;
      return Object.prototype.hasOwnProperty.call(record, title) ? record[title] : undefined;
    };
    return batch.map((title) => {
      const value = lookup(title);
      if (value === undefined) {
        return {
          title,
          ok: false,
          code: "TEMPLATE_RESOLVE_FAILED",
          message: `The template provider did not return a result for "${title}".`,
          cached: false,
        };
      }
      return this.fromSingle(title, value);
    });
  }

  private fromSingle(
    title: string,
    response: WikitextTemplateSource | null | undefined,
  ): TemplateFetchResult {
    if (response === null) {
      this.options.cache.set(this.cacheKey(title), null);
      return { title, ok: false, missing: true, code: "TEMPLATE_NOT_FOUND", cached: false };
    }
    if (response === undefined) {
      return {
        title,
        ok: false,
        code: "TEMPLATE_RESOLVE_FAILED",
        message: `The template provider returned an invalid result for "${title}".`,
        cached: false,
      };
    }
    if (typeof response !== "object" || typeof response.source !== "string") {
      return {
        title,
        ok: false,
        code: "TEMPLATE_RESOLVE_FAILED",
        message: `The template provider returned a non-string source for "${title}".`,
        cached: false,
      };
    }
    const normalized: WikitextTemplateSource = {
      title: typeof response.title === "string" ? response.title : title,
      source: response.source,
      ...(response.revision === undefined ? {} : { revision: response.revision }),
    };
    this.options.cache.set(this.cacheKey(title), normalized);
    return { title, ok: true, source: normalized, cached: false };
  }

  /** 取消本实例可见的未完成请求；共享任务只在没有订阅者时中断。 */
  dispose(): void {
    this.disposed = true;
    for (const [key, task] of this.pending) {
      task.controller.abort();
      this.pending.delete(key);
    }
  }
}
