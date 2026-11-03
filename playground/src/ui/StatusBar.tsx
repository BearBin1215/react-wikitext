import type { WikitextExpansionInfo } from "react-wikitext/expand";
import type { ParseErrorInfo } from "@pg/parse/protocol";
import { formatDuration, formatExecution, type StatusFacts } from "./facts";

interface StatusBarProps {
  parsing: boolean;
  facts: StatusFacts;
  error?: ParseErrorInfo;
  expansion?: WikitextExpansionInfo;
}

export function StatusBar({ parsing, facts, error, expansion }: StatusBarProps) {
  const state = parsing ? "parsing" : error ? "error" : "ready";
  const stateLabel = parsing ? "解析中…" : error ? "解析失败" : "就绪";
  return (
    <output className="pg-status" aria-live="polite" data-testid="pg-status">
      <span className={`pg-status__badge pg-status__badge--${state}`}>{stateLabel}</span>
      <span className="pg-status__item">{facts.mode}</span>
      <span className="pg-status__item">{formatExecution(facts.executedInWorker)}</span>
      {facts.durationMs !== undefined ? (
        <span className="pg-status__item">{formatDuration(facts.durationMs)}</span>
      ) : null}
      {facts.nodeCount !== undefined ? (
        <span className="pg-status__item">{facts.nodeCount} 节点</span>
      ) : null}
      <span className="pg-status__item">{facts.sourceLength} 字符</span>
      <span className="pg-status__item">{facts.configKey}</span>
      {expansion ? (
        <span className="pg-status__item">
          展开 {expansion.status} · {expansion.records.length} 记录
        </span>
      ) : null}
      {facts.parserVersion ? (
        <span className="pg-status__item">wikiparser-node {facts.parserVersion}</span>
      ) : null}
      {facts.normalized ? <span className="pg-status__item">已归一化 CRLF</span> : null}
      {facts.warningCount > 0 ? (
        <span className="pg-status__item pg-status__item--warning">诊断 {facts.warningCount}</span>
      ) : null}
      {error ? (
        <span className="pg-status__error" role="alert">
          {error.code ?? error.name}: {error.message}
        </span>
      ) : null}
    </output>
  );
}
