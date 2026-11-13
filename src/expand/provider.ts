import { WikitextExpandError } from "../ast/errors";
import type { WikitextSourceSpan } from "../ast/sourceGraph/types";

/** 宿主获取模板时提供的页面上下文。 */
export interface WikitextProviderContext {
  /** 页面键；用于诊断与访问控制，不参与标题解析。 */
  readonly key: string;
  /** 页面版本。 */
  readonly revision: string;
  readonly pageName?: string;
  readonly signal?: AbortSignal;
}

/** 单个模板的获取结果；`null` 表示明确不存在。 */
export interface WikitextTemplateSource {
  /** 规范化后的标题。 */
  readonly title: string;
  /** 模板源码；空字符串是合法模板。 */
  readonly source: string;
  /** 内容版本；未提供时由 provider 版本与内容哈希派生。 */
  readonly revision?: string;
}

/** 传给 provider 的模板请求。 */
export interface WikitextTemplateRequest {
  /** parser 规范化后的模板标题，例如 `Template:Echo`。 */
  readonly title: string;
  /** 原始页面名；整个编译过程保持不变。 */
  readonly pageName?: string;
  /** 当前调用所属的模板标题；在页面中调用时省略。 */
  readonly callerTitle?: string;
  /** 实际调用所在的文本源与范围。 */
  readonly location: WikitextSourceSpan;
  readonly signal?: AbortSignal;
}

/** 单标题获取回调。 */
export type WikitextTemplateGetter = (
  title: string,
  request: WikitextTemplateRequest,
) => WikitextTemplateSource | null | undefined | Promise<WikitextTemplateSource | null | undefined>;

/** 批量获取回调；返回按标题索引的结果，允许顺序不同。 */
export type WikitextTemplateBatchGetter = (
  titles: readonly string[],
  requests: readonly WikitextTemplateRequest[],
) =>
  | ReadonlyMap<string, WikitextTemplateSource | null>
  | Readonly<Record<string, WikitextTemplateSource | null>>
  | Promise<
      | ReadonlyMap<string, WikitextTemplateSource | null>
      | Readonly<Record<string, WikitextTemplateSource | null>>
    >;

/**
 * 一次编译固定使用的模板来源快照。
 *
 * 同一快照对同一标题必须返回稳定内容；内容变化必须更换 `revision`。
 */
export interface WikitextTemplateSnapshot {
  /** 来源键；必须区分站点与授权内容域。 */
  readonly key: string;
  /** 内容版本；进入缓存键。 */
  readonly revision: string;
  readonly get: WikitextTemplateGetter;
  readonly getMany?: WikitextTemplateBatchGetter;
  /** 释放本次会话；成功、失败与取消都会调用，且只调用一次。 */
  readonly release?: () => void | Promise<void>;
}

/** 模板来源：每次编译打开一个固定版本的快照。 */
export interface WikitextTemplateProvider {
  /** provider 身份；用于诊断与缓存分组。 */
  readonly key: string;
  open(
    context: WikitextProviderContext,
  ): WikitextTemplateSnapshot | Promise<WikitextTemplateSnapshot>;
}

/** 模板表：键为规范化标题，值为模板源码。 */
export type WikitextTemplateTable = Readonly<Record<string, string>> | ReadonlyMap<string, string>;

/** 表 provider 的构造选项。 */
export interface TemplateTableProviderOptions {
  /** 来源键；不同站点或内容域必须使用不同值。 */
  readonly key: string;
  /** 内容版本；更新表必须更换版本。 */
  readonly revision: string;
  readonly templates: WikitextTemplateTable;
}

function invalid(message: string): never {
  throw new WikitextExpandError("INVALID_PROVIDER", message);
}

/** 按 Map 协议识别模板表，避免跨 realm 的 `instanceof Map` 判断失败。 */
function isTemplateMap(value: unknown): value is ReadonlyMap<unknown, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as { get?: unknown; has?: unknown; [Symbol.iterator]?: unknown };
  return (
    typeof candidate.get === "function" &&
    typeof candidate.has === "function" &&
    typeof candidate[Symbol.iterator] === "function"
  );
}

function isPlainRecord(value: object): boolean {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function templateEntries(table: unknown): Iterable<readonly [unknown, unknown]> {
  if (isTemplateMap(table)) {
    return table;
  }
  if (table === null || typeof table !== "object" || !isPlainRecord(table)) {
    invalid("templates must be a record of strings or a Map.");
  }
  return Object.entries(table);
}

/**
 * 创建不可变的模板表 provider。
 *
 * 构造时校验并复制一次，之后每次编译复用同一份副本；更新表必须构造新版本。
 * @param options 来源键、内容版本与模板表。
 */
export function createTemplateTableProvider(
  options: TemplateTableProviderOptions,
): WikitextTemplateProvider {
  if (!options || typeof options !== "object") {
    invalid("createTemplateTableProvider requires an options object.");
  }
  if (typeof options.key !== "string" || !options.key) {
    invalid("provider key must be a non-empty string.");
  }
  if (typeof options.revision !== "string" || !options.revision) {
    invalid("provider revision must be a non-empty string.");
  }
  const copy = new Map<string, string>();
  try {
    for (const entry of templateEntries(options.templates)) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        invalid("templates entries must be [title, source] pairs.");
      }
      const [title, source] = entry;
      if (typeof title !== "string") {
        invalid("templates keys must be strings.");
      }
      if (typeof source !== "string") {
        invalid(`templates["${title}"] must be a string.`);
      }
      copy.set(title, source);
    }
  } catch (error) {
    if (error instanceof WikitextExpandError) {
      throw error;
    }
    invalid("templates could not be read as a record or a Map.");
  }

  const snapshot: WikitextTemplateSnapshot = {
    key: options.key,
    revision: options.revision,
    get(title) {
      const source = copy.get(title);
      return source === undefined ? null : { title, source };
    },
    getMany(titles) {
      const result = new Map<string, WikitextTemplateSource | null>();
      for (const title of titles) {
        const source = copy.get(title);
        result.set(title, source === undefined ? null : { title, source });
      }
      return result;
    },
  };

  return {
    key: options.key,
    open() {
      return snapshot;
    },
  };
}

/** 校验 provider 返回的快照形状；缺失字段时报明确的不兼容错误。 */
export function assertTemplateSnapshot(value: unknown): asserts value is WikitextTemplateSnapshot {
  if (!value || typeof value !== "object") {
    invalid("The template provider must return a snapshot object.");
  }
  const candidate = value as Partial<WikitextTemplateSnapshot>;
  if (typeof candidate.key !== "string" || typeof candidate.revision !== "string") {
    invalid("The template snapshot must provide key and revision.");
  }
  if (typeof candidate.get !== "function") {
    invalid("The template snapshot must provide get().");
  }
  if (candidate.getMany !== undefined && typeof candidate.getMany !== "function") {
    invalid("The template snapshot getMany must be a function.");
  }
  if (candidate.release !== undefined && typeof candidate.release !== "function") {
    invalid("The template snapshot release must be a function.");
  }
}
