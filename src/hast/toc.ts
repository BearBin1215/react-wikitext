import type { Element, ElementContent, Properties } from "hast";
import type { WikitextHeadingInfo } from "../ast/model";

/** 生成目录的 class；同时保留 MediaWiki 的 `toc` class 便于宿主样式复用。 */
const TOC_CLASS = "wikitext-toc";
/** 目录占位节点的 class；最终整理阶段替换为真实目录。 */
export const TOC_PLACEHOLDER_CLASS = "wikitext-toc-placeholder";
/** MediaWiki 默认在标题数达到该值时自动生成目录。 */
export const TOC_AUTO_MIN_HEADINGS = 4;

/** HAST 属性上的目录标记；源码 HTML 无法通过属性清洗写入该值。 */
export const TOC_DATA_PROPERTY = "dataWikitextToc";
export type TocMarker = "auto" | "explicit";

interface TocEntry {
  readonly heading: WikitextHeadingInfo;
  readonly children: TocEntry[];
  number: string;
}

function textNode(value: string): ElementContent {
  return { type: "text", value };
}

function element(tagName: string, properties: Properties, children: ElementContent[]): Element {
  return { type: "element", tagName, properties, children };
}

function buildEntries(headings: readonly WikitextHeadingInfo[]): TocEntry[] {
  const roots: TocEntry[] = [];
  const stack: TocEntry[] = [];
  for (const heading of headings) {
    while (stack.length > 0 && stack[stack.length - 1]!.heading.level >= heading.level) {
      stack.pop();
    }
    const entry: TocEntry = { heading, children: [], number: "" };
    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(entry);
    } else {
      roots.push(entry);
    }
    stack.push(entry);
  }
  return roots;
}

function assignNumbers(entries: readonly TocEntry[], prefix: string): void {
  for (const [index, entry] of entries.entries()) {
    entry.number = prefix ? `${prefix}.${index + 1}` : String(index + 1);
    assignNumbers(entry.children, entry.number);
  }
}

function tocEntryElement(entry: TocEntry, section: { value: number }): Element {
  section.value++;
  const depth = entry.number.split(".").length;
  const label: ElementContent[] = [
    element("span", { className: ["tocnumber", "wikitext-toc__number"] }, [textNode(entry.number)]),
    textNode(" "),
    element("span", { className: ["toctext", "wikitext-toc__text"] }, [
      textNode(entry.heading.text),
    ]),
  ];
  const link: ElementContent =
    entry.heading.id === undefined
      ? element("span", { className: ["wikitext-toc__link"] }, label)
      : element("a", { className: ["wikitext-toc__link"], href: `#${entry.heading.id}` }, label);
  return element(
    "li",
    {
      className: [`toclevel-${depth}`, `tocsection-${section.value}`, "wikitext-toc__item"],
    },
    [
      link,
      ...(entry.children.length > 0
        ? [
            element(
              "ul",
              { className: ["wikitext-toc__list"], role: "list" },
              entry.children.map((child) => tocEntryElement(child, section)),
            ),
          ]
        : []),
    ],
  );
}

/**
 * 根据最终标题列表生成目录。
 * 没有标题时返回 undefined；标题级别跳跃按最近层级嵌套。
 */
export function buildToc(
  headings: readonly WikitextHeadingInfo[],
  label: string,
  columns: 1 | 2 | 3 = 1,
): Element | undefined {
  if (headings.length === 0) {
    return undefined;
  }
  const entries = buildEntries(headings);
  assignNumbers(entries, "");
  const section = { value: 0 };
  return element(
    "div",
    {
      className: ["toc", TOC_CLASS, ...(columns > 1 ? [`wikitext-toc--columns-${columns}`] : [])],
      role: "navigation",
      ariaLabel: label,
      [TOC_DATA_PROPERTY]: "toc",
    },
    [
      element("div", { className: ["toctitle", "wikitext-toc__title"] }, [textNode(label)]),
      element(
        "ul",
        { className: ["wikitext-toc__list"], role: "list" },
        entries.map((entry) => tocEntryElement(entry, section)),
      ),
    ],
  );
}
