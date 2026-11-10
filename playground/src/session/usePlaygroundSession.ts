import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  findNodeAtOffset,
  type WikitextDocument,
  type WikitextNode,
  type WikitextRange,
} from "react-wikitext/ast";
import type { WikitextExpansionInfo } from "react-wikitext/expand";
import {
  findAstTreeNode,
  getNodeRange,
  isSyntaxNode,
  restoreSelectedId,
  snapshotSelection,
  type AstTreeKind,
  type AstTreeNode,
} from "react-wikitext/devtools";
import { sceneOf, sourceText } from "@pg/catalog";
import type { ParseErrorInfo } from "@pg/parse/protocol";
import { useParseScheduler } from "@pg/parse/useParseScheduler";
import type { PlaygroundOptions } from "@pg/state/options";
import { buildStatusFacts, type StatusFacts } from "@pg/ui/facts";
import {
  clearDraft,
  readLocation,
  writeDraft,
  writeLocation,
  type RightPanel,
} from "./persistence";
import { createInitialState, sessionReducer } from "./reducer";
import { useDevtoolsLabels, usePrepareOutcome, useViewProps } from "./selectors";

/** 解析结果与准备结果都是派生值，不作为会话状态保存。 */
export interface PlaygroundSession {
  readonly state: ReturnType<typeof createInitialState>;
  readonly scene: ReturnType<typeof sceneOf>;
  readonly parseSource: string;
  readonly doc?: WikitextDocument;
  readonly expansion?: WikitextExpansionInfo;
  readonly parseError?: ParseErrorInfo;
  readonly parsing: boolean;
  readonly workerAvailable: boolean;
  readonly prepared?: ReturnType<typeof usePrepareOutcome>["prepared"];
  readonly prepareError?: ParseErrorInfo;
  readonly viewProps: ReturnType<typeof useViewProps>;
  readonly devtoolsLabels: ReturnType<typeof useDevtoolsLabels>;
  readonly selectedNode?: AstTreeNode;
  readonly selectedRange?: WikitextRange;
  readonly semanticSelected?: WikitextNode;
  readonly facts: StatusFacts;
  readonly dirty: boolean;
  readonly mode: "source" | "dist";
  editSource(source: string): void;
  selectScene(id: string): void;
  resetSource(): void;
  patchOptions(patch: Partial<PlaygroundOptions>): void;
  resetOptions(): void;
  selectPanel(panel: RightPanel): void;
  switchTree(kind: AstTreeKind): void;
  selectNode(id: string | undefined, kind?: AstTreeKind): void;
  selectAtOffset(offset: number): void;
}

/** 立即写入或清除当前草稿；卸载、切源与失焦共用。 */
function flushDraft(target: { sourceId: string; source: string }): void {
  if (target.source === sourceText(sceneOf(target.sourceId))) {
    clearDraft(target.sourceId);
  } else {
    writeDraft(target.sourceId, target.source);
  }
}

/** 会话层：唯一的状态来源，派生 doc / prepared / facts / repro 输入。 */
export function usePlaygroundSession(): PlaygroundSession {
  const [initial] = useState(() => readLocation());
  const [state, dispatch] = useReducer(sessionReducer, initial, createInitialState);
  const scene = useMemo(() => sceneOf(state.sourceId), [state.sourceId]);
  const source = state.source;
  const parseSource = useMemo(
    () => (scene.transformSource ? scene.transformSource(state.source) : state.source),
    [scene, state.source],
  );

  const scheduler = useParseScheduler({
    key: state.sourceId,
    source: parseSource,
    configKey: state.options.parserConfig,
    pageName: state.options.pageName,
    ...(state.options.maxSourceLength === undefined
      ? {}
      : { maxSourceLength: state.options.maxSourceLength }),
    ...(state.options.maxNodeCount === undefined
      ? {}
      : { maxNodeCount: state.options.maxNodeCount }),
    expandTemplates: state.options.expandTemplates,
    expandFallback: state.options.expandFallback,
  });
  // 只有属于当前输入源的结果才采用；切换后旧结果不会闪回。
  const result = scheduler.result?.key === state.sourceId ? scheduler.result : undefined;
  const doc = result?.doc;
  const { prepared, prepareError } = usePrepareOutcome(doc, state.options);
  const viewProps = useViewProps(state.options);
  const devtoolsLabels = useDevtoolsLabels(state.options);

  const selectedNode = useMemo<AstTreeNode | undefined>(() => {
    if (!doc || !state.selectedId) {
      return undefined;
    }
    return findAstTreeNode(doc, state.selectedId, state.treeKind);
  }, [doc, state.selectedId, state.treeKind]);
  const selectedRange = useMemo(() => {
    const range = selectedNode ? getNodeRange(selectedNode) : undefined;
    return range && range[0] !== range[1] ? range : undefined;
  }, [selectedNode]);
  const semanticSelected =
    state.treeKind === "semantic" && selectedNode && !isSyntaxNode(selectedNode)
      ? selectedNode
      : undefined;

  const mode: "source" | "dist" = import.meta.env.MODE === "dist" ? "dist" : "source";
  const facts = useMemo(
    () =>
      buildStatusFacts({
        mode,
        executedInWorker: result?.origin === "worker",
        ...(doc === undefined ? {} : { doc }),
        ...(prepared === undefined ? {} : { prepared }),
        ...(result?.stats === undefined ? {} : { stats: result.stats }),
        configKey: state.options.parserConfig,
        sourceLength: state.source.length,
      }),
    [mode, result, doc, prepared, state.options.parserConfig, state.source.length],
  );

  const baseSource = useMemo(() => sourceText(scene), [scene]);
  const dirty = state.source !== baseSource;

  // 文档更新后按 range 恢复选区；切换输入源时丢弃上一份快照。
  const previous = useRef<{ key: string; doc?: WikitextDocument }>({ key: state.sourceId });
  useEffect(() => {
    const prev = previous.current;
    if (!doc) {
      previous.current = { key: state.sourceId };
      return;
    }
    if (prev.key !== state.sourceId) {
      previous.current = { key: state.sourceId, doc };
      return;
    }
    if (prev.doc === doc) {
      if (state.selectedId && !findAstTreeNode(doc, state.selectedId, state.treeKind)) {
        dispatch({ type: "selectNode", id: undefined });
      }
      return;
    }
    if (!prev.doc) {
      // 首次解析完成时保留 URL 或持久化恢复的选区，只在节点不存在时清空。
      previous.current = { key: state.sourceId, doc };
      if (state.selectedId && !findAstTreeNode(doc, state.selectedId, state.treeKind)) {
        dispatch({ type: "selectNode", id: undefined });
      }
      return;
    }
    const snapshot = snapshotSelection(prev.doc, state.selectedId, state.treeKind);
    previous.current = { key: state.sourceId, doc };
    dispatch({ type: "selectNode", id: restoreSelectedId(doc, snapshot, state.treeKind) });
  }, [doc, state.sourceId, state.selectedId, state.treeKind]);

  // 草稿：输入时防抖写入；失焦、切源、卸载时立即写入。
  const draft = useRef({ sourceId: state.sourceId, source: state.source });
  useEffect(() => {
    draft.current = { sourceId: state.sourceId, source: state.source };
  }, [state.sourceId, state.source]);
  useEffect(() => {
    if (state.source === baseSource) {
      clearDraft(state.sourceId);
      return;
    }
    const timer = setTimeout(() => writeDraft(state.sourceId, state.source), 300);
    return () => clearTimeout(timer);
  }, [state.sourceId, state.source, baseSource]);
  useEffect(() => () => flushDraft(draft.current), []);
  useEffect(() => {
    const flush = (): void => flushDraft(draft.current);
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  // URL：只在序列化结果变化时写入；光标移动引起的选区变化同样经过防抖。
  const location = useRef(state);
  useEffect(() => {
    location.current = state;
  }, [state]);
  useEffect(() => {
    const timer = setTimeout(() => {
      const current = location.current;
      writeLocation({
        sourceId: current.sourceId,
        panel: current.panel,
        treeKind: current.treeKind,
        ...(current.selectedId === undefined ? {} : { selectedId: current.selectedId }),
        options: current.options,
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [state]);

  const editSource = useCallback((nextSource: string) => {
    dispatch({ type: "editSource", source: nextSource });
  }, []);
  const selectScene = useCallback((sourceId: string) => {
    dispatch({ type: "selectScene", sourceId });
  }, []);
  const resetSource = useCallback(() => {
    clearDraft(draft.current.sourceId);
    dispatch({ type: "resetSource" });
  }, []);
  const patchOptions = useCallback((patch: Partial<PlaygroundOptions>) => {
    dispatch({ type: "patchOptions", patch });
  }, []);
  const resetOptions = useCallback(() => {
    dispatch({ type: "resetOptions" });
  }, []);
  const selectPanel = useCallback((panel: RightPanel) => {
    dispatch({ type: "selectPanel", panel });
  }, []);
  const switchTree = useCallback((kind: AstTreeKind) => {
    dispatch({ type: "switchTree", treeKind: kind });
  }, []);
  const selectNode = useCallback((id: string | undefined, kind?: AstTreeKind) => {
    dispatch({
      type: "selectNode",
      ...(id === undefined ? {} : { id }),
      ...(kind === undefined ? {} : { treeKind: kind }),
    });
  }, []);
  const selectAtOffset = useCallback(
    (offset: number) => {
      // 选区偏移来自编辑器文本；只有归一化后的源码与之逐字一致时才能直接映射。
      if (!doc || doc.source !== source || offset > source.length) {
        return;
      }
      const id = findNodeAtOffset(doc, offset)?.id;
      dispatch({
        type: "selectNode",
        ...(id === undefined ? {} : { id }),
        treeKind: "semantic",
      });
    },
    [doc, source],
  );

  return {
    state,
    scene,
    parseSource,
    ...(doc === undefined ? {} : { doc }),
    ...(result?.expansion === undefined ? {} : { expansion: result.expansion }),
    ...(result?.error === undefined ? {} : { parseError: result.error }),
    parsing: scheduler.parsing,
    workerAvailable: scheduler.workerAvailable,
    ...(prepared === undefined ? {} : { prepared }),
    ...(prepareError === undefined ? {} : { prepareError }),
    viewProps,
    devtoolsLabels,
    ...(selectedNode === undefined ? {} : { selectedNode }),
    ...(selectedRange === undefined ? {} : { selectedRange }),
    ...(semanticSelected === undefined ? {} : { semanticSelected }),
    facts,
    dirty,
    mode,
    editSource,
    selectScene,
    resetSource,
    patchOptions,
    resetOptions,
    selectPanel,
    switchTree,
    selectNode,
    selectAtOffset,
  };
}
