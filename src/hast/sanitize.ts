import { decodeHTML } from "entities";
import { sanitize, type Schema } from "hast-util-sanitize";
import type { Properties, Root } from "hast";
import type { WikitextAttribute, WikitextResolvedPolicy } from "../ast/model";
import type { WikitextDiagnostic } from "../ast/model";
import { WIKITEXT_TAG_NAMES } from "../shared/html-tags";
import { isRelativeHref } from "../shared/url";
import { REFERENCE_GROUP_PROPERTY } from "./references";
import { TOC_DATA_PROPERTY } from "./toc";

// URL 校验前需要移除控制字符，因此正则直接匹配这些码点。
// oxlint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/gu;
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const ALLOWED_IMAGE_PROTOCOLS = new Set(["http:", "https:"]);

function clean(value: string): string {
  return decodeHTML(value).replace(CONTROL_CHARS, "").trim();
}

function protocolRelative(value: string): string {
  return value.startsWith("//") ? `https:${value}` : value;
}

interface SanitizeUrlOptions {
  readonly allowRelative?: boolean;
  readonly protocols: ReadonlySet<string>;
}

function sanitizeUrl(
  value: string,
  { allowRelative, protocols }: SanitizeUrlOptions,
): string | null {
  const cleaned = protocolRelative(clean(value).replace(/\\/gu, "/"));
  if (!cleaned) {
    return null;
  }
  if (allowRelative && isRelativeHref(cleaned)) {
    return cleaned;
  }
  try {
    const url = new URL(cleaned);
    return protocols.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** 链接地址的校验选项。 */
export interface SanitizeHrefOptions {
  /** 是否允许相对地址。 */
  readonly allowRelative?: boolean;
}

/**
 * 校验链接地址；协议不在白名单内时返回 null。
 * @param value 原始地址。
 * @param options 校验选项。
 */
export function sanitizeHref(value: string, options: SanitizeHrefOptions = {}): string | null {
  return sanitizeUrl(value, {
    allowRelative: options.allowRelative,
    protocols: ALLOWED_EXTERNAL_PROTOCOLS,
  });
}

/** 图片地址的校验选项。 */
export interface SanitizeImageOptions {
  /** 是否允许相对地址。 */
  readonly allowRelative?: boolean;
}

/**
 * 校验图片地址；只接受 http、https 或相对地址。
 * @param value 原始地址。
 * @param options 校验选项。
 */
export function sanitizeImageUrl(value: string, options: SanitizeImageOptions = {}): string | null {
  return sanitizeUrl(value, {
    allowRelative: options.allowRelative,
    protocols: ALLOWED_IMAGE_PROTOCOLS,
  });
}

/** 源码属性名 → HAST/React 属性名；未列出的属性同名映射。 */
const ATTRIBUTE_PROPERTIES: Readonly<Record<string, string>> = {
  class: "className",
  colspan: "colSpan",
  rowspan: "rowSpan",
  cellpadding: "cellPadding",
  cellspacing: "cellSpacing",
  bgcolor: "bgColor",
  valign: "vAlign",
  nowrap: "noWrap",
  "aria-label": "ariaLabel",
};

function propertyNameOf(attribute: string): string {
  return ATTRIBUTE_PROPERTIES[attribute] ?? attribute;
}

const COMMON_HTML_ATTRIBUTES = new Set(["class", "title", "dir", "lang", "style"]);

const TABLE_ATTRIBUTES = new Set([
  ...COMMON_HTML_ATTRIBUTES,
  "align",
  "bgcolor",
  "border",
  "cellpadding",
  "cellspacing",
  "frame",
  "rules",
  "summary",
  "width",
]);

const TABLE_ROW_ATTRIBUTES = new Set([...COMMON_HTML_ATTRIBUTES, "align", "valign", "bgcolor"]);

const TABLE_CELL_ATTRIBUTES = new Set([
  ...COMMON_HTML_ATTRIBUTES,
  "scope",
  "colspan",
  "rowspan",
  "abbr",
  "headers",
  "axis",
  "width",
  "height",
  "bgcolor",
  "nowrap",
  "align",
  "valign",
]);

const TABLE_CAPTION_ATTRIBUTES = new Set([...COMMON_HTML_ATTRIBUTES, "align"]);

const IMAGE_ATTRIBUTES = new Set([...COMMON_HTML_ATTRIBUTES, "src", "alt", "width", "height"]);

const TABLE_TAG_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  table: TABLE_ATTRIBUTES,
  tr: TABLE_ROW_ATTRIBUTES,
  td: TABLE_CELL_ATTRIBUTES,
  th: TABLE_CELL_ATTRIBUTES,
  caption: TABLE_CAPTION_ATTRIBUTES,
};

const DEFAULT_HTML_ATTRIBUTES = new Set([
  ...TABLE_ATTRIBUTES,
  ...TABLE_ROW_ATTRIBUTES,
  ...TABLE_CELL_ATTRIBUTES,
  ...TABLE_CAPTION_ATTRIBUTES,
]);

const TABLE_TAGS = new Set(Object.keys(TABLE_TAG_ATTRIBUTES));
const DATA_ATTRIBUTE = /^data-[a-z][a-z0-9-]*$/u;

/** 把 HAST 的 data 属性名还原为源码属性名，供保留名单与源码过滤共用。 */
function dataAttributeName(property: string): string {
  return property.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

const RESERVED_DATA_ATTRIBUTES = new Set([
  "data-node-id",
  "data-node-type",
  "data-wikitext",
  "data-parsoid",
  "data-mw",
  dataAttributeName(TOC_DATA_PROPERTY),
  dataAttributeName(REFERENCE_GROUP_PROPERTY),
]);
const RESERVED_DATA_PREFIXES = ["data-mw-"];
const CLASS_TOKEN = /^[A-Za-z0-9_-]+$/u;
const LANG_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;

function clampSpan(value: string): string | undefined {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number < 1) {
    return undefined;
  }
  return String(Math.min(number, 1_000));
}

function allowedAttributes(tag: string | undefined): ReadonlySet<string> {
  if (!tag) {
    return DEFAULT_HTML_ATTRIBUTES;
  }
  const name = tag.toLowerCase();
  if (name === "img") {
    return IMAGE_ATTRIBUTES;
  }
  return TABLE_TAG_ATTRIBUTES[name] ?? COMMON_HTML_ATTRIBUTES;
}

function isAllowedDataAttribute(name: string, tag: string | undefined): boolean {
  return (
    (tag === undefined || TABLE_TAGS.has(tag.toLowerCase())) &&
    DATA_ATTRIBUTE.test(name) &&
    !RESERVED_DATA_ATTRIBUTES.has(name) &&
    !RESERVED_DATA_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

/** 允许的内联样式属性；只保留排版与外观相关声明。 */
const SAFE_STYLE_PROPERTIES = new Set([
  "color",
  "background",
  "background-color",
  "background-image",
  "text-align",
  "vertical-align",
  "font",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "font-variant",
  "text-decoration",
  "text-transform",
  "white-space",
  "line-height",
  "letter-spacing",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "border",
  "border-width",
  "border-style",
  "border-color",
  "border-radius",
  "border-collapse",
  "border-spacing",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "float",
  "clear",
  "opacity",
]);

/** 明显可执行或可加载远程资源的值；命中即整条声明丢弃。 */
const UNSAFE_STYLE_VALUE =
  /(?:url\s*\(|image-set\s*\(|cross-fade\s*\(|image\s*\(|expression\s*\(|@import|var\s*\(|env\s*\(|behavior\s*:|[\\<>])/iu;

export interface SanitizedStyle {
  readonly value?: string;
  readonly dropped: readonly string[];
}

/** 解析并过滤内联样式声明；只保留白名单属性与安全值。 */
export function sanitizeStyleValue(input: string): SanitizedStyle {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const declaration of input.split(";")) {
    const trimmed = declaration.trim();
    if (!trimmed) {
      continue;
    }
    const colon = trimmed.indexOf(":");
    if (colon <= 0) {
      dropped.push(trimmed);
      continue;
    }
    const name = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed.slice(colon + 1).trim();
    if (
      !SAFE_STYLE_PROPERTIES.has(name) ||
      !value ||
      UNSAFE_STYLE_VALUE.test(value) ||
      /!important/iu.test(value)
    ) {
      dropped.push(trimmed);
      continue;
    }
    kept.push(`${name}: ${value}`);
  }
  return { ...(kept.length > 0 ? { value: kept.join("; ") } : {}), dropped };
}

interface SanitizeAttributeOptions {
  /** 非法或不受支持的样式声明；由调用方转换成诊断。 */
  readonly onStyleDropped?: (dropped: readonly string[]) => void;
}

/** 清理源码 HTML 的属性；结果交给 {@link sanitizedAttributesToProps} 转换成 React 属性名。 */
function sanitizeHtmlAttributes(
  attributes: readonly WikitextAttribute[],
  tag?: string,
  options: SanitizeAttributeOptions = {},
): Record<string, string> {
  const allowed = allowedAttributes(tag);
  const result: Record<string, string> = {};
  for (const { name, value } of attributes) {
    const key = name.toLowerCase();
    const isData = isAllowedDataAttribute(key, tag);
    if (!allowed.has(key) && !isData) {
      continue;
    }
    if (value === null) {
      if (key === "nowrap") {
        result[key] = "";
      }
      continue;
    }
    switch (key) {
      case "class": {
        const tokens = value.split(/\s+/u).filter((token) => CLASS_TOKEN.test(token));
        if (tokens.length > 0) {
          result[key] = tokens.join(" ");
        }
        break;
      }
      case "dir":
        if (["ltr", "rtl", "auto"].includes(value)) {
          result[key] = value;
        }
        break;
      case "lang":
        if (LANG_TAG.test(value)) {
          result[key] = value;
        }
        break;
      case "style": {
        const style = sanitizeStyleValue(value);
        if (style.value) {
          result[key] = style.value;
        }
        if (style.dropped.length > 0) {
          options.onStyleDropped?.(style.dropped);
        }
        break;
      }
      case "colspan":
      case "rowspan": {
        const span = clampSpan(value);
        if (span) {
          result[key] = span;
        }
        break;
      }
      default:
        result[key] = value;
    }
  }
  return result;
}

function dataPropertyName(name: string): string {
  return name.replace(/-([a-z0-9])/gu, (_match, letter: string) => letter.toUpperCase());
}

/** 把清理后的 HTML 属性转换成 HAST/React 需要的属性名。 */
export function sanitizedAttributesToProps(
  attributes: readonly WikitextAttribute[],
  tag?: string,
  options: SanitizeAttributeOptions = {},
): Properties {
  const sanitized = sanitizeHtmlAttributes(attributes, tag, options);
  const properties: Properties = {};
  for (const [name, value] of Object.entries(sanitized)) {
    switch (name) {
      case "class":
        properties.className = value.split(/\s+/u);
        break;
      case "colspan":
        properties.colSpan = Number.parseInt(value, 10);
        break;
      case "rowspan":
        properties.rowSpan = Number.parseInt(value, 10);
        break;
      case "headers":
        properties.headers = value.split(/\s+/u);
        break;
      case "cellpadding":
        properties.cellPadding = value;
        break;
      case "cellspacing":
        properties.cellSpacing = value;
        break;
      case "bgcolor":
        properties.bgColor = value;
        break;
      case "valign":
        properties.vAlign = value;
        break;
      case "nowrap":
        properties.noWrap = true;
        break;
      default:
        properties[DATA_ATTRIBUTE.test(name) ? dataPropertyName(name) : name] = value;
    }
  }
  return properties;
}

/**
 * 把图片尺寸限制在合理范围内。
 * @param value 原始尺寸；未提供时返回 undefined。
 */
export function clampDimension(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(Math.max(Math.round(value), 1), 4_096);
}

// 源码 HTML 与插件生成的 class 统一按安全字符集过滤。
const CLASS_DEFINITION: [string, RegExp] = ["className", /^[A-Za-z0-9_-]+$/u];

const BASE_ATTRIBUTES = ["title", "dir", "lang", "style", "data*"];

/**
 * 由源码属性表派生 schema 中该标签的属性名。
 * 源码 HTML 与生成节点共用同一份名称表，避免两份手写清单不一致。
 */
function extraProperties(tag: string, generated: readonly string[]): string[] {
  const source = TABLE_TAG_ATTRIBUTES[tag] ?? COMMON_HTML_ATTRIBUTES;
  const names = new Set<string>();
  for (const attribute of source) {
    if (attribute === "class") {
      continue;
    }
    names.add(propertyNameOf(attribute));
  }
  for (const property of generated) {
    names.add(property);
  }
  return [...names];
}

/** 内部 schema，不对外暴露，避免它成为另一个不受版本保护的标签白名单。 */
function createHastSanitizeSchema(policy: WikitextResolvedPolicy): Schema {
  const attributes: NonNullable<Schema["attributes"]> = {
    "*": [CLASS_DEFINITION, ...BASE_ATTRIBUTES],
    a: [
      CLASS_DEFINITION,
      ...extraProperties("a", ["href", "rel", "target", "ariaLabel"]),
      ...BASE_ATTRIBUTES,
    ],
    img: [
      CLASS_DEFINITION,
      ...extraProperties("img", ["src", "alt", "width", "height", "loading", "decoding"]),
      ...BASE_ATTRIBUTES,
    ],
    td: [CLASS_DEFINITION, ...extraProperties("td", []), ...BASE_ATTRIBUTES],
    th: [CLASS_DEFINITION, ...extraProperties("th", []), ...BASE_ATTRIBUTES],
    table: [CLASS_DEFINITION, ...extraProperties("table", []), ...BASE_ATTRIBUTES],
    caption: [CLASS_DEFINITION, ...extraProperties("caption", []), ...BASE_ATTRIBUTES],
    tr: [CLASS_DEFINITION, ...extraProperties("tr", []), ...BASE_ATTRIBUTES],
    tbody: [CLASS_DEFINITION],
    thead: [CLASS_DEFINITION],
    tfoot: [CLASS_DEFINITION],
    section: [CLASS_DEFINITION, "role", ...BASE_ATTRIBUTES],
    details: [CLASS_DEFINITION, "open", ...BASE_ATTRIBUTES],
    summary: [CLASS_DEFINITION, ...BASE_ATTRIBUTES],
    figure: [CLASS_DEFINITION, "typeof", ...BASE_ATTRIBUTES],
    figcaption: [CLASS_DEFINITION, ...BASE_ATTRIBUTES],
    div: [CLASS_DEFINITION, "role", "ariaLabel", ...BASE_ATTRIBUTES],
    span: [CLASS_DEFINITION, "role", "typeof", ...BASE_ATTRIBUTES],
    ul: [CLASS_DEFINITION, "role", ...BASE_ATTRIBUTES],
    ol: [CLASS_DEFINITION, "role", ...BASE_ATTRIBUTES],
    li: [CLASS_DEFINITION, ...BASE_ATTRIBUTES],
    code: [CLASS_DEFINITION, ...BASE_ATTRIBUTES],
    pre: [CLASS_DEFINITION, ...BASE_ATTRIBUTES],
    sup: [CLASS_DEFINITION, ...BASE_ATTRIBUTES],
    hr: [CLASS_DEFINITION, "data*"],
  };
  return {
    allowComments: false,
    allowDoctypes: false,
    ancestors: null,
    clobber: [],
    clobberPrefix: "",
    protocols: {
      href: ["http", "https", "mailto"],
      src: ["http", "https"],
    },
    required: {},
    strip: [...policy.stripTags],
    tagNames: [...WIKITEXT_TAG_NAMES, ...policy.extraTags].filter(
      (tag) => !policy.stripTags.includes(tag),
    ),
    attributes,
  };
}

/** 过滤清洗后残留的内联样式；插件写入的 style 也按同一白名单处理。 */
function sanitizeHastStyles(root: Root, diagnostics: WikitextDiagnostic[] | undefined): void {
  const visit = (node: Root["children"][number]): void => {
    if (node.type !== "element") {
      return;
    }
    const properties = node.properties;
    const style = properties?.style;
    if (style !== undefined) {
      const raw = typeof style === "string" ? style : "";
      if (!raw) {
        delete properties!.style;
      } else {
        const result = sanitizeStyleValue(raw);
        if (result.value) {
          properties!.style = result.value;
        } else {
          delete properties!.style;
        }
        if (result.dropped.length > 0) {
          const location = (node.data as { wikitext?: { origin?: unknown } } | undefined)?.wikitext
            ?.origin;
          diagnostics?.push({
            code: "STYLE_DECLARATION_DROPPED",
            stage: "sanitize",
            severity: "warning",
            message: `Dropped unsupported inline style declaration: ${result.dropped.join(", ")}.`,
            ...(location ? { location: location as WikitextDiagnostic["location"] } : {}),
          });
        }
      }
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  for (const child of root.children) {
    visit(child);
  }
}

/**
 * 按安全策略清洗 HAST。
 * @param root 待清洗的 HAST。
 * @param policy 已解析的安全策略。
 * @param diagnostics 清洗阶段收集诊断的可写数组。
 */
export function sanitizeHast(
  root: Root,
  policy: WikitextResolvedPolicy,
  diagnostics?: WikitextDiagnostic[],
): Root {
  const sanitized = sanitize(root, createHastSanitizeSchema(policy)) as Root;
  sanitizeHastStyles(sanitized, diagnostics);
  return sanitized;
}
