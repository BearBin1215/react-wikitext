import type { WikitextHeadingIdStrategy } from "react-wikitext/ast";
import { PARSER_CONFIG_KEYS, type ParserConfigKey } from "@pg/parse/configs";

export const LABEL_LANGUAGES = ["zh", "en"] as const;
export type LabelLanguage = (typeof LABEL_LANGUAGES)[number];

export const VIEW_LANGS = ["none", "zh-CN", "en", "ar"] as const;
type ViewLang = (typeof VIEW_LANGS)[number];

export const VIEW_DIRS = ["none", "ltr", "rtl"] as const;
type ViewDir = (typeof VIEW_DIRS)[number];

export const EXTERNAL_LINK_TARGETS = ["_blank", "_self"] as const;
type ExternalLinkTarget = (typeof EXTERNAL_LINK_TARGETS)[number];

export const HEADING_STRATEGIES = ["instance", "mediawiki", "none"] as const;

export const COMPONENTS_MODES = ["none", "demo", "throwing"] as const;
type ComponentsMode = (typeof COMPONENTS_MODES)[number];

export const DEFAULT_HEADING_PREFIX = "wtr-heading-";
const DEFAULT_HEADING_STRATEGY: WikitextHeadingIdStrategy = "instance";
export const EXPANDED_DEPTH_OPTIONS = [0, 1, 2, 3, 4, 5] as const;

/** 验收台展示用的节点上限；与库默认值一致，库调整时需同步。 */
export const DEFAULT_MAX_NODES = 50_000;

export interface PlaygroundOptions {
  parserConfig: ParserConfigKey;
  pageName: string;
  maxSourceLength?: number;
  maxNodeCount?: number;
  labelLanguage: LabelLanguage;
  lang: ViewLang;
  dir: ViewDir;
  externalLinkTarget: ExternalLinkTarget;
  headingIdStrategy: WikitextHeadingIdStrategy;
  headingIdPrefix: string;
  expandedDepth: number;
  expandTemplates: boolean;
  expandFallback: boolean;
  linkResolver: boolean;
  imageResolver: boolean;
  componentsMode: ComponentsMode;
}

export const DEFAULT_OPTIONS: PlaygroundOptions = {
  parserConfig: "mediawiki",
  pageName: "Playground",
  labelLanguage: "zh",
  lang: "zh-CN",
  dir: "none",
  externalLinkTarget: "_blank",
  headingIdStrategy: DEFAULT_HEADING_STRATEGY,
  headingIdPrefix: DEFAULT_HEADING_PREFIX,
  expandedDepth: 2,
  expandTemplates: false,
  expandFallback: false,
  linkResolver: false,
  imageResolver: false,
  componentsMode: "none",
};

function readChoice<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = params.get(key);
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function parsePositiveInteger(value: string | null): number | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function readPositiveInt(params: URLSearchParams, key: string): number | undefined {
  return parsePositiveInteger(params.get(key));
}

function readBoolean(params: URLSearchParams, key: string): boolean {
  const value = params.get(key);
  return value === "1" || value === "true";
}

function readDepth(params: URLSearchParams): number {
  const value = params.get("depth");
  if (value === null) {
    return DEFAULT_OPTIONS.expandedDepth;
  }
  const number = Number(value);
  const allowed = EXPANDED_DEPTH_OPTIONS as readonly number[];
  return Number.isInteger(number) && allowed.includes(number)
    ? number
    : DEFAULT_OPTIONS.expandedDepth;
}

export function readOptions(params: URLSearchParams): PlaygroundOptions {
  const maxSourceLength = readPositiveInt(params, "maxSource");
  const maxNodeCount = readPositiveInt(params, "maxNodes");
  return {
    parserConfig: readChoice(params, "config", PARSER_CONFIG_KEYS, DEFAULT_OPTIONS.parserConfig),
    pageName: params.get("page") ?? DEFAULT_OPTIONS.pageName,
    ...(maxSourceLength === undefined ? {} : { maxSourceLength }),
    ...(maxNodeCount === undefined ? {} : { maxNodeCount }),
    labelLanguage: readChoice(params, "labels", LABEL_LANGUAGES, DEFAULT_OPTIONS.labelLanguage),
    lang: readChoice(params, "lang", VIEW_LANGS, DEFAULT_OPTIONS.lang),
    dir: readChoice(params, "dir", VIEW_DIRS, DEFAULT_OPTIONS.dir),
    externalLinkTarget: readChoice(
      params,
      "target",
      EXTERNAL_LINK_TARGETS,
      DEFAULT_OPTIONS.externalLinkTarget,
    ),
    headingIdStrategy: readChoice(
      params,
      "heading",
      HEADING_STRATEGIES,
      DEFAULT_OPTIONS.headingIdStrategy,
    ),
    headingIdPrefix: params.get("prefix") ?? DEFAULT_OPTIONS.headingIdPrefix,
    expandedDepth: readDepth(params),
    expandTemplates: readBoolean(params, "expand"),
    expandFallback: readBoolean(params, "fallback"),
    linkResolver: readBoolean(params, "link"),
    imageResolver: readBoolean(params, "image"),
    componentsMode: readChoice(
      params,
      "components",
      COMPONENTS_MODES,
      DEFAULT_OPTIONS.componentsMode,
    ),
  };
}

function writeIfChanged<T extends string | number>(
  params: URLSearchParams,
  key: string,
  value: T,
  fallback: T,
): void {
  if (value !== fallback) {
    params.set(key, String(value));
  }
}

export function writeOptions(params: URLSearchParams, options: PlaygroundOptions): void {
  writeIfChanged(params, "config", options.parserConfig, DEFAULT_OPTIONS.parserConfig);
  writeIfChanged(params, "page", options.pageName, DEFAULT_OPTIONS.pageName);
  if (options.maxSourceLength !== undefined) {
    params.set("maxSource", String(options.maxSourceLength));
  }
  if (options.maxNodeCount !== undefined) {
    params.set("maxNodes", String(options.maxNodeCount));
  }
  writeIfChanged(params, "labels", options.labelLanguage, DEFAULT_OPTIONS.labelLanguage);
  writeIfChanged(params, "lang", options.lang, DEFAULT_OPTIONS.lang);
  writeIfChanged(params, "dir", options.dir, DEFAULT_OPTIONS.dir);
  writeIfChanged(params, "target", options.externalLinkTarget, DEFAULT_OPTIONS.externalLinkTarget);
  writeIfChanged(params, "heading", options.headingIdStrategy, DEFAULT_OPTIONS.headingIdStrategy);
  writeIfChanged(params, "prefix", options.headingIdPrefix, DEFAULT_OPTIONS.headingIdPrefix);
  writeIfChanged(params, "depth", options.expandedDepth, DEFAULT_OPTIONS.expandedDepth);
  // 场景开关显式写 0/1：关闭状态也要能通过刷新与分享保留。
  params.set("expand", options.expandTemplates ? "1" : "0");
  params.set("fallback", options.expandFallback ? "1" : "0");
  params.set("link", options.linkResolver ? "1" : "0");
  params.set("image", options.imageResolver ? "1" : "0");
  writeIfChanged(params, "components", options.componentsMode, DEFAULT_OPTIONS.componentsMode);
}
