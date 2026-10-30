import type { Element, ElementContent, Root, RootContent } from "hast";
import type { WikitextLabels } from "../ast/labels";
import type {
  WikitextDiagnostic,
  WikitextHeadingIdStrategy,
  WikitextHeadingInfo,
  WikitextResolvedPolicy,
} from "../ast/model";
import { hasHastClass } from "../shared/hast";
import { isExternalHref, isRelativeHref } from "../shared/url";
import { resolveSafeRel } from "./rel";
import {
  REFERENCE_BACKLINK_CLASS,
  REFERENCE_GROUP_PROPERTY,
  REFERENCE_LIST_CLASS,
  REFERENCE_PLACEHOLDER_CLASS,
  REFERENCE_SECTION_CLASS,
  referenceNoteId,
  referenceOccurrenceId,
} from "./references";
import { buildToc, TOC_DATA_PROPERTY, type TocMarker } from "./toc";
import type { WikitextTocMode } from "./types";

interface FinalizeOptions {
  readonly policy: WikitextResolvedPolicy;
  readonly labels: WikitextLabels;
  readonly headingIdStrategy: WikitextHeadingIdStrategy;
  readonly authorizedImages: ReadonlySet<string>;
  readonly diagnostics: WikitextDiagnostic[];
  /** 目录模式；`auto` 按标题数阈值生成，`marker` 表示有显式占位。 */
  readonly toc: WikitextTocMode;
  /** 自动目录所需的最少标题数。 */
  readonly tocMinHeadings: number;
  /** 目录列数。 */
  readonly tocColumns: 1 | 2 | 3;
}

export interface FinalizeResult {
  readonly hast: Root;
  readonly headings: readonly WikitextHeadingInfo[];
}

function textContent(node: ElementContent | RootContent): string {
  if (node.type === "text") {
    return node.value;
  }
  if (node.type === "element") {
    return node.children.map((child) => textContent(child)).join("");
  }
  return "";
}

/** 片段敏感字符统一编码为 `.HH`，避免 `#`、`%`、`?`、`/` 破坏片段匹配。 */
function escapeIdCharacter(character: string): string {
  const code = character.codePointAt(0) ?? 0;
  if (code >= 0x80) {
    return character;
  }
  return `.${code.toString(16).toUpperCase()}`;
}

/**
 * 生成片段安全的标题锚点：空白折叠为 `_`，控制字符移除，
 * `#`、`%`、`?`、`/` 等片段敏感字符编码为 `.HH`。
 */
function slugify(text: string): string {
  return (
    text
      .trim()
      .replace(/\s+/gu, "_")
      // oxlint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F]/gu, "")
      .replace(/[^\p{L}\p{N}\p{M}_.:-]/gu, escapeIdCharacter)
  );
}

function headingLevel(node: Element): number | undefined {
  const match = /^h([1-6])$/u.exec(node.tagName);
  return match ? Number(match[1]) : undefined;
}

/**
 * 统一决定链接的最终属性：相对地址策略、打开方式与 `rel`。
 * wikitext 链接与插件插入的链接走同一条规则。
 */
function finalizeAnchor(node: Element, options: FinalizeOptions): void {
  const properties = (node.properties ??= {});
  const rawHref = typeof properties.href === "string" ? properties.href : "";
  // 页内片段始终允许：关闭相对链接不应破坏标题、目录与引用回链。
  if (
    rawHref &&
    !rawHref.startsWith("#") &&
    isRelativeHref(rawHref) &&
    !options.policy.allowRelativeLinks
  ) {
    delete properties.href;
  }
  const href = typeof properties.href === "string" ? properties.href : "";
  const target = properties.target;
  if (
    target !== undefined &&
    target !== null &&
    String(target) !== "_blank" &&
    String(target) !== "_self"
  ) {
    delete properties.target;
  }
  if (
    (properties.target === undefined || properties.target === null) &&
    href &&
    isExternalHref(href)
  ) {
    const fallback = options.policy.externalLinkTarget;
    if (fallback) {
      properties.target = fallback;
    } else {
      delete properties.target;
    }
  }
  const rel = resolveSafeRel(properties.rel, { href, target: properties.target });
  if (rel) {
    properties.rel = rel;
  } else {
    delete properties.rel;
  }
}

type ImageOrigin = "resolver" | "source" | "plugin";

/** 按来源区分图片授权：resolver 产物、源码 HTML 与插件产物各有独立开关。 */
function imageOrigin(node: Element): ImageOrigin {
  const metadata = (
    node.data as { wikitext?: { imageSource?: unknown; origin?: unknown } } | undefined
  )?.wikitext;
  if (metadata?.imageSource === "resolver") {
    return "resolver";
  }
  return metadata?.origin === undefined ? "plugin" : "source";
}

function finalizeImage(node: Element, options: FinalizeOptions): { keep: boolean; alt: string } {
  const properties = (node.properties ??= {});
  const src = typeof properties.src === "string" ? properties.src : "";
  const alt = typeof properties.alt === "string" ? properties.alt : "";
  if (!src) {
    return { keep: false, alt };
  }
  const origin = imageOrigin(node);
  const relativeViolation = isRelativeHref(src) && !options.policy.allowRelativeImages;
  const unauthorized =
    origin === "resolver"
      ? !options.authorizedImages.has(src)
      : origin === "source"
        ? !options.policy.allowSourceImages
        : !options.policy.allowPluginImages;
  if (relativeViolation || unauthorized) {
    options.diagnostics.push({
      code: "UNAUTHORIZED_IMAGE",
      stage: "finalize",
      severity: "warning",
      message: relativeViolation
        ? "A relative image source is not allowed by the prepare policy and was removed."
        : origin === "source"
          ? "A source HTML image was removed because allowSourceImages is disabled."
          : origin === "resolver"
            ? "An image resource was not authorized by the prepared resolver and was removed."
            : "A plugin image was removed because allowPluginImages is disabled.",
      rule: "image-policy",
    });
    return { keep: false, alt };
  }
  properties.loading = "lazy";
  properties.decoding = "async";
  return { keep: true, alt };
}

function finalizeChildren(
  children: readonly ElementContent[],
  options: FinalizeOptions,
): ElementContent[] {
  const result: ElementContent[] = [];
  for (const child of children) {
    if (child.type !== "element") {
      result.push(child);
      continue;
    }
    if (child.tagName === "a") {
      finalizeAnchor(child, options);
    }
    if (child.tagName === "img") {
      const image = finalizeImage(child, options);
      if (!image.keep) {
        if (image.alt) {
          result.push({ type: "text", value: image.alt });
        }
        continue;
      }
    }
    child.children = finalizeChildren(child.children, options);
    result.push(child);
  }
  return result;
}

interface ReferenceMeta {
  readonly number: number;
  readonly group: string;
  readonly occurrence: number;
}

function referenceMeta(node: Element): ReferenceMeta | undefined {
  const metadata = (
    node.data as
      | { wikitext?: { number?: unknown; group?: unknown; occurrence?: unknown } }
      | undefined
  )?.wikitext;
  if (typeof metadata?.number !== "number") {
    return undefined;
  }
  return {
    number: metadata.number,
    group: typeof metadata.group === "string" ? metadata.group : "",
    occurrence: typeof metadata.occurrence === "number" ? metadata.occurrence : 1,
  };
}

function referenceGroupOf(node: Element): string {
  const value = node.properties?.[REFERENCE_GROUP_PROPERTY];
  return typeof value === "string" ? value : "";
}

/** 只有库生成的引用节点才带内部 data 标记；源码 HTML 无法写入该保留属性。 */
function hasReferenceMarker(node: Element): boolean {
  return typeof node.properties?.[REFERENCE_GROUP_PROPERTY] === "string";
}

function isReferenceSection(node: Element): boolean {
  return hasHastClass(node, REFERENCE_SECTION_CLASS) && hasReferenceMarker(node);
}

function isReferencePlaceholder(node: Element): boolean {
  return hasHastClass(node, REFERENCE_PLACEHOLDER_CLASS) && hasReferenceMarker(node);
}

function referenceKey(group: string, number: number): string {
  return `${group}\u0000${number}`;
}

/**
 * 把文末引用区移动到 `<references>` 占位处；没有占位的分组仍追加到文末。
 * 多个占位只使用第一个，其余占位被移除。
 */
function relocateReferences(root: Root): void {
  const sections: Element[] = [];
  let hasPlaceholder = false;
  const collect = (children: readonly ElementContent[]): void => {
    for (const child of children) {
      if (child.type !== "element") {
        continue;
      }
      if (isReferencePlaceholder(child)) {
        hasPlaceholder = true;
        continue;
      }
      if (isReferenceSection(child)) {
        sections.push(child);
        continue;
      }
      collect(child.children);
    }
  };
  collect(root.children as ElementContent[]);
  // 没有显式占位时保持引用区在文末的原始顺序（分类底栏之后不会再被移动）。
  if (!hasPlaceholder) {
    return;
  }

  const byGroup = new Map<string, Element[]>();
  for (const section of sections) {
    const group = referenceGroupOf(section);
    const queue = byGroup.get(group) ?? [];
    queue.push(section);
    byGroup.set(group, queue);
  }

  const used = new Set<Element>();
  const replace = (children: readonly ElementContent[]): ElementContent[] => {
    const result: ElementContent[] = [];
    for (const child of children) {
      if (child.type !== "element") {
        result.push(child);
        continue;
      }
      if (isReferencePlaceholder(child)) {
        const queue = byGroup.get(referenceGroupOf(child));
        const section = queue?.find((candidate) => !used.has(candidate));
        if (section) {
          used.add(section);
          result.push(section);
        }
        continue;
      }
      if (used.has(child)) {
        continue;
      }
      child.children = replace(child.children);
      result.push(child);
    }
    return result;
  };
  root.children = replace(root.children as ElementContent[]);
}

/** 在清洗之后写入引用 id 与回链，避免 id 进入清洗白名单。 */
function finalizeReferences(root: Root, labels: FinalizeOptions["labels"]): void {
  const occurrences = new Map<string, Element[]>();
  const collectOccurrences = (node: RootContent): void => {
    if (node.type !== "element") {
      return;
    }
    const meta = node.tagName === "sup" ? referenceMeta(node) : undefined;
    if (meta) {
      node.properties = {
        ...node.properties,
        id: referenceOccurrenceId(meta.number, meta.occurrence, meta.group),
      };
      const key = referenceKey(meta.group, meta.number);
      const list = occurrences.get(key) ?? [];
      list.push(node);
      occurrences.set(key, list);
    }
    for (const child of node.children) {
      collectOccurrences(child);
    }
  };
  for (const child of root.children) {
    collectOccurrences(child);
  }

  const assignNotes = (
    node: RootContent,
    inheritedGroup: string,
    inReferenceSection: boolean,
  ): void => {
    if (node.type !== "element") {
      return;
    }
    const section = isReferenceSection(node);
    const group = section ? referenceGroupOf(node) : inheritedGroup;
    if (inReferenceSection && node.tagName === "ol" && hasHastClass(node, REFERENCE_LIST_CLASS)) {
      let note = 0;
      for (const child of node.children) {
        if (child.type !== "element" || child.tagName !== "li") {
          continue;
        }
        note++;
        child.properties = { ...child.properties, id: referenceNoteId(note, group) };
        const sups = occurrences.get(referenceKey(group, note)) ?? [];
        // 恢复快照时 HAST 已带回链；先移除，避免每次恢复都追加一份。
        child.children = child.children.filter(
          (item) => !(item.type === "element" && hasHastClass(item, REFERENCE_BACKLINK_CLASS)),
        );
        for (const sup of sups) {
          const href = sup.properties?.id;
          child.children.push({
            type: "element",
            tagName: "a",
            properties: {
              className: [REFERENCE_BACKLINK_CLASS],
              href: typeof href === "string" ? `#${href}` : "#",
              role: "doc-backlink",
              ariaLabel: `${labels.reference} ${note}`,
            },
            children: [{ type: "text", value: "↑" }],
          });
        }
      }
      return;
    }
    for (const child of node.children) {
      assignNotes(child, group, inReferenceSection || section);
    }
  };
  for (const child of root.children) {
    assignNotes(child, "", false);
  }
}

function tocMarker(node: Element): TocMarker | undefined {
  const value = node.properties?.[TOC_DATA_PROPERTY];
  // `"toc"` 是已生成目录的标记，不是占位；恢复快照时保留原目录与列样式。
  return value === "auto" || value === "explicit" ? value : undefined;
}

/** 替换显式占位；放不下的占位直接移除，是否补充自动目录由调用方决定。 */
function replaceTocMarkers(
  root: Root,
  headings: readonly WikitextHeadingInfo[],
  options: FinalizeOptions,
): boolean {
  const state = { placed: false };
  const replace = (children: readonly ElementContent[]): ElementContent[] => {
    const result: ElementContent[] = [];
    for (const child of children) {
      if (child.type !== "element") {
        result.push(child);
        continue;
      }
      const marker = tocMarker(child);
      if (marker !== undefined) {
        const minimum = marker === "auto" ? options.tocMinHeadings : 1;
        if (!state.placed && headings.length >= minimum) {
          const toc = buildToc(headings, options.labels.toc, options.tocColumns);
          if (toc) {
            result.push(toc);
            state.placed = true;
          }
        }
        continue;
      }
      child.children = replace(child.children);
      result.push(child);
    }
    return result;
  };
  root.children = replace(root.children as ElementContent[]);
  return state.placed;
}

function containsHeading(node: RootContent | ElementContent): boolean {
  if (node.type !== "element") {
    return false;
  }
  return headingLevel(node) !== undefined || node.children.some((child) => containsHeading(child));
}

/**
 * 补充自动目录：在第一个标题所在的顶层块之前插入。
 * 阈值：`auto` 模式按 MediaWiki 的 4 个标题；`marker` 模式的回退只要求有标题。
 */
function insertAutoToc(
  root: Root,
  headings: readonly WikitextHeadingInfo[],
  labels: WikitextLabels,
  minimum: number,
  columns: 1 | 2 | 3,
): void {
  if (headings.length < minimum) {
    return;
  }
  const toc = buildToc(headings, labels.toc, columns);
  if (!toc) {
    return;
  }
  const index = root.children.findIndex((child) => containsHeading(child));
  if (index < 0) {
    return;
  }
  root.children.splice(index, 0, toc);
}

function collectHeadings(root: Root, strategy: WikitextHeadingIdStrategy): WikitextHeadingInfo[] {
  const headings: WikitextHeadingInfo[] = [];
  const used = new Map<string, number>();
  let section = 0;

  const visit = (node: RootContent | ElementContent): void => {
    if (node.type !== "element") {
      return;
    }
    const level = headingLevel(node);
    if (level !== undefined) {
      section++;
      const meta = (node.data as { wikitext?: { id?: string } } | undefined)?.wikitext;
      const nodeId = meta?.id ?? `heading-${section}`;
      const text = textContent(node).trim();
      const base = slugify(text) || `section-${section}`;
      if (strategy === "none") {
        headings.push({ nodeId, level, text });
      } else {
        const key = base.toLowerCase();
        const count = (used.get(key) ?? 0) + 1;
        used.set(key, count);
        const id = count === 1 ? base : `${base}_${count}`;
        node.properties = { ...node.properties, id };
        headings.push({ nodeId, level, text, id });
      }
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  for (const child of root.children) {
    visit(child);
  }
  return headings;
}

/**
 * 完成最终整理：链接与图片策略、引用 id、标题锚点以及目录。
 * 这是最终 HAST 的唯一整理点。
 */
export function finalizeHast(root: Root, options: FinalizeOptions): FinalizeResult {
  root.children = finalizeChildren(root.children as ElementContent[], options);
  relocateReferences(root);
  finalizeReferences(root, options.labels);
  const headings = collectHeadings(root, options.headingIdStrategy);
  const placed = replaceTocMarkers(root, headings, options);
  if (!placed && options.toc !== "none") {
    insertAutoToc(
      root,
      headings,
      options.labels,
      options.toc === "auto" ? options.tocMinHeadings : 1,
      options.tocColumns,
    );
  }
  return { hast: root, headings };
}
