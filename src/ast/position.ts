import type { WikitextPoint, WikitextPosition, WikitextRange } from "./model";

/**
 * 源码行索引：把 offset 换算成行列坐标，并提供归一化阶段共用的行查询。
 * `lineAt` 与 `lineRange` 都以 0 基行号工作，避免各处重复构建行表。
 */
export interface PositionIndex {
  position(range: WikitextRange): WikitextPosition;
  point(offset: number): WikitextPoint;
  /** 包含该 offset 的 0 基行号；offset 超出源码时回退到末行。 */
  lineAt(offset: number): number;
  /** 该行的源码区间，不含换行符。 */
  lineRange(line: number): WikitextRange;
  /** 行数；末尾换行会产生一行空行。 */
  readonly lineCount: number;
}

/** 建立 source 的行起点表，按 UTF-16 offset 计算 unist 的 1 基行列。 */
export function createPositionIndex(source: string): PositionIndex {
  const lineStarts: number[] = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }

  const point = (offset: number): WikitextPoint => {
    const line = lineAt(offset);
    return { line: line + 1, column: offset - lineStarts[line]! + 1, offset };
  };

  const lineAt = (offset: number): number => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (lineStarts[middle]! <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low;
  };

  const lineRange = (line: number): WikitextRange => {
    const start = lineStarts[line] ?? source.length;
    const end = line + 1 < lineStarts.length ? lineStarts[line + 1]! - 1 : source.length;
    return [start, end];
  };

  return {
    lineCount: lineStarts.length,
    lineAt,
    lineRange,
    point,
    position(range) {
      return { start: point(range[0]), end: point(range[1]) };
    },
  };
}
