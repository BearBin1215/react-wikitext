import type { WikitextCompilation } from "../ast/model";
import type { WikitextStageSink } from "../instrumentation";
import type { WikitextParseOptions, WikitextParser } from "../parser";
import type { WikitextCacheStats } from "./cache";
import type { WikitextTemplateProvider } from "./provider";

/** 页面原始输入；`revision` 必须区分编辑版本。 */
export interface WikitextInput {
  /** 页面键；用于身份与诊断，不参与标题解析。 */
  readonly key: string;
  /** 内容版本；相同键的不同内容不能共用版本。 */
  readonly revision: string;
  /** 编辑器提交的原文，保留 CRLF。 */
  readonly text: string;
}

/** 单次编译的展开预算。 */
export interface WikitextCompileBudget {
  /** 求值调用栈深度上限，默认 40，必须是正整数。 */
  readonly maxDepth?: number;
  /** 实际进入求值的调用次数上限，默认 1000，必须是非负安全整数。 */
  readonly maxInvocations?: number;
  /** 展开后源码长度上限；默认取解析预算的 `maxSourceLength`。 */
  readonly maxExpandedLength?: number;
  /** 单次编译读取的模板数量上限，默认 5000。 */
  readonly maxTemplates?: number;
}

/** 单次编译选项。 */
export interface WikitextCompileCallOptions {
  /** 页面上下文名；省略时使用输入键。 */
  readonly pageName?: string;
  readonly signal?: AbortSignal;
  /**
   * 已定义的可恢复失败如何处理：
   * `preserve` 保留原文并记录诊断（默认），`throw` 直接抛出带来源的错误。
   */
  readonly failureMode?: "preserve" | "throw";
  /** 是否把上游语法树放进快照，默认关闭。 */
  readonly retainSyntax?: boolean;
  /** 解析预算与其他解析选项；`pageName` 由本层提供。 */
  readonly parseOptions?: Omit<WikitextParseOptions, "pageName">;
  readonly budget?: WikitextCompileBudget;
}

/** 编译器缓存容量。 */
export interface WikitextCompilerCacheOptions {
  /** 最大缓存条目数，默认 500，必须是正整数。 */
  readonly maxEntries?: number;
  /** 最大缓存字节数，默认 16 MiB，必须是正整数。 */
  readonly maxBytes?: number;
}

/** 获取层配置。 */
export interface WikitextCompilerFetchOptions {
  /** 并发上限，默认 4，必须是正整数。 */
  readonly concurrency?: number;
  /** `getMany` 的批大小，默认 50，必须是正整数。 */
  readonly batchSize?: number;
}

/** 资源上限；超限时整次编译失败，不静默丢弃映射。 */
export interface WikitextCompilerLimitsOptions {
  /** 来源图文本源上限，默认 4096。 */
  readonly maxSources?: number;
  /** 来源图片段上限，默认 250000。 */
  readonly maxSegments?: number;
  /** 调用记录上限，默认 20000。 */
  readonly maxInvocations?: number;
  /** 诊断数量上限，默认 5000。 */
  readonly maxDiagnostics?: number;
  /** 单次编译可读取的模板源码总字节上限，默认 16 MiB。 */
  readonly maxTemplateBytes?: number;
}

/** 创建编译器时的选项；实例配置固定，更换配置需要创建新实例。 */
export interface WikitextCompilerOptions {
  readonly parser: WikitextParser;
  readonly provider: WikitextTemplateProvider;
  readonly cache?: WikitextCompilerCacheOptions;
  readonly fetch?: WikitextCompilerFetchOptions;
  readonly limits?: WikitextCompilerLimitsOptions;
  /** 可选的阶段计时接收器；省略时不计量。 */
  readonly profile?: WikitextStageSink;
}

/** 编译器累计统计；`clearCache` 会重置缓存计数。 */
export interface WikitextCompilerStats {
  /** 完成的编译次数。 */
  readonly compiles: number;
  /** 模板语法程序的命中与未命中。 */
  readonly programCacheHits: number;
  readonly programCacheMisses: number;
  /** 实际编译模板语法程序的次数。 */
  readonly programCompilations: number;
  /** 发出的 provider 请求数（按标题与批次计）。 */
  readonly providerRequests: number;
  /** 需求批次数量。 */
  readonly batches: number;
  /** 模板获取缓存的统计。 */
  readonly fetch: WikitextCacheStats;
  /** 模板程序缓存的统计。 */
  readonly program: WikitextCacheStats;
}

/** 编译器实例。 */
export interface WikitextCompiler {
  readonly parser: WikitextParser;
  /** provider 身份；用于调试与缓存分组。 */
  readonly providerKey: string;
  /**
   * 编译一份页面输入。
   *
   * 一次编译固定使用同一个 provider 快照；诊断与来源图只保存在返回的
   * `snapshot` 上，外层只描述状态、依赖与统计。
   * @param input 页面原始输入与版本。
   * @param options 单次编译选项。
   */
  compile(input: WikitextInput, options?: WikitextCompileCallOptions): Promise<WikitextCompilation>;
  /** 推进缓存代次；旧代次的未完成任务不会在返回后重新填入。 */
  invalidate(): void;
  /** 清空缓存与统计。 */
  clearCache(): void;
  /** 读取累计统计与当前缓存占用。 */
  getStats(): WikitextCompilerStats;
  /** 释放索引、缓存与自有任务；不销毁宿主提供的 provider。 */
  dispose(): Promise<void>;
}
