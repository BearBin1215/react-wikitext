import type { Element, ElementContent, Properties, Text } from "hast";
import {
  isWikitextParentNode,
  type WikitextAttribute,
  type WikitextCategory,
  type WikitextDiagnostic,
  type WikitextDiagnosticCode,
  type WikitextExtension,
  type WikitextFile,
  type WikitextHtmlElement,
  type WikitextLink,
  type WikitextNode,
  type WikitextReference,
} from "../ast/model";
import { getFileParameters } from "../ast/helpers";
import { getSourceText } from "../ast/query";
import { fileLayoutIsBlock } from "../ast/file-options";
import {
  REFERENCE_COLUMNS_CLASS,
  REFERENCE_GROUP_PROPERTY,
  REFERENCE_LIST_CLASS,
  REFERENCE_PLACEHOLDER_CLASS,
  REFERENCE_SECTION_CLASS,
  REFERENCE_TEXT_CLASS,
  REFERENCE_WRAP_CLASS,
  referenceGroupName,
  referenceNoteId,
} from "./references";
import { applyTableLayout } from "./tableLayout";
import { TOC_DATA_PROPERTY, TOC_PLACEHOLDER_CLASS } from "./toc";
import {
  clampDimension,
  sanitizeHref,
  sanitizeImageUrl,
  sanitizedAttributesToProps,
} from "./sanitize";
import type {
  WikitextHastData,
  WikitextHastHandler,
  WikitextHastMeta,
  WikitextToHastContext,
  WikitextToHastInput,
  WikitextToHastResult,
  WikitextTocMode,
} from "./types";

const REFERENCE_STATE = Symbol("wikitext.references");
const LINK_STATE = Symbol("wikitext.links");
const TOC_STATE = Symbol("wikitext.toc");

interface ReferenceEntry {
  readonly node: WikitextReference;
  readonly number: number;
  readonly group: string;
  /** Cite 1.43 的全局 key：命名引用首次出现时分配，重复引用不增加。 */
  readonly key: number;
  readonly name?: string;
  occurrences: number;
}

interface ReferenceGroupState {
  readonly name: string;
  readonly entries: ReferenceEntry[];
  readonly definitions: Map<string, ReferenceEntry>;
}

interface ReferenceState {
  readonly groups: Map<string, ReferenceGroupState>;
  buildingList: boolean;
  nextKey: number;
}

interface LinkState {
  nextAutonumber: number;
}

interface TocState {
  readonly mode: WikitextTocMode;
}

interface SymbolScan {
  readonly categories: WikitextCategory[];
  readonly toc: boolean;
  readonly notoc: boolean;
  readonly forcetoc: boolean;
}

type BuildContext = WikitextToHastContext & {
  readonly [REFERENCE_STATE]: ReferenceState;
  readonly [LINK_STATE]: LinkState;
  readonly [TOC_STATE]: TocState;
  readonly authorizedImages: Set<string>;
  readonly diagnostics: WikitextDiagnostic[];
  readonly convert: (node: WikitextNode) => ElementContent | ElementContent[] | null;
  readonly convertChildren: (nodes: readonly WikitextNode[]) => ElementContent[];
};

function mark(node: WikitextNode): { wikitext: WikitextHastMeta } {
  return {
    wikitext: {
      id: node.id,
      type: node.type,
      ...(node.origin ? { origin: node.origin } : {}),
      ...(node.origin ? {} : { generated: true }),
    },
  };
}

function textNode(value: string, data?: WikitextHastData): Text {
  return { type: "text", value, ...(data ? { data } : {}) };
}

function element(
  tagName: string,
  properties: Properties,
  children: ElementContent[],
  node?: WikitextNode,
): Element {
  return {
    type: "element",
    tagName,
    properties,
    children,
    ...(node ? { data: mark(node) } : {}),
  };
}

function classNames(...names: string[]): string[] {
  return names.flatMap((name) => name.split(/\s+/u)).filter(Boolean);
}

function withClassName(properties: Properties, ...names: string[]): Properties {
  return {
    ...properties,
    className: classNames(...names, ...((properties.className as string[] | undefined) ?? [])),
  };
}

function sourceOf(context: BuildContext, node: WikitextNode): string {
  return getSourceText(context.document, node);
}

/** 为一次明确的降级追加诊断；位置与来源直接取自语义节点。 */
function reportDegrade(
  context: BuildContext,
  node: WikitextNode,
  code: WikitextDiagnosticCode,
  message: string,
  severity: WikitextDiagnostic["severity"] = "warning",
): void {
  context.reportDiagnostic({
    code,
    stage: "hast",
    severity,
    message,
    ...(node.origin ? { origin: node.origin } : {}),
    ...(node.position ? { position: node.position } : {}),
  });
}

/** 源码属性转换；被丢弃的样式声明同时产生诊断。 */
function sourceProperties(
  context: BuildContext,
  node: WikitextNode & { readonly attributes: readonly WikitextAttribute[] },
  tag: string,
): Properties {
  return sanitizedAttributesToProps(node.attributes, tag, {
    onStyleDropped: (dropped) =>
      reportDegrade(
        context,
        node,
        "STYLE_DECLARATION_DROPPED",
        `Dropped unsupported inline style declaration: ${dropped.join(", ")}.`,
      ),
  });
}

const OPAQUE_SYMBOL_TYPES = new Set(["template", "parserFunction", "argument"]);

function scanSymbols(root: WikitextNode): SymbolScan {
  const categories: WikitextCategory[] = [];
  let toc = false;
  let notoc = false;
  let forcetoc = false;
  const visit = (node: WikitextNode): void => {
    if (OPAQUE_SYMBOL_TYPES.has(node.type)) {
      return;
    }
    if (node.type === "category") {
      if (node.target.trim()) {
        categories.push(node);
      }
      return;
    }
    if (node.type === "behaviorSwitch") {
      const name = node.name.toLowerCase();
      toc ||= name === "toc";
      notoc ||= name === "notoc";
      forcetoc ||= name === "forcetoc";
      return;
    }
    if (isWikitextParentNode(node)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  visit(root);
  return { categories, toc, notoc, forcetoc };
}

function isTocSwitch(node: WikitextNode): boolean {
  return node.type === "behaviorSwitch" && node.name.toLowerCase() === "toc";
}

/** 显式 `__TOC__` 的占位；放置位置与阈值由 finalize 统一决定。 */
function tocPlaceholder(): Element {
  return element(
    "div",
    {
      className: [TOC_PLACEHOLDER_CLASS],
      [TOC_DATA_PROPERTY]: "explicit",
    },
    [],
  );
}

function isIgnorableInline(node: WikitextNode): boolean {
  return (
    node.type === "category" ||
    node.type === "behaviorSwitch" ||
    node.type === "comment" ||
    (node.type === "text" && node.value.trim() === "")
  );
}

function hasVisibleContent(nodes: readonly WikitextNode[]): boolean {
  return nodes.some((node) => !isIgnorableInline(node));
}

function categoryTitle(target: string): string {
  return target.replace(/^:/u, "").trim();
}

function categoryName(target: string): string {
  const title = categoryTitle(target);
  const colon = title.indexOf(":");
  const name = colon >= 0 ? title.slice(colon + 1) : title;
  return (name || title).replace(/_/gu, " ").trim();
}

function categoriesFooter(
  context: BuildContext,
  categories: readonly WikitextCategory[],
): Element | undefined {
  if (categories.length === 0) {
    return undefined;
  }
  const labelHref = resolveInternalHref(
    context,
    categories[0]!,
    "Special:Categories",
    "Special:Categories",
  );
  const label = element(
    labelHref ? "a" : "span",
    {
      className: ["wikitext-categories__label"],
      title: "Special:Categories",
      ...(labelHref ? { href: labelHref } : {}),
    },
    [textNode(context.labels.categories)],
  );
  return element(
    "div",
    {
      id: "catlinks",
      className: ["catlinks", "wikitext-categories"],
      role: "navigation",
      dataMw: "interface",
    },
    [
      element(
        "div",
        {
          id: "mw-normal-catlinks",
          className: ["mw-normal-catlinks", "wikitext-categories__inner"],
        },
        [
          label,
          textNode(": "),
          element(
            "ul",
            { className: ["wikitext-categories__list"], role: "list" },
            categories.map((category) => {
              const target = categoryTitle(category.target);
              const href = resolveInternalHref(context, category, target, target);
              return element("li", { className: ["wikitext-categories__item"] }, [
                element(
                  href ? "a" : "span",
                  {
                    className: ["wikitext-link", "wikitext-categories__link"],
                    title: target,
                    ...(href ? { href } : {}),
                  },
                  [textNode(categoryName(category.target))],
                  category,
                ),
              ]);
            }),
          ),
        ],
      ),
    ],
  );
}

function paragraphElement(
  context: BuildContext,
  node: Extract<WikitextNode, { type: "paragraph" }>,
): ElementContent | ElementContent[] | null {
  // 段内的 `__TOC__` 提到段落外，避免把块级目录放进 <p>。
  const markerIndex = node.children.findIndex(isTocSwitch);
  const content =
    markerIndex >= 0
      ? node.children.filter((_child, index) => index !== markerIndex)
      : node.children;
  const paragraph = hasVisibleContent(content)
    ? element("p", { className: ["wikitext-paragraph"] }, convertChildren(context, content), node)
    : undefined;
  if (markerIndex < 0) {
    return paragraph ?? null;
  }
  const placeholder = tocPlaceholder();
  if (!paragraph) {
    return placeholder;
  }
  const before = node.children.slice(0, markerIndex).every(isIgnorableInline);
  return before ? [placeholder, paragraph] : [paragraph, placeholder];
}

function convertChildren(context: BuildContext, nodes: readonly WikitextNode[]): ElementContent[] {
  const result: ElementContent[] = [];
  for (const child of nodes) {
    const converted = convert(context, child);
    if (Array.isArray(converted)) {
      result.push(...converted);
    } else if (converted) {
      result.push(converted);
    }
  }
  return result;
}

function unknownElement(
  context: BuildContext,
  node: WikitextNode,
  parserType: string,
  value: string,
  block: boolean,
  reason?: string,
): Element {
  const label = reason
    ? reason === "nestedTableUnsupported"
      ? context.labels.nestedTableUnsupported
      : reason
    : `${context.labels.unknownNode}: ${parserType}`;
  if (reason === "nestedTableUnsupported") {
    return element(
      "section",
      { className: classNames("wikitext-table--degraded"), role: "note" },
      [
        element("span", { className: ["wikitext-unknown__label"] }, [textNode(label)]),
        element("pre", { className: ["wikitext-unknown__source"] }, [textNode(value)]),
      ],
      node,
    );
  }
  if (block) {
    return element(
      "section",
      {
        className: ["wikitext-unknown", "wikitext-unknown--block"],
        dataNodeType: parserType,
        dataNodeId: node.id,
      },
      [
        element("span", { className: ["wikitext-unknown__label"] }, [textNode(label)]),
        element("pre", { className: ["wikitext-unknown__source"] }, [textNode(value)]),
      ],
      node,
    );
  }
  return element(
    "span",
    {
      className: ["wikitext-unknown", "wikitext-unknown--inline"],
      dataNodeType: parserType,
      dataNodeId: node.id,
      title: label,
    },
    [
      element("span", { className: ["wikitext-unknown__label"] }, [textNode(label)]),
      element("code", { className: ["wikitext-unknown__source"] }, [
        textNode(value.length > 160 ? `${value.slice(0, 160)}…` : value),
      ]),
    ],
    node,
  );
}

function isEmptyLabel(children: readonly ElementContent[]): boolean {
  return children.every((child) => child.type === "text" && child.value.trim() === "");
}

/** 语义子树的可见纯文本；用于图片 alt 等只需要文本的场景。 */
function semanticText(nodes: readonly WikitextNode[]): string {
  return nodes
    .map((node) =>
      node.type === "text"
        ? node.value
        : node.type === "code"
          ? node.value
          : isWikitextParentNode(node)
            ? semanticText(node.children)
            : "",
    )
    .join("")
    .trim();
}

function internalLinkTitle(
  context: BuildContext,
  node: Extract<WikitextNode, { type: "link" }>,
): string {
  const page = node.page ?? context.document.meta.pageName ?? node.target;
  return page.replace(/^:/u, "");
}

/** 为分类、文件说明页与重定向构造一个只用于 resolver 的链接描述节点。 */
function auxiliaryLinkNode(
  node: WikitextNode,
  target: string,
  page?: string,
  fragment?: string,
): WikitextLink {
  return {
    type: "link",
    id: node.id,
    kind: "internal",
    target,
    ...(page === undefined ? {} : { page }),
    ...(fragment === undefined ? {} : { fragment }),
    children: [],
    ...(node.origin ? { origin: node.origin } : {}),
    ...(node.position ? { position: node.position } : {}),
  };
}

/** 通过 `resolveLink` 解析内部目标；没有可用地址时返回 null。 */
function resolveInternalHref(
  context: BuildContext,
  node: WikitextNode,
  target: string,
  page?: string,
  fragment?: string,
): string | null {
  if (!context.resolveLink) {
    return null;
  }
  const resolved = context.resolveLink(
    {
      kind: "internal",
      target,
      ...(page === undefined ? {} : { page }),
      ...(fragment === undefined ? {} : { fragment }),
    },
    {
      document: context.document,
      ast: context.ast,
      node: auxiliaryLinkNode(node, target, page, fragment),
    },
  );
  if (!resolved || resolved.href === undefined) {
    return null;
  }
  return sanitizeHref(resolved.href, { allowRelative: context.policy.allowRelativeLinks });
}

function linkElement(
  context: BuildContext,
  node: Extract<WikitextNode, { type: "link" }>,
): Element {
  const request = {
    kind: node.kind,
    target: node.target,
    ...(node.page === undefined ? {} : { page: node.page }),
    ...(node.fragment === undefined ? {} : { fragment: node.fragment }),
  };
  const resolved = context.resolveLink?.(request, {
    document: context.document,
    ast: context.ast,
    node,
  });

  let href: string | null;
  if (resolved === undefined) {
    href = node.kind === "internal" ? null : sanitizeHref(node.target);
  } else if (resolved === null) {
    href = null;
  } else if (resolved.href === undefined) {
    href = null;
  } else {
    href = sanitizeHref(resolved.href, { allowRelative: context.policy.allowRelativeLinks });
  }

  let children =
    resolved && resolved.label !== undefined
      ? [textNode(resolved.label)]
      : convertChildren(context, node.children);

  let autonumber = false;
  if (node.kind === "external" && isEmptyLabel(children)) {
    if (href !== null) {
      const number = context[LINK_STATE].nextAutonumber++;
      children = [textNode(`[${number}]`)];
      autonumber = true;
    } else {
      children = [textNode(node.target)];
    }
  }

  const missing = node.kind === "internal" && resolved?.exists === false;
  const internalTitle = missing
    ? `${internalLinkTitle(context, node)} ${context.labels.pageDoesNotExist}`
    : internalLinkTitle(context, node);

  if (href !== null) {
    const className =
      node.kind === "internal"
        ? classNames("wikitext-link", "wikitext-link--resolved", ...(missing ? ["new"] : []))
        : classNames(
            "wikitext-ext-link",
            "external",
            autonumber ? "autonumber" : node.kind === "bareExternal" ? "free" : "text",
          );
    // rel 与默认 target 由 finalize 统一处理；这里只保留 resolver 明确要求的打开方式。
    const properties: Properties = {
      className,
      href,
      dataNodeId: node.id,
      ...(node.kind === "internal" ? { title: internalTitle } : {}),
      ...(resolved?.target ? { target: resolved.target } : {}),
    };
    return element("a", properties, children, node);
  }

  const unsafeExternal = node.kind !== "internal" && resolved === undefined;
  return element(
    "span",
    {
      className: unsafeExternal
        ? classNames("wikitext-link", "wikitext-link--blocked")
        : classNames("wikitext-link", ...(missing ? ["new"] : [])),
      title: unsafeExternal
        ? context.labels.blockedLink
        : node.kind === "internal"
          ? internalTitle
          : node.target,
      dataNodeId: node.id,
    },
    children,
    node,
  );
}

/** MediaWiki 1.43 新媒体 DOM 的 RDFa 类型。 */
function fileTypeof(format: string | undefined): string {
  switch (format) {
    case "thumbnail":
    case "thumb":
    case "manualthumb":
      return "mw:File/Thumb";
    case "framed":
    case "frame":
      return "mw:File/Frame";
    case "frameless":
      return "mw:File/Frameless";
    default:
      return "mw:File";
  }
}

function imageElement(context: BuildContext, node: WikitextFile): Element {
  const parameters = getFileParameters(node);
  const blockLayout = node.block || fileLayoutIsBlock(parameters.parameters);
  const request = {
    name: parameters.name,
    parameters: parameters.parameters,
    ...(parameters.width === undefined ? {} : { width: parameters.width }),
    ...(parameters.height === undefined ? {} : { height: parameters.height }),
    ...(parameters.alt === undefined ? {} : { alt: parameters.alt }),
    ...(parameters.caption === undefined ? {} : { caption: parameters.caption }),
  };
  const resolved = context.resolveImage?.(request, {
    document: context.document,
    ast: context.ast,
    node,
  });
  const src = resolved?.src
    ? sanitizeImageUrl(resolved.src, { allowRelative: context.policy.allowRelativeImages })
    : null;
  if (src) {
    context.authorizedImages.add(src);
  }
  const width = clampDimension(resolved?.width ?? parameters.width);
  const height = clampDimension(resolved?.height ?? parameters.height);
  const captionText = semanticText(node.children);
  const alt = resolved?.alt ?? parameters.alt ?? (captionText || parameters.name);
  const framed =
    parameters.format === "framed" ||
    parameters.format === "frame" ||
    parameters.format === "manualthumb";

  if (!src) {
    reportDegrade(
      context,
      node,
      "FILE_PLACEHOLDER",
      `File "${parameters.name}" could not be resolved to an image and is rendered as a placeholder.`,
    );
  }
  let body: ElementContent;
  if (src) {
    const image = element(
      "img",
      {
        className: ["wikitext-file__image", "mw-file-element"],
        src,
        alt,
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height }),
      },
      [],
    );
    image.data = { wikitext: { ...mark(node).wikitext, imageSource: "resolver" } };
    body = image;
  } else {
    body = element("span", { className: ["wikitext-file__label"] }, [
      textNode(`${context.labels.filePlaceholder}: ${parameters.name}`),
    ]);
  }

  if (parameters.link) {
    const href = sanitizeHref(parameters.link, {
      allowRelative: context.policy.allowRelativeLinks,
    });
    if (href) {
      body = element("a", { className: ["wikitext-file__link"], href, title: parameters.name }, [
        body,
      ]);
    }
  } else {
    const href = resolveInternalHref(
      context,
      node,
      `File:${parameters.name}`,
      `File:${parameters.name}`,
    );
    if (href) {
      const visibleCaption =
        framed || parameters.format === "thumbnail" || parameters.format === "thumb";
      body = element(
        "a",
        {
          className: ["mw-file-description", "wikitext-file__link"],
          href,
          ...(!visibleCaption && captionText ? { title: captionText } : {}),
        },
        [body],
      );
    }
  }

  const caption = convertChildren(context, node.children);
  const stateClass = src ? "wikitext-file--media" : "wikitext-file--placeholder";
  const mwClasses = [
    ...(width === undefined && !framed ? ["mw-default-size"] : []),
    ...(parameters.alignment ? [`mw-halign-${parameters.alignment}`] : []),
    ...(parameters.verticalAlignment ? [`mw-valign-${parameters.verticalAlignment}`] : []),
    ...(parameters.border ? ["mw-image-border"] : []),
    ...(parameters.className ? [parameters.className] : []),
  ];
  const type = fileTypeof(parameters.format);
  if (blockLayout) {
    return element(
      "figure",
      {
        className: classNames("wikitext-file", "wikitext-file--block", stateClass, ...mwClasses),
        typeof: type,
        dataNodeId: node.id,
      },
      [body, element("figcaption", { className: ["wikitext-file__caption"] }, caption)],
      node,
    );
  }
  return element(
    "span",
    {
      className: classNames("wikitext-file", "wikitext-file--inline", stateClass, ...mwClasses),
      typeof: type,
      dataNodeId: node.id,
    },
    [body],
    node,
  );
}

function parameterList(
  context: BuildContext,
  node: Extract<WikitextNode, { type: "template" | "parserFunction" }>,
): Element {
  const items: Element[] = [];
  for (const parameter of node.children) {
    if (parameter.type !== "templateParameter") {
      continue;
    }
    const name = parameter.anonymous ? String(parameter.index ?? "") : parameter.name;
    items.push(
      element(
        "li",
        { className: ["wikitext-template__param"] },
        [
          element("span", { className: ["wikitext-template__param-name"] }, [textNode(name)]),
          element("span", { className: ["wikitext-template__param-eq"] }, [textNode("=")]),
          element(
            "span",
            { className: ["wikitext-template__param-value"] },
            convertChildren(context, parameter.children),
          ),
        ],
        parameter,
      ),
    );
  }
  return element("ul", { className: ["wikitext-template__params"] }, items);
}

function templateElement(
  context: BuildContext,
  node: Extract<WikitextNode, { type: "template" | "parserFunction" }>,
): Element {
  const template = node.type === "template";
  const label = template
    ? `${context.labels.templateNotExpanded}: ${node.displayName}`
    : `${context.labels.parserFunctionNotEvaluated}: ${node.name}`;
  if (node.block) {
    const className = template
      ? "wikitext-template wikitext-template--block"
      : "wikitext-magic-word wikitext-magic-word--block";
    return element(
      "details",
      { className: classNames(className), dataNodeId: node.id },
      [
        element("summary", { className: ["wikitext-template__summary"] }, [textNode(label)]),
        parameterList(context, node),
      ],
      node,
    );
  }
  const className = template
    ? "wikitext-template wikitext-template--inline"
    : "wikitext-magic-word";
  return element(
    "span",
    {
      className: classNames(className),
      dataNodeId: node.id,
      title: sourceOf(context, node),
    },
    [textNode(label)],
    node,
  );
}

function argumentElement(
  context: BuildContext,
  node: Extract<WikitextNode, { type: "argument" }>,
): Element {
  const children: ElementContent[] = [textNode(node.name ? `{{{${node.name}}}}` : "{{{…}}}")];
  if (node.children.length > 0) {
    children.push(
      element("span", { className: ["wikitext-argument__default"] }, [
        textNode(" ← "),
        ...convertChildren(context, node.children),
      ]),
    );
  }
  return element(
    "span",
    {
      className: ["wikitext-argument"],
      dataNodeId: node.id,
      title: sourceOf(context, node),
    },
    children,
    node,
  );
}

function unnumberedReference(context: BuildContext, node: WikitextReference): Element {
  return element(
    "sup",
    { className: ["reference", "wikitext-ref"], dataNodeId: node.id, title: node.raw ?? "" },
    [
      element("span", { className: ["wikitext-ref__label"] }, [
        textNode(`[${context.labels.reference}]`),
      ]),
    ],
    node,
  );
}

function referenceGroup(state: ReferenceState, name: string): ReferenceGroupState {
  let group = state.groups.get(name);
  if (!group) {
    group = { name, entries: [], definitions: new Map() };
    state.groups.set(name, group);
  }
  return group;
}

/** 引用上标显示文本；非默认组带组名前缀，与 Cite 1.43 一致。 */
function referenceLabel(entry: ReferenceEntry): string {
  return entry.group ? `${entry.group} ${entry.number}` : String(entry.number);
}

/** 生成引用上标；同一注释的再次引用共享编号，但保留独立的上标 id。 */
function referenceSup(context: BuildContext, entry: ReferenceEntry, occurrence: number): Element {
  const label = referenceLabel(entry);
  const sup = element(
    "sup",
    {
      className: ["reference", "wikitext-ref"],
      dataNodeId: entry.node.id,
      title: entry.node.raw ?? "",
    },
    [
      element(
        "a",
        {
          className: ["wikitext-ref__link"],
          href: `#${referenceNoteId(entry)}`,
          ariaLabel: `${context.labels.reference} ${label}`,
        },
        [
          element("span", { className: ["cite-bracket"] }, [textNode("[")]),
          textNode(label),
          element("span", { className: ["cite-bracket"] }, [textNode("]")]),
        ],
      ),
    ],
    entry.node,
  );
  const data = mark(entry.node);
  sup.data = {
    ...data,
    wikitext: {
      ...data.wikitext,
      number: entry.number,
      key: entry.key,
      ...(entry.name ? { name: entry.name } : {}),
      ...(entry.group ? { group: entry.group } : {}),
      occurrence,
    },
  };
  return sup;
}

function referenceElement(context: BuildContext, node: WikitextReference): Element {
  const state = context[REFERENCE_STATE];
  if (state.buildingList) {
    // 条目内容再次转换时不能把嵌套 ref 计入编号，否则会产生没有列表项的序号。
    return unnumberedReference(context, node);
  }
  const name = node.name?.trim();
  const group = referenceGroup(state, referenceGroupName(node.group));
  const hasContent = (node.raw ?? "").trim() !== "" || node.children.length > 0;
  if (name) {
    const definition = group.definitions.get(name);
    if (definition) {
      definition.occurrences++;
      if (hasContent) {
        reportDegrade(
          context,
          node,
          "REFERENCE_DUPLICATE_DEFINITION",
          `Reference "${name}" is defined more than once; the later definition is ignored.`,
        );
      }
      return referenceSup(context, definition, definition.occurrences);
    }
    const entry: ReferenceEntry = {
      node,
      number: group.entries.length + 1,
      group: group.name,
      key: ++state.nextKey,
      name,
      occurrences: 1,
    };
    group.entries.push(entry);
    group.definitions.set(name, entry);
    if (!hasContent) {
      reportDegrade(
        context,
        node,
        "REFERENCE_MISSING_CONTENT",
        `Reference "${name}" has no content.`,
      );
    }
    return referenceSup(context, entry, 1);
  }
  const entry: ReferenceEntry = {
    node,
    number: group.entries.length + 1,
    group: group.name,
    key: ++state.nextKey,
    occurrences: 1,
  };
  group.entries.push(entry);
  if (!hasContent) {
    reportDegrade(context, node, "REFERENCE_MISSING_CONTENT", "An empty reference was defined.");
  }
  return referenceSup(context, entry, 1);
}

function referencesSections(context: BuildContext, state: ReferenceState): Element[] {
  if (state.groups.size === 0) {
    return [];
  }
  state.buildingList = true;
  const sections = [...state.groups.values()].map((group) => {
    const items = group.entries.map((entry) =>
      element("li", { className: ["wikitext-references__item"] }, [
        element(
          "span",
          { className: [REFERENCE_TEXT_CLASS] },
          convertChildren(context, entry.node.children),
        ),
      ]),
    );
    return element(
      "div",
      {
        className: classNames(
          REFERENCE_WRAP_CLASS,
          REFERENCE_SECTION_CLASS,
          ...(group.entries.length > 10 ? [REFERENCE_COLUMNS_CLASS] : []),
        ),
        role: "doc-endnotes",
        [REFERENCE_GROUP_PROPERTY]: group.name,
      },
      [element("ol", { className: ["references", REFERENCE_LIST_CLASS] }, items)],
    );
  });
  state.buildingList = false;
  return sections;
}

function extensionElement(context: BuildContext, node: WikitextExtension): Element | Text | null {
  const raw = node.raw ?? "";
  switch (node.name) {
    case "references": {
      const group =
        node.attributes.find((attribute) => attribute.name === "group")?.value?.trim() ?? "";
      return element(
        "section",
        {
          className: [REFERENCE_PLACEHOLDER_CLASS],
          [REFERENCE_GROUP_PROPERTY]: group,
        },
        [],
        node,
      );
    }
    case "nowiki":
      // MediaWiki 1.43 的 nowiki 只输出纯文本，不生成包裹元素。
      return textNode(raw);
    case "pre":
      return element(
        "pre",
        { className: ["wikitext-ext-pre"], dataNodeId: node.id },
        [textNode(raw)],
        node,
      );
    case "syntaxhighlight": {
      const language =
        node.attributes.find((attribute) => attribute.name === "lang")?.value?.trim() ?? "";
      const safeLanguage = /^[A-Za-z0-9_-]+$/u.test(language) ? language.toLowerCase() : "";
      const classes = ["wikitext-ext-code", ...(safeLanguage ? [`language-${safeLanguage}`] : [])];
      return element(
        "pre",
        { className: classes, dataNodeId: node.id },
        [
          element("code", safeLanguage ? { className: [`language-${safeLanguage}`] } : {}, [
            textNode(raw),
          ]),
        ],
        node,
      );
    }
    case "poem": {
      const stanzas = raw
        .split(/\n[ \t]*\n/u)
        .map((stanza) => stanza.trim())
        .filter(Boolean);
      return element(
        "div",
        { className: ["wikitext-poem"], dataNodeId: node.id },
        stanzas.map((stanza) => {
          const children: ElementContent[] = [];
          for (const [index, line] of stanza.split("\n").entries()) {
            if (index > 0) {
              children.push(element("br", {}, []));
            }
            children.push(textNode(line));
          }
          return element("p", { className: ["wikitext-poem__stanza"] }, children);
        }),
        node,
      );
    }
    case "math":
      return element(
        "code",
        { className: ["wikitext-math"], dataNodeId: node.id, title: context.labels.unknownNode },
        [textNode(raw)],
        node,
      );
    case "gallery": {
      const lines = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      return element(
        "div",
        { className: ["wikitext-gallery"], dataNodeId: node.id },
        lines.map((line) => {
          const [file = "", ...rest] = line.split("|");
          const name = file.replace(/^(?:File|Image):/iu, "").trim();
          const caption = rest.join("|").trim();
          // gallery 行不是独立的 file 节点；给 resolver 一个等价的最小文件节点。
          const fileNode: WikitextFile = {
            type: "file",
            id: node.id,
            name,
            parameters: [],
            captionKind: "none",
            attributes: [],
            children: [],
            ...(node.origin ? { origin: node.origin } : {}),
            ...(node.position ? { position: node.position } : {}),
          };
          const resolved = context.resolveImage?.(
            { name, parameters: [], caption },
            { document: context.document, ast: context.ast, node: fileNode },
          );
          const src = resolved?.src
            ? sanitizeImageUrl(resolved.src, { allowRelative: context.policy.allowRelativeImages })
            : null;
          if (src) {
            context.authorizedImages.add(src);
          }
          let media: ElementContent;
          if (src) {
            const image = element(
              "img",
              {
                className: ["wikitext-gallery__image"],
                src,
                alt: resolved?.alt ?? (caption || name),
              },
              [],
            );
            image.data = { wikitext: { ...mark(node).wikitext, imageSource: "resolver" } };
            media = image;
          } else {
            media = element("span", { className: ["wikitext-gallery__label"] }, [textNode(name)]);
          }
          return element(
            "figure",
            {
              className: [
                "wikitext-gallery__item",
                src ? "wikitext-gallery__item--media" : "wikitext-gallery__item--placeholder",
              ],
            },
            [
              media,
              ...(caption
                ? [
                    element("figcaption", { className: ["wikitext-gallery__caption"] }, [
                      textNode(caption),
                    ]),
                  ]
                : []),
            ],
          );
        }),
        node,
      );
    }
    default:
      reportDegrade(
        context,
        node,
        "EXTENSION_UNSUPPORTED",
        `Extension tag "${node.name}" has no default renderer and is shown as a source card.`,
      );
      return unknownElement(context, node, "ext", sourceOf(context, node), node.block);
  }
}

function listElement(
  context: BuildContext,
  node: Extract<
    WikitextNode,
    { type: "list" | "listItem" | "definitionList" | "definitionTerm" | "definitionDescription" }
  >,
): Element {
  if (node.type === "definitionList") {
    return element(
      "dl",
      { className: classNames("wikitext-list", "wikitext-list--dl") },
      convertChildren(context, node.children),
      node,
    );
  }
  if (node.type === "listItem") {
    return element(
      "li",
      { className: ["wikitext-list__item"] },
      convertChildren(context, node.children),
      node,
    );
  }
  if (node.type === "definitionTerm") {
    return element(
      "dt",
      { className: ["wikitext-list__item"] },
      convertChildren(context, node.children),
      node,
    );
  }
  if (node.type === "definitionDescription") {
    return element(
      "dd",
      { className: ["wikitext-list__item"] },
      convertChildren(context, node.children),
      node,
    );
  }
  return element(
    node.ordered ? "ol" : "ul",
    {
      className: classNames(
        "wikitext-list",
        node.ordered ? "wikitext-list--ol" : "wikitext-list--ul",
      ),
    },
    convertChildren(context, node.children),
    node,
  );
}

function tableElement(
  context: BuildContext,
  node: Extract<WikitextNode, { type: "table" }>,
): Element {
  const properties = sourceProperties(context, node, "table");
  const caption = node.children.find((child) => child.type === "tableCaption");
  const rows = node.children.filter((child) => child.type === "tableRow");
  const captionElement = caption
    ? element(
        "caption",
        withClassName(sourceProperties(context, caption, "caption"), "wikitext-table__caption"),
        convertChildren(context, caption.children),
        caption,
      )
    : undefined;

  const rowElements = rows.map((row) => {
    const rowProperties = sourceProperties(context, row, "tr");
    return element(
      "tr",
      withClassName(rowProperties, "wikitext-table__row"),
      row.children.map((cell) => {
        if (cell.type !== "tableCell") {
          return textNode("");
        }
        const cellProperties = sourceProperties(context, cell, cell.kind);
        const cellNames = withClassName(cellProperties, "wikitext-table__cell");
        if (cell.kind === "th" && cellNames.scope === undefined) {
          cellNames.scope = "col";
        }
        return element(
          cell.kind === "th" ? "th" : "td",
          cellNames,
          convertChildren(context, cell.children),
          cell,
        );
      }),
      row,
    );
  });
  applyTableLayout(rowElements, () =>
    element("td", { className: ["wikitext-table__cell", "wikitext-table__cell--filler"] }, []),
  );

  return element(
    "table",
    { ...withClassName(properties, "wikitext-table"), dataNodeId: node.id },
    [
      ...(captionElement ? [captionElement] : []),
      element("tbody", { className: ["wikitext-table__body"] }, rowElements),
    ],
    node,
  );
}

function htmlElement(context: BuildContext, node: WikitextHtmlElement): Element | null {
  if (node.blocked) {
    reportDegrade(
      context,
      node,
      "BLOCKED_HTML",
      `HTML tag "${node.tag}" is blocked by the security policy; its content is not rendered.`,
    );
    if (node.block) {
      return element(
        "section",
        {
          className: ["wikitext-blocked-html-block"],
          dataNodeType: node.tag,
          role: "note",
        },
        [textNode(`${context.labels.blockedHtml}: ${node.tag}`)],
        node,
      );
    }
    return element(
      "span",
      { className: ["wikitext-blocked-html"], dataNodeId: node.id },
      [textNode(`${context.labels.blockedHtml}: ${node.tag}`)],
      node,
    );
  }
  const attributes = sourceProperties(context, node, node.tag);
  if (node.block) {
    const properties = {
      ...withClassName(
        attributes,
        "wikitext-html-block",
        `wikitext-html-${node.tag}`,
        /^h[1-6]$/u.test(node.tag) ? "wikitext-heading" : "",
      ),
      dataNodeId: node.id,
    };
    const children = convertChildren(context, node.children);
    if (node.tag === "table") {
      const rows = children.filter(
        (child): child is Element => child.type === "element" && child.tagName === "tr",
      );
      applyTableLayout(rows, () =>
        element("td", { className: ["wikitext-table__cell--filler"] }, []),
      );
    }
    if (node.tag === "pre") {
      return element("pre", { ...properties }, children, node);
    }
    return element(node.tag, properties, children, node);
  }
  return element(
    node.tag,
    attributes,
    node.selfClosing ? [] : convertChildren(context, node.children),
    node,
  );
}

function redirectElement(
  context: BuildContext,
  node: Extract<WikitextNode, { type: "redirect" }>,
): Element {
  const title = (node.page ?? node.target).replace(/^:/u, "");
  const href = resolveInternalHref(context, node, node.target, node.page, node.fragment);
  return element(
    "div",
    { className: ["redirectMsg", "wikitext-redirect"], role: "note", dataNodeId: node.id },
    [
      element("p", { className: ["wikitext-redirect__label"] }, [
        textNode(`${context.labels.redirectTo}:`),
      ]),
      element("ul", { className: ["redirectText", "wikitext-redirect__list"] }, [
        element("li", {}, [
          element(
            href ? "a" : "span",
            {
              className: ["wikitext-redirect__target"],
              title,
              ...(href ? { href } : {}),
            },
            [textNode(node.target)],
          ),
        ]),
      ]),
    ],
    node,
  );
}

function convert(
  context: BuildContext,
  node: WikitextNode,
): ElementContent | ElementContent[] | null {
  // handler 可以覆盖任意语义类型（包括内建类型）；返回 undefined 表示回退到内建规则。
  const custom = context.handlers?.[node.type] as WikitextHastHandler | undefined;
  if (custom) {
    const result = custom(node, context);
    if (result !== undefined) {
      return result;
    }
  }
  switch (node.type) {
    case "root":
      return convertChildren(context, node.children);
    case "paragraph":
      return paragraphElement(context, node);
    case "text":
      return textNode(node.value, mark(node));
    case "heading":
      return element(
        `h${node.level}`,
        { className: ["wikitext-heading"] },
        convertChildren(context, node.children),
        node,
      );
    case "strong":
      return element("b", {}, convertChildren(context, node.children), node);
    case "emphasis":
      return element("i", {}, convertChildren(context, node.children), node);
    case "thematicBreak":
      return element("hr", { className: ["wikitext-hr"], dataNodeId: node.id }, [], node);
    case "link":
      return linkElement(context, node);
    case "file":
      return imageElement(context, node);
    case "list":
    case "listItem":
    case "definitionList":
    case "definitionTerm":
    case "definitionDescription":
      return listElement(context, node);
    case "table":
      return tableElement(context, node);
    case "tableRow":
    case "tableCell":
    case "tableCaption":
      return null;
    case "template":
    case "parserFunction":
      return templateElement(context, node);
    case "argument":
      return argumentElement(context, node);
    case "reference":
      return referenceElement(context, node);
    case "extension":
      return extensionElement(context, node);
    case "unknown":
      if (node.reason !== "nestedTableUnsupported") {
        reportDegrade(
          context,
          node,
          "UNKNOWN_NODE",
          `Semantic node "${node.parserType}" has no renderer and is shown as a source card.`,
        );
      }
      return unknownElement(context, node, node.parserType, node.value, node.block, node.reason);
    case "htmlElement":
      return htmlElement(context, node);
    case "redirect":
      return redirectElement(context, node);
    case "code":
      return element("code", {}, [textNode(node.value)], node);
    case "behaviorSwitch": {
      const name = node.name.toLowerCase();
      if (context[TOC_STATE].mode === "marker" && name === "toc") {
        return tocPlaceholder();
      }
      if (name !== "toc" && name !== "notoc" && name !== "forcetoc") {
        reportDegrade(
          context,
          node,
          "BEHAVIOR_SWITCH_IGNORED",
          `Behavior switch "${node.name}" has no effect in this renderer.`,
          "info",
        );
      }
      return null;
    }
    case "comment":
    case "category":
      return null;
    default: {
      context.reportDiagnostic({
        code: "UNKNOWN_NODE",
        stage: "hast",
        severity: "warning",
        message: `No HAST handler registered for semantic node type "${node.type}"; rendered as a safe card.`,
        ...(node.origin ? { origin: node.origin } : {}),
        ...(node.position ? { position: node.position } : {}),
      });
      return unknownElement(context, node, node.type, sourceOf(context, node), false);
    }
  }
}

/**
 * 把语义树转换为 HAST，同时收集图片授权与诊断信息。
 * 只产出语义属性与 TOC 占位；链接/图片策略、标题锚点与目录放置统一由 finalize 负责。
 * @param input 转换输入。
 */
export function toHast(input: WikitextToHastInput): WikitextToHastResult {
  const state: ReferenceState = { groups: new Map(), buildingList: false, nextKey: 0 };
  const linkState: LinkState = { nextAutonumber: 1 };
  const symbols = scanSymbols(input.ast);
  const toc: WikitextTocMode = !(input.tocSettings?.enabled ?? true)
    ? "none"
    : symbols.notoc
      ? "none"
      : symbols.toc
        ? "marker"
        : symbols.forcetoc
          ? "force"
          : "auto";
  let build!: BuildContext;
  build = {
    ...input,
    [REFERENCE_STATE]: state,
    [LINK_STATE]: linkState,
    [TOC_STATE]: { mode: toc },
    convert: (node) => convert(build, node),
    convertChildren: (nodes) => convertChildren(build, nodes),
    reportDiagnostic: (diagnostic) => {
      input.diagnostics.push(diagnostic);
    },
  };
  const first = build.ast.children[0];
  const top = first && first.type === "redirect" ? [first] : build.ast.children;
  const children = convertChildren(build, top);
  children.push(...referencesSections(build, state));
  const categories = categoriesFooter(build, symbols.categories);
  if (categories) {
    children.push(categories);
  }
  return {
    hast: { type: "root", children },
    authorizedImages: build.authorizedImages,
    toc,
  };
}
