import type { WikitextMappingPrecision, WikitextSourceSpan } from "./types";

/**
 * 求值输出的一个片段。
 *
 * `source` 与 `text` 等长时表示可逐字符对应的来源；文本经过函数转换后
 * 不再保留 `source`，改用 `anchor` 关联产生结果的调用位置。
 */
export interface WikitextOutputPiece {
  readonly text: string;
  readonly source?: WikitextSourceSpan;
  readonly anchor?: WikitextSourceSpan;
  readonly precision: WikitextMappingPrecision;
  readonly invocationId?: string;
}

/** 调用输出在本次输出中的相对范围。 */
export interface WikitextOutputMark {
  readonly invocationId: string;
  readonly start: number;
  readonly end: number;
}

/** 一段求值输出；`marks` 相对于本段输出起点。 */
export interface WikitextOutput {
  readonly pieces: readonly WikitextOutputPiece[];
  readonly marks: readonly WikitextOutputMark[];
  readonly unresolved: boolean;
}

/** 空输出；共用以减少分配。 */
export const EMPTY_OUTPUT: WikitextOutput = { pieces: [], marks: [], unresolved: false };

/** 输出总长度。 */
export function outputLength(output: WikitextOutput): number {
  let length = 0;
  for (const piece of output.pieces) {
    length += piece.text.length;
  }
  return length;
}

/** 拼接输出文本。 */
export function outputText(output: WikitextOutput): string {
  return output.pieces.map((piece) => piece.text).join("");
}

/**
 * 等长复制片段；`span` 必须指向与 `text` 等长的范围。
 * @param text 片段文本。
 * @param span 来源范围。
 */
export function literalOutput(text: string, span: WikitextSourceSpan): WikitextOutput {
  if (!text) {
    return EMPTY_OUTPUT;
  }
  return {
    pieces: [{ text, source: span, precision: "exact" }],
    marks: [],
    unresolved: false,
  };
}

/**
 * 生成内容的输出；不伪造来源范围，只保留产生它的调用位置。
 * @param text 生成文本。
 * @param anchor 产生结果的调用或节点范围。
 */
export function generatedOutput(text: string, anchor?: WikitextSourceSpan): WikitextOutput {
  if (!text) {
    return EMPTY_OUTPUT;
  }
  return {
    pieces: [
      {
        text,
        ...(anchor === undefined ? {} : { anchor }),
        precision: "enclosing-invocation",
      },
    ],
    marks: [],
    unresolved: false,
  };
}

/** 在同源且相邻时合并片段，避免片段数量随纯文本膨胀。 */
function appendPiece(pieces: WikitextOutputPiece[], piece: WikitextOutputPiece): void {
  if (!piece.text) {
    return;
  }
  const previous = pieces[pieces.length - 1];
  if (
    previous &&
    previous.invocationId === piece.invocationId &&
    previous.precision === piece.precision &&
    previous.source === undefined &&
    piece.source === undefined &&
    previous.anchor === undefined &&
    piece.anchor === undefined
  ) {
    pieces[pieces.length - 1] = { ...previous, text: previous.text + piece.text };
    return;
  }
  if (
    previous &&
    previous.invocationId === piece.invocationId &&
    previous.precision === "exact" &&
    piece.precision === "exact" &&
    previous.source !== undefined &&
    piece.source !== undefined &&
    previous.source.sourceId === piece.source.sourceId &&
    previous.source.end === piece.source.start
  ) {
    pieces[pieces.length - 1] = {
      ...previous,
      text: previous.text + piece.text,
      source: { ...previous.source, end: piece.source.end },
    };
    return;
  }
  pieces.push(piece);
}

/** 顺序拼接多段输出，并按偏移修正调用标记。 */
export function concatOutputs(outputs: readonly WikitextOutput[]): WikitextOutput {
  let pieces: WikitextOutputPiece[] | undefined;
  let marks: WikitextOutputMark[] | undefined;
  let unresolved = false;
  let offset = 0;
  for (const output of outputs) {
    if (output.pieces.length > 0) {
      pieces ??= [];
      for (const piece of output.pieces) {
        appendPiece(pieces, piece);
      }
    }
    if (output.marks.length > 0) {
      marks ??= [];
      for (const mark of output.marks) {
        marks.push({ ...mark, start: mark.start + offset, end: mark.end + offset });
      }
    }
    unresolved ||= output.unresolved;
    offset += outputLength(output);
  }
  return {
    pieces: pieces ?? [],
    marks: marks ?? [],
    unresolved,
  };
}

/** 去掉片段两侧的空白，并同步收缩来源范围。 */
export function trimOutput(output: WikitextOutput): WikitextOutput {
  const text = outputText(output);
  const trimmed = text.trim();
  if (trimmed === text) {
    return output;
  }
  if (!trimmed) {
    return { pieces: [], marks: [], unresolved: output.unresolved };
  }
  const start = text.length - text.trimStart().length;
  const end = text.trimEnd().length;
  const pieces: WikitextOutputPiece[] = [];
  let cursor = 0;
  for (const piece of output.pieces) {
    const pieceStart = cursor;
    const pieceEnd = cursor + piece.text.length;
    cursor = pieceEnd;
    const from = Math.max(start, pieceStart);
    const to = Math.min(end, pieceEnd);
    if (to <= from) {
      continue;
    }
    const localStart = from - pieceStart;
    const localEnd = to - pieceStart;
    const slice = piece.text.slice(localStart, localEnd);
    if (piece.source !== undefined && piece.source.end - piece.source.start === piece.text.length) {
      appendPiece(pieces, {
        ...piece,
        text: slice,
        source: {
          ...piece.source,
          start: piece.source.start + localStart,
          end: piece.source.start + localEnd,
        },
      });
    } else {
      appendPiece(pieces, { ...piece, text: slice });
    }
  }
  // 裁剪会移动内容，调用标记必须跟着平移，否则输出出现位置会指向错误范围。
  const marks = output.marks
    .map((mark) => ({
      ...mark,
      start: Math.max(0, mark.start - start),
      end: Math.min(trimmed.length, Math.max(0, mark.end - start)),
    }))
    .filter((mark) => mark.end > mark.start);
  return { pieces, marks, unresolved: output.unresolved };
}

/**
 * 用函数结果替换整段输出。
 *
 * 结果无法逐字符对应时只保留调用位置，精度不低于 `enclosing-invocation`。
 * @param text 函数结果。
 * @param anchor 产生结果的调用范围。
 * @param unresolved 是否包含未解决依赖。
 */
export function transformOutput(
  text: string,
  anchor: WikitextSourceSpan | undefined,
  unresolved = false,
): WikitextOutput {
  if (!text) {
    return { pieces: [], marks: [], unresolved };
  }
  return {
    pieces: [
      {
        text,
        ...(anchor === undefined ? {} : { anchor }),
        precision: "enclosing-invocation",
      },
    ],
    marks: [],
    unresolved,
  };
}

/** 给所有片段补上调用标记；用于把结果归属到产生它的调用。 */
export function tagInvocation(output: WikitextOutput, invocationId: string): WikitextOutput {
  if (output.pieces.length === 0) {
    return output;
  }
  return {
    ...output,
    pieces: output.pieces.map((piece) =>
      piece.invocationId === undefined ? { ...piece, invocationId } : piece,
    ),
  };
}
