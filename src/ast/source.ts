import { WikitextParseError } from "./errors";

/** 默认的源码长度上限（字符数）。 */
export const DEFAULT_MAX_SOURCE_LENGTH = 100_000;

/** 归一化后的源码及其变化信息。 */
export interface NormalizedSource {
  /** 归一化后的源码，换行符统一为 LF。 */
  readonly source: string;
  /** 源码是否因归一化而改变。 */
  readonly normalized: boolean;
  /** 归一化前的长度。 */
  readonly originalLength: number;
}

/**
 * 把 CRLF 与 CR 统一为 LF；后续所有坐标都以返回的文本为基准。
 * @param source 原始源码。
 * @param maxSourceLength 归一化后的长度上限。
 */
export function normalizeSource(
  source: string,
  maxSourceLength: number = DEFAULT_MAX_SOURCE_LENGTH,
): NormalizedSource {
  if (typeof source !== "string") {
    throw new WikitextParseError("PARSE_FAILED", "Source must be a string.");
  }
  const normalized = source.replace(/\r\n?/gu, "\n");
  if (normalized.length > maxSourceLength) {
    throw new WikitextParseError(
      "SOURCE_TOO_LONG",
      `Source length ${normalized.length} exceeds the limit of ${maxSourceLength}.`,
    );
  }
  return {
    source: normalized,
    normalized: normalized !== source,
    originalLength: source.length,
  };
}
