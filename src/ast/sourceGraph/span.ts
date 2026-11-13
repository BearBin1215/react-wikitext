import type { WikitextSourceSpan } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 判断值是否具备 span 的最小形状：来源 id、安全整数与有序列。
 * 不检查是否落在某个文本源内。
 * @param value 待检查的值。
 */
export function isSpanShape(value: unknown): value is WikitextSourceSpan {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.sourceId === "string" &&
    Number.isSafeInteger(value.start) &&
    Number.isSafeInteger(value.end) &&
    (value.start as number) >= 0 &&
    (value.end as number) >= (value.start as number)
  );
}

/**
 * 判断值是否指向给定长度文本源内的合法范围。
 * @param value 待检查的值。
 * @param length 文本源的 UTF-16 长度。
 */
export function isSpanWithin(value: unknown, length: number): boolean {
  return isSpanShape(value) && value.end <= length;
}
