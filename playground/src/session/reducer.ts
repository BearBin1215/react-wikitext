import type { AstTreeKind } from "react-wikitext/devtools";
import { DEFAULT_SCENE_ID, resolveSceneOptions, sceneOf, sourceText } from "@pg/catalog";
import { DEFAULT_OPTIONS, type PlaygroundOptions } from "@pg/state/options";
import { loadSource, type InitialLocation, type RightPanel } from "./persistence";

/** 会话状态：源码、选项、面板与选区各只有一份。 */
export interface SessionState {
  readonly sourceId: string;
  readonly source: string;
  readonly options: PlaygroundOptions;
  readonly panel: RightPanel;
  readonly treeKind: AstTreeKind;
  readonly selectedId?: string;
  /** 编辑器重挂载计数；切源或重置时递增。 */
  readonly editorReset: number;
}

export type SessionAction =
  | { readonly type: "selectScene"; readonly sourceId: string }
  | { readonly type: "editSource"; readonly source: string }
  | { readonly type: "resetSource" }
  | { readonly type: "patchOptions"; readonly patch: Partial<PlaygroundOptions> }
  | { readonly type: "resetOptions" }
  | { readonly type: "selectPanel"; readonly panel: RightPanel }
  | { readonly type: "selectNode"; readonly id?: string; readonly treeKind?: AstTreeKind }
  | { readonly type: "switchTree"; readonly treeKind: AstTreeKind };

export function createInitialState(location: InitialLocation): SessionState {
  return {
    sourceId: location.sourceId,
    source: loadSource(location.sourceId),
    options: location.options,
    panel: location.panel,
    treeKind: location.treeKind,
    ...(location.selectedId === undefined ? {} : { selectedId: location.selectedId }),
    editorReset: 0,
  };
}

function withSceneOptions(sourceId: string, options: PlaygroundOptions): PlaygroundOptions {
  return resolveSceneOptions(sourceId, options);
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "selectScene": {
      if (action.sourceId === state.sourceId) {
        return state;
      }
      return {
        ...state,
        sourceId: action.sourceId,
        source: loadSource(action.sourceId),
        options: withSceneOptions(action.sourceId, state.options),
        selectedId: undefined,
        editorReset: state.editorReset + 1,
      };
    }
    case "editSource":
      return state.source === action.source ? state : { ...state, source: action.source };
    case "resetSource":
      return {
        ...state,
        source: sourceText(sceneOf(state.sourceId)),
        selectedId: undefined,
        editorReset: state.editorReset + 1,
      };
    case "patchOptions": {
      const patch = { ...action.patch };
      // 关闭模板展开时一并关闭“模拟最终解析失败”，避免留下无意义的回退开关。
      if (patch.expandTemplates === false) {
        patch.expandFallback = false;
      }
      return { ...state, options: { ...state.options, ...patch } };
    }
    case "resetOptions":
      return {
        ...state,
        options: withSceneOptions(state.sourceId, { ...DEFAULT_OPTIONS }),
      };
    case "selectPanel":
      return state.panel === action.panel ? state : { ...state, panel: action.panel };
    case "selectNode":
      return {
        ...state,
        ...(action.treeKind === undefined ? {} : { treeKind: action.treeKind }),
        ...(action.id === undefined ? { selectedId: undefined } : { selectedId: action.id }),
      };
    case "switchTree":
      return {
        ...state,
        treeKind: action.treeKind,
        selectedId: undefined,
      };
    default:
      return state;
  }
}

export { DEFAULT_SCENE_ID };
