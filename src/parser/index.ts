import { WikitextParseError } from "../ast/errors";
import { assignSemanticIds } from "../ast/ids";
import {
  AST_SCHEMA_VERSION,
  SYNTAX_SCHEMA_VERSION,
  isWikitextParentNode,
  type WikitextDiagnostic,
  type WikitextParsedSnapshot,
  type WikitextRoot,
  type WikitextSyntaxRoot,
} from "../ast/model";
import { buildSemanticTree } from "../normalize/build";
import { resolveParseLimits, type ResolvedParseLimits } from "../ast/limits";
import { normalizeSource } from "../ast/source";
import {
  bindSegmentSources,
  createSourceGraphBuilder,
  hashText,
  inputSourceId,
  normalizeWithSegments,
  normalizedSourceId,
} from "../ast/sourceGraph/graph";

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
   * 它只影响调试用语法树是否公开：源码文本、语义节点的 `origin` 始终存在，
   * 查询函数也不读取语法树。
   */
  readonly retainSyntax?: boolean;
}

/** 语义构建选项；`diagnostics` 由调用方提供可写数组以便收集归一化诊断。 */
export interface WikitextBuildOptions extends WikitextParseOptions {
  /** 归一化阶段诊断的接收数组；省略时丢弃。 */
  readonly diagnostics?: WikitextDiagnostic[];
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
  /** 适配器名称，会写入快照元数据。 */
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

/** 编译选项：只影响源码语法编译，不构建语义树。 */
export interface WikitextCompileOptions {
  readonly pageName?: string;
  readonly maxSourceLength?: number;
  readonly maxSyntaxNodes?: number;
  readonly maxDepth?: number;
  /** 语义 origin 使用的文本源身份；缺省时使用归一化源身份。 */
  readonly sourceId?: string;
  /** 逻辑键；只有缺省 sourceId 时用于生成身份。 */
  readonly key?: string;
  /** 内容版本；只有缺省 sourceId 时用于生成身份。 */
  readonly revision?: string;
}

/** 一次源码语法编译的产物；同一程序可以多次构建语义树。 */
export interface WikitextSyntaxProgram {
  /** LF 归一化后的源码。 */
  readonly source: string;
  readonly syntax: WikitextSyntaxRoot;
  /** 语义 origin 应引用的文本源。 */
  readonly sourceId: string;
  /** 生效的解析预算；缓存键与重新校验都读取它。 */
  readonly limits: ResolvedParseLimits;
}

/**
 * 解析器实例：源码语法编译与语义构建分开提供，`parse` 是一次性便利入口。
 *
 * 分离的原因：模板只需要调用结构，最终展开文本才需要完整语义树；
 * 缓存也按语法程序失效，避免每次展开重复解析。
 */
export interface WikitextParser {
  /** 解析器名称。 */
  readonly name: string;
  /** 解析器版本。 */
  readonly version: string;
  /** 稳定的解析器身份；缓存键必须包含它。 */
  readonly key: string;
  /**
   * 计算本次解析实际生效的选项；不会解析源码。
   * @param options 本次解析的选项，未提供的字段使用创建时的默认值。
   */
  resolveOptions(options?: WikitextParseOptions): WikitextResolvedParseOptions;
  /**
   * 只编译源码语法树，不构建语义树。
   * @param source 待编译的源码，编译前会统一换行符并检查长度。
   * @param options 本次编译的选项。
   */
  compile(source: string, options?: WikitextCompileOptions): WikitextSyntaxProgram;
  /**
   * 在已编译的语法树上构建语义树。
   * @param program 语法程序。
   * @param options 本次构建的选项；预算变化会重新检查。
   */
  build(program: WikitextSyntaxProgram, options?: WikitextBuildOptions): WikitextRoot;
  /**
   * 一次性解析：编译语法并构建语义树，返回带最小来源图的快照。
   * @param source 待解析的源码。
   * @param options 本次解析的选项。
   */
  parse(source: string, options?: WikitextParseOptions): WikitextParsedSnapshot;
}

/** 创建解析器时的选项。 */
export interface CreateParserOptions {
  /** 每次解析都会先套用的默认选项。 */
  readonly defaults?: WikitextParseOptions;
  /** 稳定的解析器身份；缺省时由适配器名称与版本组成。 */
  readonly key?: string;
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
  sourceId: string,
  limits: ResolvedParseLimits,
  diagnostics: WikitextDiagnostic[],
): WikitextRoot {
  try {
    const ast = buildSemanticTree(syntax, source, {
      maxDepth: limits.maxDepth,
      diagnostics,
      sourceId,
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
 * 用适配器创建解析器；解析器负责归一化源码、编译语法树、构建语义树并检查各项上限。
 * @param adapter 负责生成源码语法树的适配器。
 * @param options 创建选项，可以指定每次解析使用的默认值与缓存身份。
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
  const key = options.key ?? `${adapter.name}@${adapter.version}`;

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

  /** 在已归一化源码上编译语法树；`parse` 与 `compile` 共用同一条实现。 */
  const compileNormalized = (
    source: string,
    pageName: string | undefined,
    limits: ResolvedParseLimits,
  ): WikitextSyntaxRoot => {
    let syntax: WikitextSyntaxRoot;
    try {
      syntax = adapter.parse(source, {
        source,
        ...(pageName === undefined ? {} : { pageName }),
        limits: {
          maxSyntaxNodes: limits.maxSyntaxNodes,
          maxDepth: limits.maxDepth,
        },
      });
    } catch (error) {
      if (error instanceof WikitextParseError) {
        throw error;
      }
      throw new WikitextParseError("PARSE_FAILED", `${adapter.name} failed to parse the source.`, {
        cause: error,
      });
    }
    validateSyntaxTree(syntax, source, limits);
    return syntax;
  };

  const compile = (
    source: string,
    compileOptions: WikitextCompileOptions = {},
  ): WikitextSyntaxProgram => {
    const limits = resolveParseLimits(defaults, {
      ...(compileOptions.maxSourceLength === undefined
        ? {}
        : { maxSourceLength: compileOptions.maxSourceLength }),
      ...(compileOptions.maxSyntaxNodes === undefined
        ? {}
        : { maxSyntaxNodes: compileOptions.maxSyntaxNodes }),
      ...(compileOptions.maxDepth === undefined ? {} : { maxDepth: compileOptions.maxDepth }),
    });
    const pageName = compileOptions.pageName ?? defaults.pageName;
    const normalized = normalizeSource(source, limits.maxSourceLength);
    const sourceId =
      compileOptions.sourceId ??
      normalizedSourceId(
        compileOptions.key ?? pageName ?? "page",
        compileOptions.revision ?? hashText(source),
      );
    const syntax = compileNormalized(normalized.source, pageName, limits);
    return { source: normalized.source, syntax, sourceId, limits };
  };

  const build = (
    program: WikitextSyntaxProgram,
    buildOptions: WikitextBuildOptions = {},
  ): WikitextRoot => {
    const limits = resolveParseLimits(defaults, buildOptions);
    if (program.source.length > limits.maxSourceLength) {
      throw new WikitextParseError(
        "SOURCE_TOO_LONG",
        `Source length ${program.source.length} exceeds the limit of ${limits.maxSourceLength}.`,
      );
    }
    // 低预算不能绕过检查：缓存程序也要按本次生效预算重新校验。
    if (
      limits.maxSyntaxNodes < program.limits.maxSyntaxNodes ||
      limits.maxDepth < program.limits.maxDepth
    ) {
      validateSyntaxTree(program.syntax, program.source, limits);
    }
    const diagnostics = buildOptions.diagnostics ?? [];
    return buildAst(program.syntax, program.source, program.sourceId, limits, diagnostics);
  };

  return {
    name: adapter.name,
    version: adapter.version,
    key,
    resolveOptions,
    compile,
    build,
    parse(source, parseOptions = {}) {
      const resolved = resolveOptions(parseOptions);
      // `limits` 只保存四个预算字段；页面名与 retainSyntax 属于解析选项。
      const limits = resolveParseLimits(resolved);
      const normalized = normalizeSource(source, limits.maxSourceLength);
      const pageName = resolved.pageName;
      const pageKey = pageName ?? "page";
      const revision = hashText(source);
      const inputId = inputSourceId(pageKey, revision);
      const normalizedId = normalizedSourceId(pageKey, revision);

      const builder = createSourceGraphBuilder();
      builder.addSource({
        id: inputId,
        key: pageKey,
        revision,
        role: "input",
        text: source,
        ...(pageName === undefined ? {} : { title: pageName }),
      });
      builder.addSource({
        id: normalizedId,
        key: pageKey,
        revision,
        role: "normalized",
        text: normalized.source,
        ...(pageName === undefined ? {} : { title: pageName }),
      });
      for (const segment of bindSegmentSources(
        normalizeWithSegments(source).segments,
        inputId,
        normalizedId,
      )) {
        builder.addSegment(segment);
      }

      const syntax = compileNormalized(normalized.source, pageName, limits);
      const program: WikitextSyntaxProgram = {
        source: normalized.source,
        syntax,
        sourceId: normalizedId,
        limits,
      };
      const diagnostics: WikitextDiagnostic[] = [];
      const ast = buildAst(program.syntax, program.source, normalizedId, limits, diagnostics);

      return {
        kind: "parsed",
        id: normalizedId,
        activeSourceId: normalizedId,
        graph: builder.finalize(),
        source: normalized.source,
        ast,
        ...(resolved.retainSyntax ? { syntax: program.syntax } : {}),
        meta: {
          astSchemaVersion: AST_SCHEMA_VERSION,
          ...(resolved.retainSyntax ? { syntaxSchemaVersion: SYNTAX_SCHEMA_VERSION } : {}),
          parser: adapter.name,
          parserVersion: adapter.version,
          ...(pageName === undefined ? {} : { pageName }),
          sourceNormalized: normalized.normalized,
          originalLength: normalized.originalLength,
          limits,
          retainSyntax: resolved.retainSyntax,
        },
        diagnostics,
      };
    },
  };
}
