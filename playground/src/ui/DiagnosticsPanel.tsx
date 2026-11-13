import type { WikitextExpansionInfo } from "@pg/parse/protocol";
import type { WikitextRenderSnapshot } from "react-wikitext/hast";
import { DEFAULT_MAX_SOURCE_LENGTH, type WikitextParsedSnapshot } from "react-wikitext/parse";
import {
  DEFAULT_HEADING_PREFIX,
  DEFAULT_MAX_NODES,
  EXTERNAL_LINK_TARGETS,
  HEADING_STRATEGIES,
  parsePositiveInteger,
  type PlaygroundOptions,
} from "@pg/state/options";
import type { SceneDefinition } from "@pg/catalog";
import type { ParseErrorInfo } from "@pg/parse/protocol";
import { formatDuration, formatExecution, type StatusFacts } from "./facts";

interface DiagnosticsPanelProps {
  facts: StatusFacts;
  doc?: WikitextParsedSnapshot;
  prepared?: WikitextRenderSnapshot;
  error?: ParseErrorInfo;
  prepareError?: ParseErrorInfo;
  source: SceneDefinition;
  options: PlaygroundOptions;
  onChange: (patch: Partial<PlaygroundOptions>) => void;
  onReset: () => void;
  parseSourceLength: number;
  expansion?: WikitextExpansionInfo;
}

function limitValue(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

export function DiagnosticsPanel({
  facts,
  doc,
  prepared,
  error,
  prepareError,
  source,
  options,
  onChange,
  onReset,
  parseSourceLength,
  expansion,
}: DiagnosticsPanelProps) {
  // prepare 的诊断已经包含解析诊断；优先展示完整的渲染侧诊断。
  const diagnostics = prepared?.diagnostics ?? doc?.diagnostics ?? [];
  const rows: readonly [string, string][] = [
    ["运行模式", facts.mode],
    ["输入源", `${source.id}（${source.group}）`],
    ["解析器", doc?.meta.parser ?? "wikiparser-node"],
    ["解析器版本", facts.parserVersion ?? "—"],
    ["AST schema", doc ? String(doc.meta.astSchemaVersion) : "—"],
    ["保留语法树", doc ? (doc.meta.retainSyntax ? "是" : "否") : "—"],
    ["配置", facts.configKey],
    ["页面名", options.pageName],
    ["编辑器源码长度", `${facts.sourceLength} 字符`],
    ["送入解析长度", `${parseSourceLength} 字符`],
    ["归一化后长度", doc ? `${doc.source.length} 字符` : "—"],
    ["原始长度", doc ? `${doc.meta.originalLength} 字符` : "—"],
    ["CRLF 归一化", doc ? (facts.normalized ? "是" : "否") : "—"],
    ["节点数", facts.nodeCount === undefined ? "—" : String(facts.nodeCount)],
    ["诊断数", doc ? String(diagnostics.length) : "—"],
    ["解析耗时", formatDuration(facts.durationMs)],
    ["执行位置", formatExecution(facts.executedInWorker)],
    ["源码上限", String(options.maxSourceLength ?? DEFAULT_MAX_SOURCE_LENGTH)],
    ["节点上限", String(options.maxNodeCount ?? DEFAULT_MAX_NODES)],
    [
      "准备结果",
      prepareError ? "失败" : prepared ? `成功（${prepared.headings.length} 标题）` : "—",
    ],
  ];

  return (
    <div className="pg-diagnostics" data-testid="pg-diagnostics">
      {error ? (
        <section className="pg-diagnostics__error" role="alert">
          <h3>解析错误</h3>
          <p className="pg-diagnostics__code">{error.code ?? error.name}</p>
          <p>{error.message}</p>
        </section>
      ) : null}
      {prepareError ? (
        <section className="pg-diagnostics__error" role="alert">
          <h3>准备错误</h3>
          <p className="pg-diagnostics__code">{prepareError.code ?? prepareError.name}</p>
          <p>{prepareError.message}</p>
        </section>
      ) : null}

      <section>
        <h3>解析诊断</h3>
        <table className="pg-diagnostics__table">
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>诊断列表</h3>
        {diagnostics.length === 0 ? (
          <p className="pg-note">没有解析或准备阶段的诊断。</p>
        ) : (
          <ul className="pg-diagnostics__warnings">
            {diagnostics.map((diagnostic) => (
              <li key={`${diagnostic.stage}:${diagnostic.code}:${diagnostic.message}`}>
                <code>{diagnostic.severity}</code> <code>{diagnostic.code}</code>{" "}
                <span>{diagnostic.stage}</span>
                <p>{diagnostic.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {expansion ? (
        <>
          <section>
            <h3>展开记录</h3>
            {expansion.records.length === 0 ? (
              <p className="pg-note">没有参与展开或保留的顶层调用。</p>
            ) : (
              <ul className="pg-diagnostics__warnings">
                {expansion.records.map((record) => (
                  <li key={`${record.kind}:${record.originalRange[0]}:${record.name}`}>
                    <code>{record.status}</code> <code>{record.kind}</code>{" "}
                    <span>{record.name || "（未命名）"}</span>
                    <p>
                      原始 [{record.originalRange[0]}, {record.originalRange[1]}) → 展开 [
                      {record.expandedRange[0]}, {record.expandedRange[1]})
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3>展开诊断（真实来源）</h3>
            {expansion.diagnostics.length === 0 ? (
              <p className="pg-note">没有展开阶段的诊断。</p>
            ) : (
              <ul className="pg-diagnostics__warnings">
                {expansion.diagnostics.map((diagnostic) => (
                  <li
                    key={`${diagnostic.code}:${diagnostic.location?.start ?? ""}:${diagnostic.message}`}
                  >
                    <code>{diagnostic.severity}</code> <code>{diagnostic.code}</code>{" "}
                    {diagnostic.templateTitle ? <span>{diagnostic.templateTitle}</span> : null}
                    <p>{diagnostic.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}

      <details className="pg-advanced" data-testid="pg-advanced">
        <summary>高级选项</summary>
        <div className="pg-advanced__body">
          <div className="pg-field-row">
            <label className="pg-field">
              <span>外链窗口</span>
              <select
                value={options.externalLinkTarget}
                onChange={(event) =>
                  onChange({
                    externalLinkTarget: event.target
                      .value as PlaygroundOptions["externalLinkTarget"],
                  })
                }
              >
                {EXTERNAL_LINK_TARGETS.map((value) => (
                  <option key={value} value={value}>
                    {value === "_blank" ? "_blank（默认）" : value}
                  </option>
                ))}
              </select>
            </label>
            <label className="pg-field">
              <span>节点上限</span>
              <input
                type="number"
                min={1}
                placeholder={String(DEFAULT_MAX_NODES)}
                value={limitValue(options.maxNodeCount)}
                onChange={(event) =>
                  onChange({ maxNodeCount: parsePositiveInteger(event.target.value) })
                }
              />
            </label>
          </div>
          <div className="pg-field-row">
            <label className="pg-field">
              <span>headingIdStrategy</span>
              <select
                value={options.headingIdStrategy}
                onChange={(event) =>
                  onChange({
                    headingIdStrategy: event.target.value as PlaygroundOptions["headingIdStrategy"],
                  })
                }
              >
                {HEADING_STRATEGIES.map((value) => (
                  <option key={value} value={value}>
                    {value === "instance" ? "instance（默认）" : value}
                  </option>
                ))}
              </select>
            </label>
            {options.headingIdStrategy === "instance" ? (
              <label className="pg-field">
                <span>headingIdPrefix</span>
                <input
                  type="text"
                  value={options.headingIdPrefix}
                  placeholder={DEFAULT_HEADING_PREFIX}
                  onChange={(event) => onChange({ headingIdPrefix: event.target.value })}
                />
              </label>
            ) : null}
          </div>
          <div className="pg-advanced__actions">
            <span className="pg-note">
              这些选项影响渲染策略与解析边界，通常只在复现问题时调整。
            </span>
            <button type="button" className="pg-button pg-button--small" onClick={onReset}>
              重置选项
            </button>
          </div>
        </div>
      </details>

      <section>
        <h3>输入源</h3>
        <p className="pg-diagnostics__description">{source.description}</p>
        {source.transformSource ? (
          <p className="pg-note">该输入源在送入解析器前会转换换行符。</p>
        ) : null}
      </section>
    </div>
  );
}
