import type { WikitextExpansionInfo } from "react-wikitext/expand";
import type { WikitextDocument } from "react-wikitext/parse";
import type { ParserConfigKey } from "./configs";

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
  doc: WikitextDocument;
  expansion?: WikitextExpansionInfo;
}

/** worker 响应。 */
export type ParseResponse =
  | ({ id: number; ok: true } & ParsePayload & ParseStats)
  | ({ id: number; ok: false; error: ParseErrorInfo } & ParseStats);
