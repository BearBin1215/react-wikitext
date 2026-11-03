import type { DevtreeKind } from "@pg/devtools";
import { DEFAULT_SCENE_ID, hasScene, resolveSceneOptions, sceneOf, sourceText } from "@pg/catalog";
import { readOptions, writeOptions, type PlaygroundOptions } from "@pg/state/options";

export const RIGHT_PANELS = [
  { id: "preview", label: "预览" },
  { id: "api", label: "API" },
  { id: "diagnostics", label: "诊断" },
  { id: "repro", label: "复现" },
] as const;

export type RightPanel = (typeof RIGHT_PANELS)[number]["id"];

const PANEL_IDS = new Set<string>(RIGHT_PANELS.map((panel) => panel.id));
const DRAFT_PREFIX = "react-wikitext:playground:draft:";
/** 已知的 URL 参数名；序列化时先移除再写入，未知参数保留。 */
const LOCATION_KEYS = ["source", "panel", "node", "tree"] as const;

function isRightPanel(value: string | null): value is RightPanel {
  return value !== null && PANEL_IDS.has(value);
}

function isTreeKind(value: string | null): value is DevtreeKind {
  return value === "semantic" || value === "syntax";
}

/** 首屏状态；所有字段都从 URL 读取，缺省时回到场景预设。 */
export interface InitialLocation {
  readonly sourceId: string;
  readonly panel: RightPanel;
  readonly treeKind: DevtreeKind;
  readonly selectedId?: string;
  readonly options: PlaygroundOptions;
}

export function readLocation(search: string = window.location.search): InitialLocation {
  const params = new URLSearchParams(search);
  const requested = params.get("source");
  const sourceId = requested !== null && hasScene(requested) ? requested : DEFAULT_SCENE_ID;
  const panel = params.get("panel");
  const node = params.get("node");
  const tree = params.get("tree");
  return {
    sourceId: sceneOf(sourceId).id,
    panel: isRightPanel(panel) ? panel : "preview",
    treeKind: isTreeKind(tree) ? tree : "semantic",
    ...(node ? { selectedId: node } : {}),
    // URL 显式写出的场景参数优先，其余回到场景预设。
    options: resolveSceneOptions(sourceId, readOptions(params), new Set(params.keys())),
  };
}

export interface LocationState {
  readonly sourceId: string;
  readonly panel: RightPanel;
  readonly treeKind: DevtreeKind;
  readonly selectedId?: string;
  readonly options: PlaygroundOptions;
}

/**
 * 把会话状态写回地址栏。
 * 保留 hash 与未知查询参数；只有序列化结果变化时才调用 `replaceState`。
 */
export function writeLocation(state: LocationState): void {
  const current = new URL(window.location.href);
  const params = new URLSearchParams(current.search);
  for (const key of LOCATION_KEYS) {
    params.delete(key);
  }
  // 选项编码先清空已知键，避免关闭的开关残留旧参数。
  const options = new URLSearchParams();
  writeOptions(options, state.options);
  for (const key of options.keys()) {
    params.delete(key);
  }
  params.set("source", state.sourceId);
  if (state.panel !== "preview") {
    params.set("panel", state.panel);
  }
  if (state.selectedId) {
    params.set("node", state.selectedId);
  }
  if (state.treeKind !== "semantic") {
    params.set("tree", state.treeKind);
  }
  const encoded = options.toString();
  if (encoded) {
    for (const [key, value] of options) {
      params.set(key, value);
    }
  }
  const search = params.toString();
  if (search === current.search.replace(/^\?/u, "")) {
    return;
  }
  current.search = search;
  window.history.replaceState(null, "", current);
}

export function readDraft(sourceId: string): string | undefined {
  try {
    return window.localStorage.getItem(DRAFT_PREFIX + sourceId) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeDraft(sourceId: string, source: string): void {
  try {
    window.localStorage.setItem(DRAFT_PREFIX + sourceId, source);
  } catch {
    // localStorage 不可用时只丢失草稿，不影响当前会话。
  }
}

export function clearDraft(sourceId: string): void {
  try {
    window.localStorage.removeItem(DRAFT_PREFIX + sourceId);
  } catch {
    // 同上。
  }
}

/** 读取草稿或场景初始文本。 */
export function loadSource(sourceId: string): string {
  return readDraft(sourceId) ?? sourceText(sceneOf(sourceId));
}
