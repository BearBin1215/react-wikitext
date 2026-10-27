import { WikitextParseError } from "./errors";
import { assignSemanticIds } from "./ids";
import {
  AST_SCHEMA_VERSION,
  SYNTAX_SCHEMA_VERSION,
  isWikitextParentNode,
  type WikitextDiagnostic,
  type WikitextDocument,
  type WikitextRoot,
  type WikitextSyntaxRoot,
} from "./model";
import { buildSemanticTree } from "../normalize/build";
import { resolveParseLimits, type ResolvedParseLimits } from "./limits";
import { normalizeSource } from "./source";

/** 生效的解析选项；合并创建时默认值与单次选项后的结果。 */
export interface WikitextResolvedParseOptions extends ResolvedParseLimits {
  /** 生效的页面名。 */
  readonly pageName?: string;
  /** 是否把上游语法树放进公共快照。 */
  readonly retainSyntax: boolean;
}

/** 解析选项，可以在创建 parser 或单次解析时提供。 */
export interface WikitextParseOptions {
  /** 页面名，供解析器解析相对链接和上下文相关语法。 */
  readonly pageName?: string;
  /** 归一化后的源码上限，默认 100_000 字符。 */
  readonly maxSourceLength?: number;
  /** 源码语法树的节点数上限，默认 {@link DEFAULT_MAX_SYNTAX_NODES}。 */
  readonly maxSyntaxNodes?: number;
  /** 语义树的节点数上限，默认 {@link DEFAULT_MAX_SEMANTIC_NODES}。 */
  readonly maxSemanticNodes?: number;
  /** 树的嵌套深度上限，默认 {@link DEFAULT_MAX_DEPTH}。 */
  readonly maxDepth?: number;
  /**
   * 是否把上游 token 语法树放进公共快照，默认关闭。
   *
   * 它只影响调试用语法树是否公开：源码文本、语义节点的 `position` 与
   * `origin.range` 始终存在，查询函数也不读取语法树。
   */
  readonly retainSyntax?: boolean;
}

/** 传给适配器的有效构造预算；只包含构造源码语法树需要的上限。 */
export interface WikitextParserLimits {
  /** 源码语法树的节点数上限。 */
  readonly maxSyntaxNodes: number;
  /** 语法树的嵌套深度上限。 */
  readonly maxDepth: number;
}

/** 传给适配器的解析上下文。 */
export interface WikitextParserContext {
  /** 归一化后的源码。 */
  readonly source: string;
  /** 页面名。 */
  readonly pageName?: string;
  /** 本次解析的有效构造预算；适配器可以据此提前停止构造。 */
  readonly limits?: WikitextParserLimits;
}

/**
 * 解析器适配器：只负责把源码转换成本包定义的源码语法树。
 * 配置、页面上下文等上游选项由具体适配器处理。
 */
export interface WikitextParserAdapter {
  /** 适配器名称，会写入文档元数据。 */
  readonly name: string;
  /** 上游解析器版本。 */
  readonly version: string;
  /**
   * 把源码转换为本包定义的源码语法树。
   * @param source 归一化后的源码。
   * @param context 解析上下文。
   */
  parse(source: string, context: WikitextParserContext): WikitextSyntaxRoot;
}

/** 解析器实例：读取源码并返回解析快照。 */
export interface WikitextParser {
  /** 解析器名称。 */
  readonly name: string;
  /** 解析器版本。 */
  readonly version: string;
  /**
   * 计算本次解析实际生效的选项；不会解析源码。
   * 缓存键需要覆盖预算或 `pageName` 时，应使用这里的结果，而不是重新实现合并规则。
   * @param options 本次解析的选项，未提供的字段使用创建时的默认值。
   */
  resolveOptions(options?: WikitextParseOptions): WikitextResolvedParseOptions;
  /**
   * 解析一份源码。
   * @param source 待解析的源码，解析前会统一换行符并检查长度。
   * @param options 本次解析的选项，未提供的字段使用创建时的默认值。
   */
  parse(source: string, options?: WikitextParseOptions): WikitextDocument;
}

/** 创建解析器时的选项。 */
export interface CreateParserOptions {
  /** 每次解析都会先套用的默认选项。 */
  readonly defaults?: WikitextParseOptions;
}

function invalidRange(type: string): never {
  throw new WikitextParseError("PARSE_FAILED", `Parser returned an invalid range for ${type}.`);
}

function assertRange(
  value: unknown,
  sourceLength: number,
  type: string,
): readonly [number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !Number.isSafeInteger(value[0]) ||
    !Number.isSafeInteger(value[1]) ||
    (value[0] as number) < 0 ||
    (value[1] as number) > sourceLength ||
    (value[0] as number) > (value[1] as number)
  ) {
    return invalidRange(type);
  }
  return value as unknown as readonly [number, number];
}

function assertPosition(value: unknown, range: readonly [number, number], type: string): void {
  if (value === undefined) {
    throw new WikitextParseError("PARSE_FAILED", `Parser returned a ${type} without position.`);
  }
  if (!value || typeof value !== "object") {
    return invalidRange(type);
  }
  const position = value as { start?: { offset?: unknown }; end?: { offset?: unknown } };
  if (position.start?.offset !== range[0] || position.end?.offset !== range[1]) {
    throw new WikitextParseError(
      "PARSE_FAILED",
      `Parser returned a ${type} whose position does not match its range.`,
    );
  }
}

/**
 * 校验适配器返回的源码语法树：根节点形状、range 有限性、属性与 position 一致性、节点数与深度预算。
 */
function validateSyntaxTree(
  root: WikitextSyntaxRoot,
  source: string,
  limits: Pick<ResolvedParseLimits, "maxSyntaxNodes" | "maxDepth">,
): void {
  let count = 0;
  const visit = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object") {
      throw new WikitextParseError("PARSE_FAILED", "Parser returned an invalid syntax node.");
    }
    const candidate = node as {
      type?: unknown;
      id?: unknown;
      range?: unknown;
      position?: unknown;
      attributes?: unknown;
      children?: unknown;
    };
    if (typeof candidate.type !== "string" || typeof candidate.id !== "string") {
      throw new WikitextParseError("PARSE_FAILED", "Parser returned a syntax node without type.");
    }
    const range = assertRange(candidate.range, source.length, candidate.type);
    assertPosition(candidate.position, range, candidate.type);
    if (candidate.attributes !== undefined) {
      if (!Array.isArray(candidate.attributes)) {
        throw new WikitextParseError("PARSE_FAILED", "Parser returned invalid attributes.");
      }
      for (const attribute of candidate.attributes as unknown[]) {
        const entry = attribute as { name?: unknown; value?: unknown; range?: unknown };
        if (typeof entry?.name !== "string" || entry.value === undefined) {
          throw new WikitextParseError("PARSE_FAILED", "Parser returned an invalid attribute.");
        }
        assertRange(entry.range, source.length, `${candidate.type} attribute`);
      }
    }
    count++;
    if (count > limits.maxSyntaxNodes) {
      throw new WikitextParseError(
        "SOURCE_TOO_COMPLEX",
        `Syntax node count exceeds the limit of ${limits.maxSyntaxNodes}.`,
      );
    }
    if (depth > limits.maxDepth) {
      throw new WikitextParseError(
        "SOURCE_TOO_COMPLEX",
        `Syntax nesting depth exceeds the limit of ${limits.maxDepth}.`,
      );
    }
    if (candidate.children === undefined) {
      return;
    }
    if (!Array.isArray(candidate.children)) {
      throw new WikitextParseError("PARSE_FAILED", "Parser returned invalid child nodes.");
    }
    for (const child of candidate.children as unknown[]) {
      visit(child, depth + 1);
    }
  };
  if (!root || typeof root !== "object" || root.type !== "root") {
    throw new WikitextParseError("PARSE_FAILED", "Parser returned a non-root syntax node.");
  }
  if (!Array.isArray(root.children)) {
    throw new WikitextParseError("PARSE_FAILED", "Parser returned a root without children.");
  }
  visit(root, 0);
}

function countSemanticTree(
  root: WikitextRoot,
  limits: Pick<ResolvedParseLimits, "maxSemanticNodes" | "maxDepth">,
): void {
  let count = 0;
  const visit = (node: unknown, depth: number): void => {
    count++;
    if (count > limits.maxSemanticNodes) {
      throw new WikitextParseError(
        "SOURCE_TOO_COMPLEX",
        `Semantic node count exceeds the limit of ${limits.maxSemanticNodes}.`,
      );
    }
    if (depth > limits.maxDepth) {
      throw new WikitextParseError(
        "SOURCE_TOO_COMPLEX",
        `Semantic nesting depth exceeds the limit of ${limits.maxDepth}.`,
      );
    }
    if (node && typeof node === "object" && isWikitextParentNode(node as WikitextRoot)) {
      for (const child of (node as WikitextRoot).children) {
        visit(child, depth + 1);
      }
    }
  };
  visit(root, 0);
}

function buildAst(
  syntax: WikitextSyntaxRoot,
  source: string,
  limits: ResolvedParseLimits,
  diagnostics: WikitextDiagnostic[],
): WikitextRoot {
  try {
    const ast = buildSemanticTree(syntax, source, {
      maxDepth: limits.maxDepth,
      diagnostics,
    });
    assignSemanticIds(ast);
    countSemanticTree(ast, limits);
    return ast;
  } catch (error) {
    if (error instanceof WikitextParseError) {
      throw error;
    }
    throw new WikitextParseError("PARSE_FAILED", "Failed to build the semantic tree.", {
      cause: error,
    });
  }
}

/**
 * 用适配器创建解析器；解析器负责归一化源码、构建语义树并检查各项上限。
 * @param adapter 负责生成源码语法树的适配器。
 * @param options 创建选项，可以指定每次解析使用的默认值。
 */
export function createWikitextParser(
  adapter: WikitextParserAdapter,
  options: CreateParserOptions = {},
): WikitextParser {
  if (
    !adapter ||
    typeof adapter.parse !== "function" ||
    typeof adapter.name !== "string" ||
    typeof adapter.version !== "string"
  ) {
    throw new WikitextParseError(
      "PARSE_FAILED",
      "Parser adapter must provide name, version and parse().",
    );
  }
  const defaults = options.defaults ?? {};
  // 创建时先校验一次默认预算，避免非法配置延迟到解析阶段才以别的错误类型出现。
  resolveParseLimits(defaults);

  const resolveOptions = (
    parseOptions: WikitextParseOptions = {},
  ): WikitextResolvedParseOptions => {
    const limits = resolveParseLimits(defaults, parseOptions);
    const pageName = parseOptions.pageName ?? defaults.pageName;
    return {
      ...limits,
      ...(pageName === undefined ? {} : { pageName }),
      retainSyntax: parseOptions.retainSyntax ?? defaults.retainSyntax ?? false,
    };
  };

  return {
    name: adapter.name,
    version: adapter.version,
    resolveOptions,
    parse(source, parseOptions = {}) {
      const resolved = resolveOptions(parseOptions);
      const normalized = normalizeSource(source, resolved.maxSourceLength);
      const { pageName, retainSyntax } = resolved;

      let syntax: WikitextSyntaxRoot;
      try {
        syntax = adapter.parse(normalized.source, {
          source: normalized.source,
          ...(pageName === undefined ? {} : { pageName }),
          limits: {
            maxSyntaxNodes: resolved.maxSyntaxNodes,
            maxDepth: resolved.maxDepth,
          },
        });
      } catch (error) {
        if (error instanceof WikitextParseError) {
          throw error;
        }
        throw new WikitextParseError(
          "PARSE_FAILED",
          `${adapter.name} failed to parse the source.`,
          {
            cause: error,
          },
        );
      }
      validateSyntaxTree(syntax, normalized.source, resolved);
      const diagnostics: WikitextDiagnostic[] = [];
      const ast = buildAst(syntax, normalized.source, resolved, diagnostics);

      return {
        source: normalized.source,
        ast,
        ...(retainSyntax ? { syntax } : {}),
        meta: {
          astSchemaVersion: AST_SCHEMA_VERSION,
          ...(retainSyntax ? { syntaxSchemaVersion: SYNTAX_SCHEMA_VERSION } : {}),
          parser: adapter.name,
          parserVersion: adapter.version,
          ...(pageName === undefined ? {} : { pageName }),
          sourceNormalized: normalized.normalized,
          originalLength: normalized.originalLength,
          limits: {
            maxSourceLength: resolved.maxSourceLength,
            maxSyntaxNodes: resolved.maxSyntaxNodes,
            maxSemanticNodes: resolved.maxSemanticNodes,
            maxDepth: resolved.maxDepth,
          },
          retainSyntax,
        },
        diagnostics,
      };
    },
  };
}
