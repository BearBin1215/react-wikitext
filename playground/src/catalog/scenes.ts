import { DEFAULT_OPTIONS, type PlaygroundOptions } from "@pg/state/options";

/** 场景分组的展示顺序；与输入源目录一起构成唯一的场景清单。 */
export const SCENE_GROUP_ORDER = [
  "basics",
  "extensions",
  "templates",
  "boundary",
  "corpus",
] as const;

export type SceneGroupId = (typeof SCENE_GROUP_ORDER)[number];

export const SCENE_GROUP_LABELS: Record<SceneGroupId, string> = {
  basics: "基础渲染",
  extensions: "扩展点",
  templates: "模板",
  boundary: "边界与性能",
  corpus: "测试语料",
};

/** 场景面板里按用途手工编排的控制项，不是通用参数表的映射。 */
export type SceneControlId =
  | "expand"
  | "expandFallback"
  | "linkResolver"
  | "imageResolver"
  | "components"
  | "maxSource";

export interface SceneConfig {
  readonly group: SceneGroupId;
  readonly controls: readonly SceneControlId[];
  /** 进入场景时应用的组合；未列出的场景级选项回到库默认值。 */
  readonly preset: Partial<PlaygroundOptions>;
}

/**
 * 输入源到场景配置的映射。新增输入源必须在这里登记，
 * 否则 `catalog/index.ts` 的开发态断言会提示，而不是静默归入测试语料。
 */
export const SCENE_CONFIGS: Readonly<Record<string, SceneConfig>> = {
  basic: { group: "basics", controls: [], preset: {} },
  html: { group: "basics", controls: [], preset: {} },
  freeform: { group: "basics", controls: [], preset: {} },
  resolvers: {
    group: "extensions",
    controls: ["linkResolver", "imageResolver"],
    preset: { linkResolver: true, imageResolver: true },
  },
  components: {
    group: "extensions",
    controls: ["components"],
    preset: { componentsMode: "demo" },
  },
  "render-error": {
    group: "extensions",
    controls: ["components"],
    preset: { componentsMode: "throwing" },
  },
  templates: {
    group: "templates",
    controls: ["expand", "expandFallback"],
    preset: { expandTemplates: true },
  },
  security: { group: "boundary", controls: [], preset: {} },
  crlf: { group: "boundary", controls: [], preset: {} },
  limits: {
    group: "boundary",
    controls: ["maxSource"],
    preset: { maxSourceLength: 800 },
  },
  large: { group: "boundary", controls: [], preset: {} },
};

/** 测试语料没有手工场景配置时的默认分组。 */
export const CORPUS_SCENE: SceneConfig = { group: "corpus", controls: [], preset: {} };

/** 场景级选项与 URL 参数名，用于区分“进入场景”和“复现链接显式指定”。 */
const SCENE_PARAMS = {
  expandTemplates: "expand",
  expandFallback: "fallback",
  linkResolver: "link",
  imageResolver: "image",
  componentsMode: "components",
  maxSourceLength: "maxSource",
} as const;

/**
 * 切换场景后的选项：场景级选项回到该场景的组合，全局与高级选项保持不变。
 * explicitParams 用于首屏：URL 显式写出的场景参数优先于场景预设。
 */
export function resolveSceneOptions(
  id: string,
  current: PlaygroundOptions,
  explicitParams: ReadonlySet<string> = new Set(),
): PlaygroundOptions {
  const preset = SCENE_CONFIGS[id]?.preset ?? {};
  const next = { ...current };
  if (!explicitParams.has(SCENE_PARAMS.expandTemplates)) {
    next.expandTemplates = preset.expandTemplates ?? DEFAULT_OPTIONS.expandTemplates;
  }
  if (!explicitParams.has(SCENE_PARAMS.expandFallback)) {
    next.expandFallback = preset.expandFallback ?? DEFAULT_OPTIONS.expandFallback;
  }
  if (!explicitParams.has(SCENE_PARAMS.linkResolver)) {
    next.linkResolver = preset.linkResolver ?? DEFAULT_OPTIONS.linkResolver;
  }
  if (!explicitParams.has(SCENE_PARAMS.imageResolver)) {
    next.imageResolver = preset.imageResolver ?? DEFAULT_OPTIONS.imageResolver;
  }
  if (!explicitParams.has(SCENE_PARAMS.componentsMode)) {
    next.componentsMode = preset.componentsMode ?? DEFAULT_OPTIONS.componentsMode;
  }
  if (!explicitParams.has(SCENE_PARAMS.maxSourceLength)) {
    next.maxSourceLength = preset.maxSourceLength ?? DEFAULT_OPTIONS.maxSourceLength;
  }
  return next;
}
