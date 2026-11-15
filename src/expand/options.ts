import { WikitextExpandError } from "../ast/errors";
import type { ResolvedParseLimits } from "../ast/limits";
import type { WikitextSyntaxProgram } from "../parser";
import type { WikitextCompileBudget } from "./types";

const DEFAULT_MAX_DEPTH = 40;
const DEFAULT_MAX_INVOCATIONS = 1_000;
const DEFAULT_MAX_TEMPLATES = 5_000;

/** 一次编译生效的预算；已按解析上限收敛。 */
interface ResolvedBudgets {
  readonly maxDepth: number;
  readonly maxInvocations: number;
  readonly maxExpandedLength: number;
  readonly maxTemplates: number;
}

/** 以展开选项错误结束。 */
export function invalid(message: string): never {
  throw new WikitextExpandError("INVALID_EXPAND_OPTIONS", message);
}

/**
 * 读取正安全整数选项。
 * @param value 调用方传入的值。
 * @param name 选项名，用于错误消息。
 * @param fallback 省略时的默认值。
 */
export function positive(value: unknown, name: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    invalid(`${name} must be a positive safe integer.`);
  }
  return value;
}

/**
 * 读取非负安全整数选项。
 * @param value 调用方传入的值。
 * @param name 选项名，用于错误消息。
 * @param fallback 省略时的默认值。
 */
function nonNegative(value: unknown, name: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid(`${name} must be a non-negative safe integer.`);
  }
  return value;
}

/** 解析预算的缓存键；同一组预算可以复用页面语法程序。 */
export function limitsKey(limits: ResolvedParseLimits): string {
  return `${limits.maxSourceLength}:${limits.maxSyntaxNodes}:${limits.maxSemanticNodes}:${limits.maxDepth}`;
}

/**
 * 合并调用方预算与解析上限。
 * @param limits 已解析的解析预算。
 * @param budget 单次编译预算。
 */
export function resolveBudgets(
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

/**
 * 校验 parser 返回的语法程序；缺失或畸形时报明确的不兼容错误。
 * @param program parser 编译结果。
 */
export function assertSyntaxProgram(program: WikitextSyntaxProgram): void {
  const syntax = program.syntax as { type?: unknown; children?: unknown } | undefined;
  if (!syntax || syntax.type !== "root" || !Array.isArray(syntax.children)) {
    throw new WikitextExpandError(
      "INCOMPATIBLE_PARSER",
      "The parser must return a syntax tree for template expansion.",
    );
  }
}

/**
 * 计算 `kept` 片段之间的删除区间。
 * @param kept 按起点排序的保留区间。
 * @param length 源码长度。
 */
export function deletedRanges(
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
