import { WikitextError } from "../errors";
import { isSpanWithin } from "./span";
import {
  isWikitextParentNode,
  type WikitextNode,
  type WikitextParsedSnapshot,
  type WikitextRenderSnapshot,
} from "../model";
import type {
  WikitextMapOptions,
  WikitextMappingCoverage,
  WikitextMappingMatch,
  WikitextMappingPrecision,
  WikitextMappingResult,
  WikitextSourceGraph,
  WikitextSourceId,
  WikitextSourcePosition,
  WikitextSourceSpan,
  WikitextTextSource,
} from "./types";

/** 单次映射最多展开的中间跳数；超过视为无法映射。 */
const MAX_MAPPING_HOPS = 16;
/** 默认返回的匹配数量上限。 */
const DEFAULT_MATCH_LIMIT = 64;
/** 默认返回的渲染节点数量上限。 */
const DEFAULT_NODE_LIMIT = 128;

interface SourceIndex {
  readonly sources: ReadonlyMap<WikitextSourceId, WikitextTextSource>;
  readonly segments: ReadonlyMap<WikitextSourceId, readonly number[]>;
  readonly lines: Map<WikitextSourceId, readonly number[]>;
  readonly all: readonly WikitextTextSource[];
}

const indexCache = new WeakMap<WikitextSourceGraph, SourceIndex>();

function buildIndex(graph: WikitextSourceGraph): SourceIndex {
  const sources = new Map<WikitextSourceId, WikitextTextSource>();
  for (const source of graph.sources) {
    sources.set(source.id, source);
  }
  const segments = new Map<WikitextSourceId, number[]>();
  const add = (id: WikitextSourceId, position: number): void => {
    const list = segments.get(id);
    if (list) {
      list.push(position);
    } else {
      segments.set(id, [position]);
    }
  };
  for (const [position, segment] of graph.segments.entries()) {
    if (segment.from) {
      add(segment.from.sourceId, position);
    }
    if (segment.to) {
      add(segment.to.sourceId, position);
    }
  }
  return { sources, segments, lines: new Map(), all: graph.sources };
}

function indexOf(graph: WikitextSourceGraph): SourceIndex {
  const cached = indexCache.get(graph);
  if (cached) {
    return cached;
  }
  const built = buildIndex(graph);
  indexCache.set(graph, built);
  return built;
}

function lineStarts(index: SourceIndex, source: WikitextTextSource): readonly number[] {
  const cached = index.lines.get(source.id);
  if (cached) {
    return cached;
  }
  const starts: number[] = [0];
  for (let offset = 0; offset < source.text.length; offset++) {
    if (source.text[offset] === "\n") {
      starts.push(offset + 1);
    }
  }
  index.lines.set(source.id, starts);
  return starts;
}

function lineAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle]! <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

/** 读取文本源；未知 id 返回 undefined。 */
export function findSource(
  graph: WikitextSourceGraph,
  id: WikitextSourceId,
): WikitextTextSource | undefined {
  return indexOf(graph).sources.get(id);
}

/** 按角色读取第一个文本源。 */
export function findSourceByRole(
  graph: WikitextSourceGraph,
  role: WikitextTextSource["role"],
): WikitextTextSource | undefined {
  return indexOf(graph).all.find((source) => source.role === role);
}

function assertSpan(index: SourceIndex, span: WikitextSourceSpan): WikitextTextSource {
  const source = index.sources.get(span.sourceId);
  if (!source) {
    throw new WikitextError("INVALID_DOCUMENT", `Unknown source "${span.sourceId}".`);
  }
  if (!isSpanWithin(span, source.text.length)) {
    throw new WikitextError(
      "INVALID_DOCUMENT",
      `Span ${span.start}-${span.end} is outside source "${span.sourceId}".`,
    );
  }
  return source;
}

/**
 * 计算范围在所属文本源中的行列坐标。
 * @param graph 来源图。
 * @param span 目标范围。
 */
export function getSourcePosition(
  graph: WikitextSourceGraph,
  span: WikitextSourceSpan,
): WikitextSourcePosition {
  const index = indexOf(graph);
  const source = assertSpan(index, span);
  const starts = lineStarts(index, source);
  const point = (offset: number) => {
    const line = lineAt(starts, offset);
    return { line: line + 1, column: offset - starts[line]! + 1, offset };
  };
  return { start: point(span.start), end: point(span.end) };
}

/** 读取范围内的源码文本；范围非法时返回空字符串。 */
export function getSpanText(graph: WikitextSourceGraph, span: WikitextSourceSpan): string {
  const source = findSource(graph, span.sourceId);
  if (!source) {
    return "";
  }
  if (span.start < 0 || span.end > source.text.length || span.end < span.start) {
    return "";
  }
  return source.text.slice(span.start, span.end);
}

function intersect(
  span: WikitextSourceSpan,
  other: WikitextSourceSpan,
): WikitextSourceSpan | undefined {
  if (span.sourceId !== other.sourceId) {
    return undefined;
  }
  const start = Math.max(span.start, other.start);
  const end = Math.min(span.end, other.end);
  if (end < start) {
    return undefined;
  }
  if (end === start && !(span.start === span.end && other.start === other.end)) {
    return undefined;
  }
  return { sourceId: span.sourceId, start, end };
}

function mapAcross(
  current: WikitextSourceSpan,
  from: WikitextSourceSpan,
  to: WikitextSourceSpan,
): WikitextSourceSpan | undefined {
  const overlap = intersect(current, from);
  if (!overlap) {
    return undefined;
  }
  const fromLength = from.end - from.start;
  const toLength = to.end - to.start;
  if (fromLength === toLength) {
    return {
      sourceId: to.sourceId,
      start: to.start + (overlap.start - from.start),
      end: to.start + (overlap.end - from.start),
    };
  }
  // 长度不同（CRLF 折叠、生成内容）时只能按整个片段对应，不做比例插值。
  return { ...to };
}

interface Frontier {
  readonly span: WikitextSourceSpan;
  readonly precision: WikitextMappingPrecision;
  readonly hops: number;
  /** 已经对应到的原始输入片段；用于计算覆盖率。 */
  readonly origin?: WikitextSourceSpan;
  readonly invocationId?: string;
  readonly occurrenceId?: string;
}

interface Candidate {
  readonly span: WikitextSourceSpan;
  /** 本次跨越的片段在输入源中的重叠范围。 */
  readonly overlap: WikitextSourceSpan;
}

/**
 * 把范围投影到目标文本源。
 *
 * 只在可证明的边界对应上返回 `exact`；经过长度变化或函数转换的关系返回
 * `enclosing-invocation`。多段结果按源码顺序返回，重复出现位置全部保留。
 * @param graph 来源图。
 * @param span 输入范围。
 * @param options 目标源、结果上限与是否允许粗粒度片段。
 */
export function mapSourceSpan(
  graph: WikitextSourceGraph,
  span: WikitextSourceSpan,
  options: WikitextMapOptions = {},
): WikitextMappingResult {
  const index = indexOf(graph);
  assertSpan(index, span);
  const target = options.targetSourceId ?? findSourceByRole(graph, "input")?.id ?? span.sourceId;
  if (!index.sources.has(target)) {
    throw new Error(`Unknown target source "${target}".`);
  }
  const limit = options.limit ?? DEFAULT_MATCH_LIMIT;
  const includeCoarse = options.includeCoarse ?? true;
  if (span.sourceId === target) {
    return {
      matches: [
        {
          from: span,
          to: span,
          precision: "exact",
        },
      ],
      unmapped: [],
      coverage: "complete",
      truncated: false,
    };
  }

  const matches: WikitextMappingMatch[] = [];
  const seen = new Set<string>();
  let truncated = false;
  let frontier: Frontier[] = [{ span, precision: "exact", hops: 0 }];
  const visited = new Set<string>([`${span.sourceId}:${span.start}:${span.end}`]);
  let found = false;

  for (let hop = 0; hop < MAX_MAPPING_HOPS && frontier.length > 0; hop++) {
    const next: Frontier[] = [];
    for (const item of frontier) {
      const positions = index.segments.get(item.span.sourceId) ?? [];
      for (const position of positions) {
        const segment = graph.segments[position]!;
        if (!includeCoarse && segment.precision !== "exact") {
          continue;
        }
        // 多阶段组合不得提升精度：任一跳不是精确片段，结果都是粗粒度关联。
        const precision: WikitextMappingPrecision =
          segment.precision === "exact" ? item.precision : "enclosing-invocation";
        const candidates: Candidate[] = [];
        // 纯删除片段没有输出范围，纯生成片段没有输入范围，都不产生对应关系。
        if (segment.from && segment.to) {
          const forwardOverlap = intersect(item.span, segment.from);
          const mapped =
            forwardOverlap === undefined
              ? undefined
              : mapAcross(item.span, segment.from, segment.to);
          if (mapped && forwardOverlap) {
            candidates.push({ span: mapped, overlap: forwardOverlap });
          }
          const backwardOverlap = intersect(item.span, segment.to);
          const back =
            backwardOverlap === undefined
              ? undefined
              : mapAcross(item.span, segment.to, segment.from);
          if (back && backwardOverlap) {
            candidates.push({ span: back, overlap: backwardOverlap });
          }
        }
        for (const candidate of candidates) {
          const invocationId = segment.invocationId ?? item.invocationId;
          const occurrenceId = segment.occurrenceId ?? item.occurrenceId;
          // 第一跳的重叠部分属于输入源；后续跳沿用已经对应到的原始片段。
          const origin = item.origin ?? candidate.overlap;
          if (candidate.span.sourceId === target) {
            const key = `${candidate.span.start}:${candidate.span.end}:${precision}:${invocationId ?? ""}:${occurrenceId ?? ""}`;
            if (!seen.has(key)) {
              if (matches.length >= limit) {
                truncated = true;
                continue;
              }
              seen.add(key);
              matches.push({
                from: origin,
                to: candidate.span,
                precision,
                ...(invocationId === undefined ? {} : { invocationId }),
                ...(occurrenceId === undefined ? {} : { occurrenceId }),
              });
              found = true;
            }
            continue;
          }
          const visitKey = `${candidate.span.sourceId}:${candidate.span.start}:${candidate.span.end}:${precision}`;
          if (visited.has(visitKey)) {
            continue;
          }
          visited.add(visitKey);
          next.push({
            span: candidate.span,
            precision,
            hops: hop + 1,
            origin,
            ...(invocationId === undefined ? {} : { invocationId }),
            ...(occurrenceId === undefined ? {} : { occurrenceId }),
          });
        }
      }
    }
    if (found) {
      break;
    }
    frontier = next;
  }

  // 可证明的精确对应优先于粗粒度关联：同一层既有精确结果时丢弃联动结果。
  const preferred = matches.some((match) => match.precision === "exact")
    ? matches.filter((match) => match.precision === "exact")
    : matches;
  // oxlint-disable-next-line unicorn/no-array-sort -- 产物 target 为 ES2022。
  const ordered = [...preferred].sort((left, right) => left.to.start - right.to.start);
  const unmapped = subtract(
    span,
    ordered.map((match) => match.from),
  );
  const coverage: WikitextMappingCoverage =
    ordered.length === 0 ? "none" : unmapped.length === 0 ? "complete" : "partial";
  return { matches: ordered, unmapped, coverage, truncated };
}

/** 用已知目标范围从原范围中减去，得到未映射部分。 */
function subtract(
  span: WikitextSourceSpan,
  covered: readonly WikitextSourceSpan[],
): WikitextSourceSpan[] {
  const ranges = covered
    .filter((item) => item.sourceId === span.sourceId)
    .map((item) => [Math.max(span.start, item.start), Math.min(span.end, item.end)] as const)
    .filter(([start, end]) => end > start)
    // oxlint-disable-next-line unicorn/no-array-sort -- 产物 target 为 ES2022。
    .sort((left, right) => left[0] - right[0]);
  const merged: Array<readonly [number, number]> = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1]) {
      if (range[1] > previous[1]) {
        merged[merged.length - 1] = [previous[0], range[1]];
      }
    } else {
      merged.push(range);
    }
  }
  const result: WikitextSourceSpan[] = [];
  let cursor = span.start;
  for (const [start, end] of merged) {
    if (start > cursor) {
      result.push({ sourceId: span.sourceId, start: cursor, end: start });
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < span.end) {
    result.push({ sourceId: span.sourceId, start: cursor, end: span.end });
  }
  return result;
}

/** 渲染节点的定位结果。 */
export interface WikitextNodeLocation {
  readonly nodeId: string;
  readonly span: WikitextSourceSpan;
  readonly precision: WikitextMappingPrecision;
}

/** 快照中的语义节点索引；按 ast 根缓存。 */
const nodeIndexCache = new WeakMap<object, ReadonlyMap<string, WikitextNode>>();

function nodeIndex(root: WikitextNode): ReadonlyMap<string, WikitextNode> {
  const cached = nodeIndexCache.get(root);
  if (cached) {
    return cached;
  }
  const index = new Map<string, WikitextNode>();
  const visit = (node: WikitextNode): void => {
    index.set(node.id, node);
    if (isWikitextParentNode(node)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  visit(root);
  nodeIndexCache.set(root, index);
  return index;
}

/**
 * 把渲染节点定位到目标文本源。
 *
 * 语义节点没有来源时返回空结果；生成节点不伪造精确范围。
 * @param snapshot 解析或渲染快照。
 * @param nodeId 快照内的语义节点 id。
 * @param options 目标源与结果上限。
 */
export function locateRenderedNode(
  snapshot: WikitextParsedSnapshot | WikitextRenderSnapshot,
  nodeId: string,
  options: WikitextMapOptions = {},
): WikitextMappingResult {
  const node = nodeIndex(snapshot.ast).get(nodeId);
  const origin = node?.origin;
  if (!origin) {
    return { matches: [], unmapped: [], coverage: "none", truncated: false };
  }
  return mapSourceSpan(
    snapshot.graph,
    { sourceId: origin.sourceId, start: origin.start, end: origin.end },
    options,
  );
}

/**
 * 查找渲染结果中与目标源码范围相交的语义节点。
 *
 * 结果按源码顺序排列；达到上限时返回 `truncated`，不把未返回的节点当作不存在。
 * @param snapshot 解析或渲染快照。
 * @param span 目标源码范围。
 * @param options 结果上限与是否允许粗粒度匹配。
 */
export function findRenderedNodes(
  snapshot: WikitextParsedSnapshot | WikitextRenderSnapshot,
  span: WikitextSourceSpan,
  options: { readonly limit?: number; readonly includeCoarse?: boolean } = {},
): { readonly nodes: readonly WikitextNodeLocation[]; readonly truncated: boolean } {
  const limit = options.limit ?? DEFAULT_NODE_LIMIT;
  const includeCoarse = options.includeCoarse ?? true;
  const nodes: WikitextNodeLocation[] = [];
  let truncated = false;
  for (const node of nodeIndex(snapshot.ast).values()) {
    const origin = node.origin;
    if (!origin) {
      continue;
    }
    const result = mapSourceSpan(
      snapshot.graph,
      { sourceId: origin.sourceId, start: origin.start, end: origin.end },
      { targetSourceId: span.sourceId, limit: 8 },
    );
    for (const match of result.matches) {
      if (!includeCoarse && match.precision !== "exact") {
        continue;
      }
      if (match.to.end <= span.start || match.to.start >= span.end) {
        continue;
      }
      if (nodes.length >= limit) {
        truncated = true;
        break;
      }
      nodes.push({ nodeId: node.id, span: match.to, precision: match.precision });
    }
    if (truncated) {
      break;
    }
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- 产物 target 为 ES2022。
  const ordered = [...nodes].sort((left, right) => left.span.start - right.span.start);
  return { nodes: ordered, truncated };
}
