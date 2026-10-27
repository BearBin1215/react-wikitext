import { WikitextParseError } from "./errors";
import { DEFAULT_MAX_SOURCE_LENGTH } from "./source";

/** 默认源码语法树的节点数上限。 */
export const DEFAULT_MAX_SYNTAX_NODES = 50_000;
/** 默认语义树的节点数上限。 */
export const DEFAULT_MAX_SEMANTIC_NODES = 50_000;
/** 语法树与语义树的默认嵌套深度上限。 */
export const DEFAULT_MAX_DEPTH = 1_000;

/** 解析预算字段；解析器与展开阶段共用同一份校验规则。 */
export interface ParseLimitOptions {
  /** 归一化后的源码上限。 */
  readonly maxSourceLength?: number;
  /** 源码语法树的节点数上限。 */
  readonly maxSyntaxNodes?: number;
  /** 语义树的节点数上限。 */
  readonly maxSemanticNodes?: number;
  /** 语法与语义树的嵌套深度上限。 */
  readonly maxDepth?: number;
}

/** 合并后生效的解析预算。 */
export interface ResolvedParseLimits {
  readonly maxSourceLength: number;
  readonly maxSyntaxNodes: number;
  readonly maxSemanticNodes: number;
  readonly maxDepth: number;
}

function readLimit(value: number | undefined, name: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new WikitextParseError(
      "INVALID_CONFIG",
      `Parse option "${name}" must be a positive safe integer.`,
    );
  }
  return value;
}

/** 判断一个值是否是完整、可用的生效预算；用于恢复序列化快照。 */
export function isResolvedParseLimits(value: unknown): value is ResolvedParseLimits {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ResolvedParseLimits>;
  return (
    Number.isSafeInteger(candidate.maxSourceLength) &&
    (candidate.maxSourceLength as number) >= 1 &&
    Number.isSafeInteger(candidate.maxSyntaxNodes) &&
    (candidate.maxSyntaxNodes as number) >= 1 &&
    Number.isSafeInteger(candidate.maxSemanticNodes) &&
    (candidate.maxSemanticNodes as number) >= 1 &&
    Number.isSafeInteger(candidate.maxDepth) &&
    (candidate.maxDepth as number) >= 1
  );
}

/**
 * 按“后者覆盖前者”的层级合并并校验解析预算。
 * 非法值（NaN、Infinity、小数、0、负数）统一抛 `INVALID_CONFIG`，避免比较运算静默失效。
 * 预算必须为正整数：`0` 会让任何非空源码或任何节点树立即失败，不视为有效配置。
 */
export function resolveParseLimits(...layers: readonly ParseLimitOptions[]): ResolvedParseLimits {
  let maxSourceLength: number = DEFAULT_MAX_SOURCE_LENGTH;
  let maxSyntaxNodes: number = DEFAULT_MAX_SYNTAX_NODES;
  let maxSemanticNodes: number = DEFAULT_MAX_SEMANTIC_NODES;
  let maxDepth: number = DEFAULT_MAX_DEPTH;
  for (const layer of layers) {
    maxSourceLength = readLimit(layer.maxSourceLength, "maxSourceLength", maxSourceLength);
    maxSyntaxNodes = readLimit(layer.maxSyntaxNodes, "maxSyntaxNodes", maxSyntaxNodes);
    maxSemanticNodes = readLimit(layer.maxSemanticNodes, "maxSemanticNodes", maxSemanticNodes);
    maxDepth = readLimit(layer.maxDepth, "maxDepth", maxDepth);
  }
  return { maxSourceLength, maxSyntaxNodes, maxSemanticNodes, maxDepth };
}

/** 准备阶段校验插件工作树的语义节点固定预算。 */
export const PREPARE_MAX_SEMANTIC_NODES = DEFAULT_MAX_SEMANTIC_NODES;
/** 准备阶段校验插件工作树的嵌套深度固定预算。 */
export const PREPARE_MAX_DEPTH = DEFAULT_MAX_DEPTH;
/** 渲染快照（prepare 产物与 restore 输入）共用的 HAST 节点固定预算。 */
export const RENDER_MAX_HAST_NODES = DEFAULT_MAX_SEMANTIC_NODES;
/** 渲染快照（prepare 产物与 restore 输入）共用的 HAST 嵌套深度固定预算。 */
export const RENDER_MAX_HAST_DEPTH = DEFAULT_MAX_DEPTH;
