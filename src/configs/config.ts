import { WikitextParseError } from "../ast/errors";
import { MEDIAWIKI_CONFIG } from "./mediawiki";
import type { ParserConfig } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** 站点配置的深层可选覆盖；数组与元组整体替换，对象逐字段合并。 */
export type ParserConfigOverrides = DeepPartial<ParserConfig>;

type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { readonly [Key in keyof T]?: DeepPartial<T[Key]> }
    : T;

function mergeOverrides(base: unknown, overrides: unknown): unknown {
  if (!isRecord(base) || !isRecord(overrides)) {
    return overrides;
  }
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      continue;
    }
    merged[key] = isRecord(value) && isRecord(base[key]) ? mergeOverrides(base[key], value) : value;
  }
  return merged;
}

function invalid(field: string): never {
  throw new WikitextParseError(
    "INVALID_CONFIG",
    `Invalid parser config: "${field}" is missing or malformed.`,
  );
}

/**
 * 浏览器 parse 不会把 `doubleUnderscore` 的映射表展开成数组；
 * 站点配置通常只提供 `[[], [], map, map]`，需要在解析前补齐。
 */
function normalizeDoubleUnderscore(config: ParserConfig): void {
  const [insensitive, sensitive, insensitiveMap, sensitiveMap] = config.doubleUnderscore;
  if (insensitive.length === 0 && isRecord(insensitiveMap)) {
    insensitive.push(...Object.keys(insensitiveMap));
  }
  if (sensitive.length === 0 && isRecord(sensitiveMap)) {
    sensitive.push(...Object.keys(sensitiveMap));
  }
}

function validateHtml(config: ParserConfig): void {
  if (!Array.isArray(config.html) || config.html.length !== 3) {
    invalid("html");
  }
  for (const group of config.html) {
    if (!isStringArray(group)) {
      invalid("html");
    }
  }
}

function validateParserFunction(config: ParserConfig): void {
  const value = config.parserFunction as readonly unknown[];
  if (!Array.isArray(value) || value.length !== 4) {
    invalid("parserFunction");
  }
  if (!isRecord(value[0]) || !isRecord(value[1])) {
    invalid("parserFunction");
  }
  if (!isStringArray(value[2]) || !isStringArray(value[3])) {
    invalid("parserFunction");
  }
}

function validateDoubleUnderscore(config: ParserConfig): void {
  const value = config.doubleUnderscore as readonly unknown[];
  if (!Array.isArray(value) || value.length !== 4) {
    invalid("doubleUnderscore");
  }
  if (!isStringArray(value[0]) || !isStringArray(value[1])) {
    invalid("doubleUnderscore");
  }
  if (!isRecord(value[2]) || !isRecord(value[3])) {
    invalid("doubleUnderscore");
  }
}

/**
 * 校验站点配置并返回深拷贝；缺失的可选字段会在这里补齐。
 * 元组字段逐项校验，避免坏配置推迟到解析器内部才抛出原生 TypeError。
 * @param config 站点配置，默认使用内置的 MediaWiki 配置。
 */
export function normalizeConfig(config: ParserConfig = MEDIAWIKI_CONFIG): ParserConfig {
  if (!isRecord(config)) {
    invalid("config");
  }
  validateHtml(config);
  validateParserFunction(config);
  validateDoubleUnderscore(config);
  if (!isRecord(config.namespaces)) {
    invalid("namespaces");
  }
  if (!isRecord(config.nsid)) {
    invalid("nsid");
  }
  if (!isStringArray(config.ext)) {
    invalid("ext");
  }
  if (!isRecord(config.img)) {
    invalid("img");
  }

  const cloned = structuredClone(config);
  if (!Array.isArray(cloned.excludes)) {
    cloned.excludes = [];
  }
  normalizeDoubleUnderscore(cloned);
  return cloned;
}

/**
 * 以内置 MediaWiki 配置为基线，深层合并覆盖字段并返回校验过的副本。
 * 对象字段（例如 `namespaces`、`nsid`）按字段合并；数组与元组整体替换。
 * @param overrides 需要覆盖的站点配置字段。
 */
export function createMediaWikiConfig(overrides: ParserConfigOverrides = {}): ParserConfig {
  if (!isRecord(overrides)) {
    invalid("overrides");
  }
  const merged = mergeOverrides(structuredClone(MEDIAWIKI_CONFIG), overrides);
  return normalizeConfig(merged as ParserConfig);
}
