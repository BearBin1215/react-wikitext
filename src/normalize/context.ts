import type {
  WikitextDiagnostic,
  WikitextNode,
  WikitextOrigin,
  WikitextPosition,
  WikitextRange,
  WikitextSyntaxNode,
} from "../ast/model";
import { DEFAULT_MAX_DEPTH } from "../ast/limits";
import { createPositionIndex, type PositionIndex } from "../ast/position";

/** 把一段源码语法节点归一化为块级语义节点；用于 inline 容器内的块级回落。 */
export type NormalizeBlockBuilder = (
  nodes: readonly WikitextSyntaxNode[],
  limit: number,
  depth: number,
) => WikitextNode[];

/** 归一化上下文；源码行索引、块级深度预算与诊断收集都在这里统一提供。 */
export interface NormalizeContext {
  readonly source: string;
  /** 源码行索引，供位置换算与列表/块级行扫描共用。 */
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
    positions: createPositionIndex(source),
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    diagnostics: options.diagnostics ?? [],
    buildBlocks: options.buildBlocks ?? unavailableBlockBuilder,
  };
}

function originOf(node: WikitextSyntaxNode): WikitextOrigin {
  return { syntaxId: node.id, range: node.range };
}

function positionOf(context: NormalizeContext, range: WikitextRange): WikitextPosition {
  return context.positions.position(range);
}

interface NodeLocation {
  readonly range?: WikitextRange;
  readonly syntax?: WikitextSyntaxNode;
  readonly origin?: WikitextOrigin;
}

/** 按语法节点、显式 origin 或区间生成位置；三者都没有时返回空对象。 */
export function nodeLocation(
  context: NormalizeContext,
  loc: NodeLocation,
): Pick<WikitextNode, "position" | "origin"> {
  const origin = loc.origin ?? (loc.syntax ? originOf(loc.syntax) : undefined);
  const range = loc.range ?? origin?.range;
  const position = range ? positionOf(context, range) : undefined;
  return {
    ...(position === undefined ? {} : { position }),
    ...(origin === undefined ? {} : { origin }),
  };
}
