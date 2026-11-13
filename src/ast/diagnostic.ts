import { isSpanShape } from "./sourceGraph/span";
import { WIKITEXT_DIAGNOSTIC_SEVERITIES, WIKITEXT_STAGES, type WikitextDiagnostic } from "./model";

const DIAGNOSTIC_STAGES: ReadonlySet<string> = new Set(WIKITEXT_STAGES);
const DIAGNOSTIC_SEVERITIES: ReadonlySet<string> = new Set(WIKITEXT_DIAGNOSTIC_SEVERITIES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 判断一个值是否具备诊断的最小形状；两个序列化入口共用同一套校验，
 * 避免恢复逻辑对阶段或级别的接受范围发生分叉。
 */
export function isWikitextDiagnostic(value: unknown): value is WikitextDiagnostic {
  if (!isRecord(value)) {
    return false;
  }
  if (
    typeof value.code !== "string" ||
    typeof value.message !== "string" ||
    typeof value.stage !== "string" ||
    !DIAGNOSTIC_STAGES.has(value.stage) ||
    typeof value.severity !== "string" ||
    !DIAGNOSTIC_SEVERITIES.has(value.severity)
  ) {
    return false;
  }
  if (value.location !== undefined && !isSpanShape(value.location)) {
    return false;
  }
  if (value.related !== undefined) {
    if (!Array.isArray(value.related)) {
      return false;
    }
    for (const entry of value.related) {
      if (!isRecord(entry) || !isSpanShape(entry.location) || typeof entry.message !== "string") {
        return false;
      }
    }
  }
  if (value.count !== undefined && !Number.isSafeInteger(value.count)) {
    return false;
  }
  return true;
}
