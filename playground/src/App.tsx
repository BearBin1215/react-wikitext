import { useMemo, useRef } from "react";
import { WikitextView } from "react-wikitext";
import type { WikitextRange } from "react-wikitext/ast";
import { AstTree, NodeInspector, type DevtreeKind, type DevtreeNode } from "@pg/devtools";
import { SCENES } from "@pg/catalog";
import { EditorPane, type EditorPaneHandle } from "@pg/editor/EditorPane";
import type { ReproInput } from "@pg/harness/repro";
import { RIGHT_PANELS } from "@pg/session/persistence";
import { usePlaygroundSession } from "@pg/session/usePlaygroundSession";
import { EXPANDED_DEPTH_OPTIONS } from "@pg/state/options";
import { useSystemDark } from "@pg/state/useSystemDark";
import { ApiPanel } from "@pg/ui/ApiPanel";
import { CopyButton } from "@pg/ui/CopyButton";
import { DiagnosticsPanel } from "@pg/ui/DiagnosticsPanel";
import { ReproPanel } from "@pg/ui/ReproPanel";
import { SceneBar } from "@pg/ui/SceneBar";
import { SceneMenu } from "@pg/ui/SceneMenu";
import { StatusBar } from "@pg/ui/StatusBar";
import { TopBar } from "@pg/ui/TopBar";

function rangeOf(node: DevtreeNode): WikitextRange | undefined {
  return "props" in node ? node.range : node.origin?.range;
}

/** 只负责组合会话与布局；状态与派生值都在 `usePlaygroundSession` 里。 */
export function App() {
  const session = usePlaygroundSession();
  const {
    state,
    scene,
    doc,
    prepared,
    prepareError,
    parseError,
    expansion,
    facts,
    parsing,
    workerAvailable,
    devtoolsLabels,
    viewProps,
    selectedNode,
    selectedRange,
    semanticSelected,
    dirty,
    mode,
  } = session;
  const editorRef = useRef<EditorPaneHandle>(null);
  const dark = useSystemDark();

  const handleSelect = (node: DevtreeNode, kind: DevtreeKind): void => {
    session.selectNode(node.id, kind);
    if (!doc || doc.source !== state.source) {
      return;
    }
    const range = rangeOf(node);
    if (range && range[0] !== range[1]) {
      editorRef.current?.selectRange(range);
    }
  };

  const reproInput = useMemo<ReproInput>(
    () => ({
      scene,
      text: state.source,
      parseText: session.parseSource,
      options: state.options,
      ...(doc === undefined ? {} : { document: doc }),
      ...(prepared === undefined ? {} : { prepared }),
      ...(parseError === undefined ? {} : { error: parseError }),
      ...(prepareError === undefined ? {} : { prepareError }),
      ...(expansion === undefined ? {} : { expansion }),
      ...(semanticSelected === undefined ? {} : { selectedNode: semanticSelected }),
      facts,
    }),
    [
      scene,
      state.source,
      state.options,
      session.parseSource,
      doc,
      prepared,
      parseError,
      prepareError,
      expansion,
      semanticSelected,
      facts,
    ],
  );

  return (
    <div
      className="pg-app"
      data-wikitext-theme={dark ? "dark" : "light"}
      data-testid="pg-app"
      data-source-id={state.sourceId}
      data-source-group={scene.group}
      data-parsing={parsing ? "true" : "false"}
      data-worker={workerAvailable ? "true" : "false"}
      data-selected-id={state.selectedId ?? ""}
      data-selected-type={selectedNode?.type ?? ""}
      data-selected-range={selectedRange ? `${selectedRange[0]},${selectedRange[1]}` : ""}
      data-error-code={parseError?.code ?? parseError?.name ?? ""}
      data-config={state.options.parserConfig}
      data-duration={facts.durationMs === undefined ? "" : String(facts.durationMs)}
      data-node-count={facts.nodeCount === undefined ? "" : String(facts.nodeCount)}
      data-normalized={doc ? String(doc.meta.sourceNormalized) : ""}
      data-tree={state.treeKind}
      data-panel={state.panel}
      data-dirty={dirty ? "true" : "false"}
      data-mode={mode}
      data-expansion={expansion?.status ?? "off"}
    >
      <TopBar options={state.options} onChange={session.patchOptions} />
      <div className="pg-layout">
        <aside className="pg-sidebar">
          <SceneMenu
            sources={SCENES}
            currentId={state.sourceId}
            dirty={dirty}
            onSelect={session.selectScene}
          />
        </aside>

        <main className="pg-workbench">
          <StatusBar
            parsing={parsing}
            facts={facts}
            {...(parseError === undefined ? {} : { error: parseError })}
            {...(expansion === undefined ? {} : { expansion })}
          />

          <SceneBar scene={scene} options={state.options} onChange={session.patchOptions} />

          <div className="pg-panes">
            <div className="pg-left">
              <section className="pg-pane">
                <header className="pg-pane__header">
                  <span>源码</span>
                  <div className="pg-pane__actions">
                    <span
                      className={dirty ? "pg-pane__meta pg-pane__meta--dirty" : "pg-pane__meta"}
                    >
                      {dirty ? "已修改" : scene.title} · {state.source.length} 字符
                    </span>
                    <button
                      type="button"
                      className="pg-button pg-button--small"
                      onClick={session.resetSource}
                      disabled={!dirty}
                      data-testid="pg-reset-source"
                    >
                      重置源码
                    </button>
                    <CopyButton text={state.source} label="复制源码" />
                  </div>
                </header>
                <EditorPane
                  key={`${state.sourceId}:${state.editorReset}`}
                  ref={editorRef}
                  source={state.source}
                  onChange={session.editSource}
                  onCursor={session.selectAtOffset}
                  {...(selectedRange === undefined ? {} : { selectedRange })}
                  placeholder="在此输入 wikitext…"
                />
              </section>

              <section className="pg-pane">
                <header className="pg-pane__header">
                  <span>AST 树</span>
                  <div className="pg-pane__actions">
                    <div className="pg-tree-switch">
                      <button
                        type="button"
                        className="pg-button pg-button--small"
                        aria-pressed={state.treeKind === "semantic"}
                        onClick={() => session.switchTree("semantic")}
                      >
                        语义树
                      </button>
                      <button
                        type="button"
                        className="pg-button pg-button--small"
                        aria-pressed={state.treeKind === "syntax"}
                        onClick={() => session.switchTree("syntax")}
                      >
                        语法树
                      </button>
                    </div>
                    <label className="pg-inline-field">
                      <span>默认展开深度</span>
                      <select
                        value={state.options.expandedDepth}
                        onChange={(event) =>
                          session.patchOptions({ expandedDepth: Number(event.target.value) })
                        }
                      >
                        {EXPANDED_DEPTH_OPTIONS.map((depth) => (
                          <option key={depth} value={depth}>
                            {depth}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="pg-pane__meta">
                      {facts.nodeCount === undefined ? "等待解析" : `${facts.nodeCount} 节点`}
                    </span>
                  </div>
                </header>
                <div className="pg-ast-grid">
                  {doc ? (
                    <AstTree
                      key={`${state.sourceId}:${state.options.expandedDepth}`}
                      document={doc}
                      tree={state.treeKind}
                      selectedId={state.selectedId}
                      onSelect={handleSelect}
                      defaultExpandedDepth={state.options.expandedDepth}
                      labels={devtoolsLabels.tree}
                    />
                  ) : (
                    <p className="pg-empty">{parsing ? "解析中…" : "没有可展示的 AST"}</p>
                  )}
                  <div className="pg-inspector">
                    <div className="pg-inspector__title">节点详情</div>
                    {doc ? (
                      <NodeInspector
                        document={doc}
                        node={selectedNode}
                        tree={state.treeKind}
                        labels={devtoolsLabels.inspector}
                      />
                    ) : (
                      <p className="pg-empty">等待解析</p>
                    )}
                  </div>
                </div>
              </section>
            </div>

            <section className="pg-pane pg-pane--right">
              <div className="pg-tabs" role="tablist" aria-label="右侧面板" data-testid="pg-tabs">
                {RIGHT_PANELS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={state.panel === item.id}
                    data-panel-tab={item.id}
                    data-testid={`pg-tab-${item.id}`}
                    className={state.panel === item.id ? "pg-tab is-active" : "pg-tab"}
                    onClick={() => session.selectPanel(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="pg-right-body">
                {state.panel === "preview" ? (
                  <div
                    className="pg-preview-scroll"
                    data-testid="pg-preview"
                    data-preview-state={
                      prepared ? "ready" : parseError || prepareError ? "error" : "empty"
                    }
                  >
                    {parseError && doc ? (
                      <div className="pg-preview-banner" role="alert">
                        解析失败，展示上一份成功文档：{parseError.code ?? parseError.name}
                      </div>
                    ) : null}
                    {prepareError ? (
                      <div className="pg-preview-error" role="alert">
                        <strong>{prepareError.code ?? prepareError.name}</strong>
                        <p>{prepareError.message}</p>
                      </div>
                    ) : prepared ? (
                      <WikitextView document={prepared} {...viewProps} />
                    ) : parseError ? (
                      <div className="pg-preview-error" role="alert">
                        <strong>{parseError.code ?? parseError.name}</strong>
                        <p>{parseError.message}</p>
                      </div>
                    ) : (
                      <p className="pg-empty">{parsing ? "解析中…" : "没有可渲染的文档"}</p>
                    )}
                  </div>
                ) : state.panel === "api" ? (
                  <ApiPanel
                    {...(doc === undefined ? {} : { document: doc })}
                    {...(prepared === undefined ? {} : { prepared })}
                    {...(semanticSelected === undefined ? {} : { node: semanticSelected })}
                    onSelect={(node) => handleSelect(node, "semantic")}
                  />
                ) : state.panel === "diagnostics" ? (
                  <DiagnosticsPanel
                    facts={facts}
                    {...(doc === undefined ? {} : { doc })}
                    {...(prepared === undefined ? {} : { prepared })}
                    {...(parseError === undefined ? {} : { error: parseError })}
                    {...(prepareError === undefined ? {} : { prepareError })}
                    source={scene}
                    options={state.options}
                    onChange={session.patchOptions}
                    onReset={session.resetOptions}
                    parseSourceLength={session.parseSource.length}
                    {...(expansion === undefined ? {} : { expansion })}
                  />
                ) : (
                  <ReproPanel {...reproInput} />
                )}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
