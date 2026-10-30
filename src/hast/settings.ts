import { WikitextPrepareError } from "../ast/errors";
import { resolveWikitextLabels, type WikitextLabels } from "../ast/labels";
import type { WikitextHeadingIdStrategy, WikitextResolvedPolicy } from "../ast/model";
import {
  DEFAULT_PREPARE_POLICY,
  type WikitextHastHandlers,
  type WikitextImageResolver,
  type WikitextLinkResolver,
  type WikitextPrepareOptions,
  type WikitextResolvedTocSettings,
  type WikitextTocOptions,
} from "./types";

/** 已补齐默认值的准备设置。 */
export interface ResolvedPrepareSettings {
  readonly policy: WikitextResolvedPolicy;
  readonly labels: WikitextLabels;
  readonly headingIdStrategy: WikitextHeadingIdStrategy;
  /** 目录开关、阈值与列数。 */
  readonly toc: WikitextResolvedTocSettings;
  readonly resolveLink?: WikitextLinkResolver;
  readonly resolveImage?: WikitextImageResolver;
  readonly handlers?: WikitextHastHandlers;
}

/** 设置输入；插件列表由调用方调度，不属于设置。 */
type PrepareSettingsInput = Omit<WikitextPrepareOptions, "wikitextPlugins" | "rehypePlugins">;

const HEADING_ID_STRATEGIES = new Set<WikitextHeadingIdStrategy>(["instance", "mediawiki", "none"]);
const POLICY_FLAGS = [
  "allowRelativeLinks",
  "allowRelativeImages",
  "allowPluginImages",
  "allowSourceImages",
] as const;
const POLICY_LISTS = ["extraTags", "stripTags"] as const;
const LINK_TARGETS = new Set(["_blank", "_self"]);
const LABEL_KEYS = [
  "templateNotExpanded",
  "parserFunctionNotEvaluated",
  "filePlaceholder",
  "reference",
  "toc",
  "categories",
  "unknownNode",
  "redirectTo",
  "blockedLink",
  "blockedHtml",
  "renderFailed",
  "nestedTableUnsupported",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidOption(message: string): never {
  throw new WikitextPrepareError("PREPARE_FAILED", `Invalid prepare option: ${message}`, {
    stage: "prepare",
  });
}

function validatePolicy(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    invalidOption('"policy" must be an object.');
  }
  for (const flag of POLICY_FLAGS) {
    const current = value[flag];
    if (current !== undefined && typeof current !== "boolean") {
      invalidOption(`"policy.${flag}" must be a boolean.`);
    }
  }
  const target = value.externalLinkTarget;
  if (
    target !== undefined &&
    target !== null &&
    !(typeof target === "string" && LINK_TARGETS.has(target))
  ) {
    invalidOption('"policy.externalLinkTarget" must be "_blank", "_self" or null.');
  }
  for (const list of POLICY_LISTS) {
    const current = value[list];
    if (
      current !== undefined &&
      !(Array.isArray(current) && current.every((item) => typeof item === "string"))
    ) {
      invalidOption(`"policy.${list}" must be an array of strings.`);
    }
  }
}

function validateLabels(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    invalidOption('"labels" must be an object.');
  }
  for (const key of LABEL_KEYS) {
    const current = value[key];
    if (current !== undefined && typeof current !== "string") {
      invalidOption(`"labels.${key}" must be a string.`);
    }
  }
}

/** 默认目录设置；与 MediaWiki 的 4 个标题阈值一致。 */
export const DEFAULT_TOC_SETTINGS: WikitextResolvedTocSettings = Object.freeze({
  enabled: true,
  minHeadings: 4,
  columns: 1,
});

/** 校验目录选项；非法字段在准备阶段统一失败。 */
export function resolveTocSettings(
  value: false | WikitextTocOptions | undefined,
): WikitextResolvedTocSettings {
  if (value === undefined) {
    return DEFAULT_TOC_SETTINGS;
  }
  if (value === false) {
    return { ...DEFAULT_TOC_SETTINGS, enabled: false };
  }
  if (!isRecord(value)) {
    invalidOption('"toc" must be false or an object.');
  }
  const minHeadings = value.minHeadings;
  if (
    minHeadings !== undefined &&
    (!Number.isSafeInteger(minHeadings) || (minHeadings as number) < 0)
  ) {
    invalidOption('"toc.minHeadings" must be a non-negative safe integer.');
  }
  const columns = value.columns;
  if (columns !== undefined && columns !== 1 && columns !== 2 && columns !== 3) {
    invalidOption('"toc.columns" must be 1, 2 or 3.');
  }
  return {
    enabled: true,
    minHeadings:
      minHeadings === undefined ? DEFAULT_TOC_SETTINGS.minHeadings : (minHeadings as number),
    columns: columns === undefined ? DEFAULT_TOC_SETTINGS.columns : columns,
  };
}

function validateHandlers(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value) || !Object.values(value).every((handler) => typeof handler === "function")) {
    invalidOption('"handlers" must map semantic node types to functions.');
  }
}

function validateSettings(options: PrepareSettingsInput): void {
  validatePolicy(options.policy);
  validateLabels(options.labels);
  validateHandlers(options.handlers);
  resolveTocSettings(options.toc);
  const strategy = options.headingIdStrategy;
  if (strategy !== undefined && !HEADING_ID_STRATEGIES.has(strategy)) {
    invalidOption('"headingIdStrategy" must be "instance", "mediawiki" or "none".');
  }
  for (const resolver of ["resolveLink", "resolveImage"] as const) {
    const current = options[resolver];
    if (current !== undefined && typeof current !== "function") {
      invalidOption(`"${resolver}" must be a function.`);
    }
  }
}

/**
 * 把调用方传入的设置补全为完整值；不读取插件列表。
 * 非法字段在这里统一失败，避免在清洗或转换深处抛出原生错误。
 * @param options 准备设置。
 */
export function resolvePrepareSettings(
  options: PrepareSettingsInput = {},
): ResolvedPrepareSettings {
  if (options === null || typeof options !== "object") {
    invalidOption("settings must be a plain object.");
  }
  validateSettings(options);
  return {
    policy: { ...DEFAULT_PREPARE_POLICY, ...options.policy },
    labels: resolveWikitextLabels(options.labels),
    headingIdStrategy: options.headingIdStrategy ?? "instance",
    toc: resolveTocSettings(options.toc),
    ...(options.resolveLink === undefined ? {} : { resolveLink: options.resolveLink }),
    ...(options.resolveImage === undefined ? {} : { resolveImage: options.resolveImage }),
    ...(options.handlers === undefined ? {} : { handlers: options.handlers }),
  };
}
