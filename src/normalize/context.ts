import type {
  WikitextDiagnostic,
  WikitextNode,
  WikitextOrigin,
  WikitextRange,
  WikitextSyntaxNode,
} from "../ast/model";
import { DEFAULT_MAX_DEPTH } from "../ast/limits";
import { createPositionIndex, type PositionIndex } from "../ast/position";
import type { WikitextSourceId } from "../ast/sourceGraph/types";

/** 把一段源码语法节点归一化为块级语义节点；用于 inline 容器内的块级回落。 */
export type NormalizeBlockBuilder = (
  nodes: readonly WikitextSyntaxNode[],
  limit: number,
  depth: number,
) => WikitextNode[];

/** 归一化上下文；源码行索引、块级深度预算与诊断收集都在这里统一提供。 */
export interface NormalizeContext {
  readonly source: string;
  /** 语义 origin 引用的文本源；归一化阶段写入每个节点的 `origin`。 */
  readonly sourceId: WikitextSourceId;
  /** 源码行索引，供列表/块级行扫描共用。 */
  readonly positions: PositionIndex;
  /** 块级嵌套深度预算；超过时抛 `SOURCE_TOO_COMPLEX`，不再静默截断。 */
  readonly maxDepth: number;
  /** 归一化阶段产生的诊断；由解析器工厂收集进快照。 */
  readonly diagnostics: WikitextDiagnostic[];
  /** 把当前容器内的源码节点按块级规则归一化。 */
  readonly buildBlocks: NormalizeBlockBuilder;
}

/** 创建归一化上下文的选项。 */
export interface CreateNormalizeContextOptions {
  /** 块级嵌套深度预算，默认 {@link DEFAULT_MAX_DEPTH}。 */
  readonly maxDepth?: number;
  /** 归一化阶段收集诊断的可写数组。 */
  readonly diagnostics?: WikitextDiagnostic[];
  /** 块级回落回调；缺省时 inline 容器遇到块级内容会继续降级为源码卡片。 */
  readonly buildBlocks?: NormalizeBlockBuilder;
  /** 语义 origin 引用的文本源。 */
  readonly sourceId?: WikitextSourceId;
}

function unavailableBlockBuilder(
  nodes: readonly WikitextSyntaxNode[],
  _limit: number,
  _depth: number,
): WikitextNode[] {
  void nodes;
  return [];
}

export function createNormalizeContext(
  source: string,
  options: CreateNormalizeContextOptions = {},
): NormalizeContext {
  return {
    source,
    sourceId: options.sourceId ?? "normalized:anonymous@local",
    positions: createPositionIndex(source),
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    diagnostics: options.diagnostics ?? [],
    buildBlocks: options.buildBlocks ?? unavailableBlockBuilder,
  };
}

interface NodeLocation {
  /** parser 内部的偏移区间；会转换成带来源身份的范围。 */
  readonly range?: WikitextRange;
  readonly syntax?: WikitextSyntaxNode;
  /** 显式来源：可以使用带身份的 span，也可以只给区间（已经由调用方确定文本源）。 */
  readonly origin?: WikitextOrigin | { readonly syntaxId?: string; readonly range: WikitextRange };
}

function offsetOrigin(
  context: NormalizeContext,
  range: WikitextRange,
  syntaxId?: string,
): WikitextOrigin {
  return {
    sourceId: context.sourceId,
    start: range[0],
    end: range[1],
    ...(syntaxId === undefined ? {} : { syntaxId }),
  };
}

/** 按语法节点、显式 origin 或区间生成来源；三者都没有时返回空对象。 */
export function nodeLocation(
  context: NormalizeContext,
  loc: NodeLocation,
): Pick<WikitextNode, "origin"> {
  const explicit = loc.origin;
  if (explicit) {
    return {
      origin:
        "start" in explicit
          ? { ...explicit }
          : offsetOrigin(context, explicit.range, explicit.syntaxId),
    };
  }
  if (loc.syntax) {
    return { origin: offsetOrigin(context, loc.syntax.range, loc.syntax.id) };
  }
  if (loc.range) {
    return { origin: offsetOrigin(context, loc.range) };
  }
  return {};
}
