import {
  CORPUS_SCENE,
  SCENE_CONFIGS,
  SCENE_GROUP_LABELS,
  SCENE_GROUP_ORDER,
  type SceneConfig,
  type SceneGroupId,
} from "./scenes";
import {
  DEFAULT_SOURCE_ID,
  SOURCES,
  SOURCE_GROUPS,
  sourceText,
  type SourceDefinition,
  type SourceGroup,
} from "./sources";

export { DEFAULT_SOURCE_ID, SOURCES, SOURCE_GROUPS, sourceText };
export type { SourceDefinition, SourceGroup };
export {
  SCENE_GROUP_LABELS,
  SCENE_GROUP_ORDER,
  resolveSceneOptions,
  type SceneConfig,
  type SceneControlId,
  type SceneGroupId,
} from "./scenes";

/**
 * 输入源与场景配置合并后的唯一定义。
 * `group` 保留输入源自身的归类（内置/边界/语料），`sceneGroup` 是菜单分组。
 */
export interface SceneDefinition extends SourceDefinition, Omit<SceneConfig, "group"> {
  readonly sceneGroup: SceneGroupId;
}

function configFor(source: SourceDefinition): SceneConfig {
  const config = SCENE_CONFIGS[source.id];
  if (config) {
    return config;
  }
  if (source.group !== "corpus") {
    // 新增输入源时漏登记场景配置会在这里暴露，而不是静默归入测试语料。
    console.warn(`[playground] 输入源 "${source.id}" 没有场景配置，按语料处理。`);
  }
  return CORPUS_SCENE;
}

/** 唯一的场景清单：输入源顺序 + 场景分组、控制项与预设。 */
export const SCENES: readonly SceneDefinition[] = buildScenes();

function buildScenes(): SceneDefinition[] {
  const scenes: SceneDefinition[] = [];
  for (const source of SOURCES) {
    const config = configFor(source);
    scenes.push({
      ...source,
      controls: config.controls,
      preset: config.preset,
      sceneGroup: config.group,
    });
  }
  return scenes;
}

export const DEFAULT_SCENE_ID = DEFAULT_SOURCE_ID;

export function hasScene(id: string): boolean {
  return SCENES.some((scene) => scene.id === id);
}

export function sceneOf(id: string): SceneDefinition {
  return SCENES.find((scene) => scene.id === id) ?? SCENES[0]!;
}

/** 场景菜单分组；与场景清单同源，不会出现“有输入源但没有分组”的情况。 */
export interface SceneMenuGroup {
  readonly id: SceneGroupId;
  readonly title: string;
  readonly items: readonly SceneDefinition[];
}

export function buildSceneMenu(scenes: readonly SceneDefinition[]): readonly SceneMenuGroup[] {
  return SCENE_GROUP_ORDER.map((group) => ({
    id: group,
    title: SCENE_GROUP_LABELS[group],
    items: scenes.filter((scene) => scene.sceneGroup === group),
  }));
}
