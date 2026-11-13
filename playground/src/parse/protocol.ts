import type { WikitextCompilationStatus } from "react-wikitext/expand";
import type { WikitextDiagnostic, WikitextParsedSnapshot } from "react-wikitext/parse";
import type { ParserConfigKey } from "./configs";

/** 验收台展示用的顶层调用记录；由来源图派生。 */
export interface PlaygroundExpansionRecord {
  readonly kind: string;
  readonly name: string;
  readonly originalRange: readonly [number, number];
  readonly expandedRange: readonly [number, number];
  readonly status: string;
}

/** 验收台展示用的展开信息；不是库的公共类型。 */
export interface WikitextExpansionInfo {
  readonly status: WikitextCompilationStatus;
  readonly records: readonly PlaygroundExpansionRecord[];
  readonly diagnostics: readonly WikitextDiagnostic[];
}

/** worker 与主线程共用的解析请求 DTO；不含输入源身份。 */
export interface ParseRequest {
  /** 单调递增的请求 id，用于丢弃过期结果。 */
  id: number;
  readonly source: string;
  readonly configKey: ParserConfigKey;
  readonly pageName: string;
  readonly maxSourceLength?: number;
  readonly maxNodeCount?: number;
  readonly expandTemplates: boolean;
  readonly expandFallback: boolean;
}

/** 跨线程传输的错误信息。 */
export interface ParseErrorInfo {
  code?: string;
  name: string;
  message: string;
}

/** 解析耗时与配置；由执行方回传，主线程不重复组装。 */
export interface ParseStats {
  durationMs: number;
  configKey: ParserConfigKey;
  pageName: string;
}

/** 一次成功解析的结果。 */
export interface ParsePayload {
  doc: WikitextParsedSnapshot;
  expansion?: WikitextExpansionInfo;
}

/** worker 响应。 */
export type ParseResponse =
  | ({ id: number; ok: true } & ParsePayload & ParseStats)
  | ({ id: number; ok: false; error: ParseErrorInfo } & ParseStats);
