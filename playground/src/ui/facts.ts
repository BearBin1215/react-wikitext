import { flattenNodes, type WikitextParsedSnapshot } from "react-wikitext/ast";
import type { WikitextRenderSnapshot } from "react-wikitext/hast";
import type { ParserConfigKey } from "@pg/parse/configs";
import type { ParseStats } from "@pg/parse/protocol";

/** 状态栏、诊断与复现共用的一份展示事实。 */
export interface StatusFacts {
  mode: "source" | "dist";
  executedInWorker: boolean;
  durationMs?: number;
  nodeCount?: number;
  sourceLength: number;
  configKey: ParserConfigKey;
  parserVersion?: string;
  normalized: boolean;
  warningCount: number;
}

export interface StatusFactsInput {
  mode: "source" | "dist";
  executedInWorker: boolean;
  doc?: WikitextParsedSnapshot;
  prepared?: WikitextRenderSnapshot;
  stats?: ParseStats;
  configKey: ParserConfigKey;
  sourceLength: number;
}

/** 由会话派生一次，传给状态栏、诊断与复现，避免各自重新组装。 */
export function buildStatusFacts({
  mode,
  executedInWorker,
  doc,
  prepared,
  stats,
  configKey,
  sourceLength,
}: StatusFactsInput): StatusFacts {
  return {
    mode,
    executedInWorker,
    ...(stats ? { durationMs: stats.durationMs } : {}),
    ...(doc ? { nodeCount: flattenNodes(doc.ast).length } : {}),
    sourceLength,
    configKey,
    ...(doc ? { parserVersion: doc.meta.parserVersion } : {}),
    normalized: doc?.meta.sourceNormalized ?? false,
    warningCount: (prepared?.diagnostics ?? doc?.diagnostics ?? []).length,
  };
}

export function formatExecution(executedInWorker: boolean): string {
  return executedInWorker ? "Web Worker" : "主线程";
}

export function formatDuration(durationMs: number | undefined): string {
  return durationMs === undefined ? "—" : `${durationMs} ms`;
}
