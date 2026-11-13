import { WikitextError, WikitextExpandError } from "../errors";
import type {
  WikitextInvocation,
  WikitextSourceGraph,
  WikitextSourceId,
  WikitextSourceSegment,
  WikitextTextSource,
} from "./types";
import { SOURCE_GRAPH_VERSION } from "./types";

/** 32 位 FNV-1a；用于从内容派生稳定身份，不用于安全用途。 */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

/** 页面原文源身份。`revision` 必须区分编辑版本。 */
export function inputSourceId(key: string, revision: string): WikitextSourceId {
  return `input:${key}@${revision}`;
}

/** 页面 LF 归一化源身份。 */
export function normalizedSourceId(key: string, revision: string): WikitextSourceId {
  return `normalized:${key}@${revision}`;
}

/** 模板原文源身份；provider 的来源键与版本都会进入身份。 */
export function templateSourceId(
  providerKey: string,
  revision: string,
  title: string,
): WikitextSourceId {
  return `template:${providerKey}@${revision}:${title}`;
}

/** 模板有效正文源身份。 */
export function effectiveSourceId(
  providerKey: string,
  revision: string,
  title: string,
): WikitextSourceId {
  return `effective:${providerKey}@${revision}:${title}`;
}

/** 展开结果源身份；内容哈希保证同版本不同内容不会共用身份。 */
export function expandedSourceId(key: string, revision: string, text: string): WikitextSourceId {
  return `expanded:${key}@${revision}:${hashText(text)}`;
}

/** 来源图构建预算；超过时由调用方使整次编译失败，不静默丢弃映射。 */
export interface SourceGraphLimits {
  readonly maxSources?: number;
  readonly maxSegments?: number;
  readonly maxInvocations?: number;
}

/** 来源图构建器：只收集普通数据，不建立索引。 */
export interface SourceGraphBuilder {
  /** 登记文本源；相同 id 的内容必须一致，否则抛错。 */
  addSource(source: WikitextTextSource): WikitextTextSource;
  addSegment(segment: WikitextSourceSegment): void;
  addInvocation(invocation: WikitextInvocation): void;
  finalize(): WikitextSourceGraph;
}

function overflowError(kind: string, limit: number): WikitextExpandError {
  return new WikitextExpandError(
    "SOURCE_GRAPH_TOO_LARGE",
    `The source graph exceeded the ${kind} limit of ${limit}.`,
  );
}

/**
 * 创建来源图构建器。
 * @param limits 源、片段与调用数量上限。
 */
export function createSourceGraphBuilder(limits: SourceGraphLimits = {}): SourceGraphBuilder {
  const maxSources = limits.maxSources ?? 4_096;
  const maxSegments = limits.maxSegments ?? 250_000;
  const maxInvocations = limits.maxInvocations ?? 20_000;
  const sources = new Map<WikitextSourceId, WikitextTextSource>();
  const segments: WikitextSourceSegment[] = [];
  const invocations: WikitextInvocation[] = [];

  return {
    addSource(source) {
      const existing = sources.get(source.id);
      if (existing) {
        if (existing.text !== source.text || existing.role !== source.role) {
          throw new WikitextError(
            "INVALID_DOCUMENT",
            `Source identity "${source.id}" was reused with different content.`,
          );
        }
        return existing;
      }
      if (sources.size >= maxSources) {
        throw overflowError("source", maxSources);
      }
      sources.set(source.id, source);
      return source;
    },
    addSegment(segment) {
      if (segments.length >= maxSegments) {
        throw overflowError("segment", maxSegments);
      }
      segments.push(segment);
    },
    addInvocation(invocation) {
      if (invocations.length >= maxInvocations) {
        throw overflowError("invocation", maxInvocations);
      }
      invocations.push(invocation);
    },
    finalize() {
      return {
        version: SOURCE_GRAPH_VERSION,
        sources: [...sources.values()],
        segments,
        invocations,
      };
    },
  } as SourceGraphBuilder;
}

/** 归一化结果与显式映射片段。 */
export interface NormalizedWithSegments {
  readonly text: string;
  /** 未变化的片段与换行替换片段；坐标都在输入与归一化文本中有效。 */
  readonly segments: readonly WikitextSourceSegment[];
}

/**
 * 把 CRLF / CR 归一化为 LF，并记录边界对应关系。
 *
 * 完整 CRLF 与归一化后的 LF 可按边界精确对应；CR 与 LF 之间的内部 offset
 * 没有唯一对应点，由查询层按偏置规则处理，不在这里插值。
 * @param text 输入原文。
 */
export function normalizeWithSegments(text: string): NormalizedWithSegments {
  const wholeText = (): WikitextSourceSegment[] =>
    text.length === 0
      ? []
      : [
          {
            kind: "copy",
            from: { sourceId: "", start: 0, end: text.length },
            to: { sourceId: "", start: 0, end: text.length },
            precision: "exact",
          },
        ];
  if (!text.includes("\r")) {
    return { text, segments: wholeText() };
  }
  const segments: WikitextSourceSegment[] = [];
  let inputCursor = 0;
  let outputCursor = 0;
  let index = 0;
  while (index < text.length) {
    if (text[index] !== "\r") {
      index++;
      continue;
    }
    if (index > inputCursor) {
      segments.push({
        kind: "copy",
        from: { sourceId: "", start: inputCursor, end: index },
        to: { sourceId: "", start: outputCursor, end: outputCursor + (index - inputCursor) },
        precision: "exact",
      });
      outputCursor += index - inputCursor;
    }
    const width = text[index + 1] === "\n" ? 2 : 1;
    segments.push({
      kind: "normalize",
      from: { sourceId: "", start: index, end: index + width },
      to: { sourceId: "", start: outputCursor, end: outputCursor + 1 },
      precision: "exact",
    });
    outputCursor += 1;
    index += width;
    inputCursor = index;
  }
  if (inputCursor < text.length) {
    segments.push({
      kind: "copy",
      from: { sourceId: "", start: inputCursor, end: text.length },
      to: { sourceId: "", start: outputCursor, end: outputCursor + (text.length - inputCursor) },
      precision: "exact",
    });
  }
  return { text: text.replace(/\r\n?/gu, "\n"), segments };
}

/** 把占位 source id 的片段改写为真实身份。 */
export function bindSegmentSources(
  segments: readonly WikitextSourceSegment[],
  fromSourceId: WikitextSourceId,
  toSourceId: WikitextSourceId,
  offsetTo: number = 0,
  offsetFrom: number = 0,
): WikitextSourceSegment[] {
  return segments.map((segment) => ({
    ...segment,
    ...(segment.from === undefined
      ? {}
      : {
          from: {
            sourceId: fromSourceId,
            start: segment.from.start + offsetFrom,
            end: segment.from.end + offsetFrom,
          },
        }),
    ...(segment.to === undefined
      ? {}
      : {
          to: {
            sourceId: toSourceId,
            start: segment.to.start + offsetTo,
            end: segment.to.end + offsetTo,
          },
        }),
  }));
}
