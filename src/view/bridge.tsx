import { createElement, type ReactElement } from "react";
import type { Element } from "hast";
import type { Components } from "hast-util-to-jsx-runtime";
import { hastNodeId } from "../shared/hast";
import { isExternalHref } from "../shared/url";
import { WIKITEXT_TAG_NAMES } from "../shared/html-tags";
import { useWikitextContext, type WikitextViewContextValue } from "./context";
import type { WikitextHtmlComponentProps } from "./types";

type BridgeProps = WikitextHtmlComponentProps;

/** 旧式表格属性的 HAST 属性名，转成 React 可原样输出的全小写属性。 */
const LEGACY_ATTRIBUTE_ALIASES: Readonly<Record<string, string>> = {
  vAlign: "valign",
  bgColor: "bgcolor",
  noWrap: "nowrap",
};

function mapProps(
  props: WikitextHtmlComponentProps,
  context: WikitextViewContextValue,
): WikitextHtmlComponentProps {
  const next: Record<string, unknown> = { ...props };
  for (const [from, to] of Object.entries(LEGACY_ATTRIBUTE_ALIASES)) {
    if (next[from] !== undefined) {
      next[to] = next[from] === true ? "" : next[from];
      delete next[from];
    }
  }
  if (typeof next.id === "string") {
    next.id = context.mapId(next.id);
  }
  if (typeof next.href === "string" && next.href.startsWith("#") && next.href.length > 1) {
    next.href = context.mapHref(next.href);
  }
  if (Array.isArray(next.headers)) {
    next.headers = next.headers.map((value) =>
      typeof value === "string" ? context.mapId(value) : value,
    );
  } else if (typeof next.headers === "string") {
    next.headers = next.headers
      .split(/\s+/u)
      .map((value) => context.mapId(value))
      .join(" ");
  }
  return next as unknown as WikitextHtmlComponentProps;
}

function referenceNumber(node: Element | undefined): number {
  const data = node?.data as { wikitext?: { number?: unknown } } | undefined;
  const number = data?.wikitext?.number;
  return typeof number === "number" ? number : 0;
}

/** 桥接任意 HAST 元素：优先命中文档的 HTML 组件，其次尝试语义组件覆盖。 */
function TagBridge({ node, children, ...props }: BridgeProps): ReactElement {
  const context = useWikitextContext();
  const id = hastNodeId(node);
  const semantic = id ? context.semanticIndex.get(id) : undefined;
  const mapped = mapProps(props, context);
  const mappedRecord = mapped as unknown as Record<string, unknown>;
  const origin = semantic?.origin;

  if (node && semantic) {
    const base = {
      ...mapped,
      document: context.document,
      node: semantic,
      hastNode: node,
      ...(origin ? { origin } : {}),
      children,
    };
    switch (semantic.type) {
      case "link": {
        const Link = context.semanticComponents.link;
        if (Link) {
          return createElement(Link, {
            ...base,
            target: semantic.target,
            kind: semantic.kind,
            ...(typeof mappedRecord.href === "string" ? { href: mappedRecord.href } : {}),
            external:
              semantic.kind !== "internal" ||
              (typeof mappedRecord.href === "string" && isExternalHref(mappedRecord.href)),
          } as never);
        }
        break;
      }
      case "template":
      case "parserFunction": {
        const Template =
          semantic.type === "template"
            ? context.semanticComponents.template
            : context.semanticComponents.parserFunction;
        if (Template) {
          const displayName = semantic.type === "template" ? semantic.displayName : semantic.name;
          return createElement(Template, { ...base, displayName } as never);
        }
        break;
      }
      case "argument": {
        const Argument = context.semanticComponents.argument;
        if (Argument) {
          return createElement(Argument, base as never);
        }
        break;
      }
      case "file": {
        const File = context.semanticComponents.file;
        if (File) {
          return createElement(File, { ...base, name: semantic.name } as never);
        }
        break;
      }
      case "reference": {
        const Reference = context.semanticComponents.reference;
        if (Reference) {
          return createElement(Reference, { ...base, number: referenceNumber(node) } as never);
        }
        break;
      }
      case "extension": {
        const Extension = context.semanticComponents.extension;
        if (Extension) {
          return createElement(Extension, {
            ...base,
            name: semantic.name,
            block: semantic.block,
          } as never);
        }
        break;
      }
      case "unknown": {
        const Unknown = context.semanticComponents.unknown;
        if (Unknown) {
          return createElement(Unknown, {
            ...base,
            parsedType: semantic.parserType,
            block: semantic.block,
          } as never);
        }
        break;
      }
      case "table": {
        const Table = context.semanticComponents.table;
        if (Table) {
          return createElement(Table, base as never);
        }
        break;
      }
      default:
        break;
    }
  }

  const Custom = node ? context.components[node.tagName] : undefined;
  if (Custom && node) {
    return createElement(
      Custom,
      {
        ...mapped,
        node,
        document: context.document,
        ...(semantic ? { semantic } : {}),
        ...(origin ? { origin } : {}),
      } as never,
      children,
    );
  }
  return createElement(
    node?.tagName ?? "span",
    mapped as unknown as Record<string, unknown>,
    children,
  );
}

/**
 * 按文档构建桥接表：默认标签、`extraTags` 与调用方提供的组件键都会进入桥接。
 * 每次渲染都重新生成，避免跨视图共享状态。
 */
export function createBridgeComponents(tags: Iterable<string>): Partial<Components> {
  return Object.fromEntries(Array.from(tags, (tag) => [tag, TagBridge])) as Partial<Components>;
}

/** 需要桥接的标签集合：内建标签 + 策略额外标签 + 组件表键。 */
export function bridgeTagNames(
  extraTags: readonly string[] | undefined,
  components: Readonly<Record<string, unknown>> | undefined,
): Set<string> {
  const names = new Set<string>(WIKITEXT_TAG_NAMES);
  for (const tag of extraTags ?? []) {
    names.add(tag);
  }
  for (const tag of Object.keys(components ?? {})) {
    names.add(tag);
  }
  return names;
}
