import { WikitextExpandError } from "../ast/errors";
import type { WikitextParseOptions, WikitextParser } from "../ast/parser";
import { DEFAULT_MAX_SOURCE_LENGTH } from "../ast/source";
import { getDefaultParser } from "../parse/adapter";
import type { WikitextExpandOptions, WikitextTemplateResolver } from "./types";

const DEFAULT_MAX_EXPANSION_DEPTH = 40;
const DEFAULT_MAX_INVOCATIONS = 1_000;

const PARSE_BUDGET_KEYS = [
  "maxSourceLength",
  "maxSyntaxNodes",
  "maxSemanticNodes",
  "maxDepth",
] as const;

export interface ResolvedExpandOptions {
  readonly parser: WikitextParser;
  readonly pageName?: string;
  readonly parseOptions: Omit<WikitextParseOptions, "pageName">;
  readonly sourceLimit: number;
  readonly maxExpandedLength: number;
  readonly maxDepth: number;
  readonly maxInvocations: number;
  readonly strict: boolean;
  readonly signal?: AbortSignal;
  readonly resolveTemplate: WikitextTemplateResolver;
}

function invalid(message: string): never {
  throw new WikitextExpandError("INVALID_EXPAND_OPTIONS", message);
}

function budget(value: unknown, name: string, minimum: number, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    invalid(`${name} must be an integer greater than or equal to ${minimum}.`);
  }
  return value;
}

/** 按 Map 协议识别模板表，避免跨 realm 的 `instanceof Map` 判断失败。 */
function isTemplateMap(value: unknown): value is ReadonlyMap<unknown, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as {
    get?: unknown;
    has?: unknown;
    [Symbol.iterator]?: unknown;
  };
  return (
    typeof candidate.get === "function" &&
    typeof candidate.has === "function" &&
    typeof candidate[Symbol.iterator] === "function"
  );
}

const NO_TEMPLATES: ReadonlyMap<string, string> = new Map();

/** 只接受普通对象；`Set`、`WeakMap`、字符串包装对象等一律视为非法模板表。 */
function isPlainRecord(value: object): boolean {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/** 对象模板表只读取自身可枚举的字符串键；继承属性不进入副本。 */
function templateEntries(table: unknown): Iterable<readonly [unknown, unknown]> {
  if (isTemplateMap(table)) {
    return table;
  }
  if (table === null || typeof table !== "object" || !isPlainRecord(table)) {
    invalid("templates must be a record of strings or a Map.");
  }
  return Object.entries(table);
}

/** 在解析任何源码前把模板表复制成一份只属于本次调用的 Map。 */
function copyTemplates(table: unknown): Map<string, string> {
  const copy = new Map<string, string>();
  try {
    for (const entry of templateEntries(table)) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        invalid("templates entries must be [title, source] pairs.");
      }
      const [key, value] = entry;
      if (typeof key !== "string") {
        invalid("templates keys must be strings.");
      }
      if (typeof value !== "string") {
        invalid(`templates["${key}"] must be a string.`);
      }
      copy.set(key, value);
    }
  } catch (error) {
    if (error instanceof WikitextExpandError) {
      throw error;
    }
    invalid("templates could not be read as a record or a Map.");
  }
  return copy;
}

/** 组合副本与可选回调：副本命中优先，空字符串同样命中。 */
function combineSources(
  local: ReadonlyMap<string, string>,
  remote: WikitextTemplateResolver | undefined,
): WikitextTemplateResolver {
  return (request) => local.get(request.title) ?? (remote ? remote(request) : null);
}

/** 校验并补齐展开选项；非法选项在解析任何源码前抛错。 */
export function resolveExpandOptions(options: WikitextExpandOptions = {}): ResolvedExpandOptions {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    invalid("expandWikitext requires an options object.");
  }
  if (options.resolveTemplate !== undefined && typeof options.resolveTemplate !== "function") {
    invalid("resolveTemplate must be a function.");
  }
  const templates =
    options.templates === undefined ? NO_TEMPLATES : copyTemplates(options.templates);
  const parseOptions = { ...options.parseOptions } as Omit<WikitextParseOptions, "pageName">;
  // 与解析器工厂使用同一套预算规则，保证同名选项在两处行为一致。
  for (const name of PARSE_BUDGET_KEYS) {
    const value = parseOptions[name];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      invalid(`parseOptions.${name} must be a non-negative safe integer.`);
    }
  }
  const sourceLimit = parseOptions.maxSourceLength ?? DEFAULT_MAX_SOURCE_LENGTH;
  const maxExpandedLength = budget(options.maxExpandedLength, "maxExpandedLength", 0, sourceLimit);
  const maxDepth = budget(options.maxDepth, "maxDepth", 1, DEFAULT_MAX_EXPANSION_DEPTH);
  const maxInvocations = budget(
    options.maxInvocations,
    "maxInvocations",
    0,
    DEFAULT_MAX_INVOCATIONS,
  );
  return {
    parser: options.parser ?? getDefaultParser(),
    ...(options.pageName === undefined ? {} : { pageName: options.pageName }),
    parseOptions,
    sourceLimit,
    maxExpandedLength,
    maxDepth,
    maxInvocations,
    strict: options.strict === true,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    resolveTemplate: combineSources(templates, options.resolveTemplate),
  };
}
