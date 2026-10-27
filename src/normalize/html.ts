import type { WikitextSyntaxNode } from "../ast/model";

type HtmlKind = "void" | "inline" | "block" | "banned" | "drop" | "unknown";

const INLINE_TAGS = new Set([
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "del",
  "ins",
  "sub",
  "sup",
  "code",
  "small",
  "big",
  "span",
  "mark",
  "abbr",
  "q",
  "ruby",
  "rb",
  "rt",
  "rp",
  "bdi",
  "bdo",
  "cite",
  "dfn",
  "kbd",
  "samp",
  "data",
  "time",
  "var",
  "font",
]);

const BLOCK_TAGS = new Set([
  "div",
  "p",
  "blockquote",
  "center",
  "pre",
  "ul",
  "ol",
  "dl",
  "table",
  "caption",
  "tr",
  "td",
  "th",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "dt",
  "dd",
]);

/** 供行级扫描（例如判断列表续行）复用，避免标签词表在多个位置各写一份。 */
export const BLOCK_TAG_SOURCE = [...BLOCK_TAGS].join("|");

const VOID_TAGS = new Set(["br", "wbr", "hr", "img"]);

const BANNED_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "svg",
  "math",
]);

const DROP_TAGS = new Set(["meta", "link"]);

export function classifyHtmlTag(tag: string): HtmlKind {
  const name = tag.toLowerCase();
  if (DROP_TAGS.has(name)) {
    return "drop";
  }
  if (BANNED_TAGS.has(name)) {
    return "banned";
  }
  if (VOID_TAGS.has(name)) {
    return "void";
  }
  if (INLINE_TAGS.has(name)) {
    return "inline";
  }
  if (BLOCK_TAGS.has(name)) {
    return "block";
  }
  return "unknown";
}

export function htmlTagName(node: WikitextSyntaxNode): string {
  return typeof node.props.name === "string" ? node.props.name.toLowerCase() : "";
}

export function isClosingHtml(node: WikitextSyntaxNode): boolean {
  return node.props.closing === true;
}

export function isSelfClosingHtml(node: WikitextSyntaxNode): boolean {
  return node.props.selfClosing === true;
}

/**
 * 维护“被禁止标签”的嵌套栈：关闭标签时退回到同名标签之前，未闭合的开标签持续屏蔽内容。
 * inline 与 lists 共用同一套规则，避免两处各写一遍。
 */
export function trackBannedTag(
  stack: string[],
  tag: string,
  closing: boolean,
  selfClosing: boolean,
): void {
  if (closing) {
    const index = stack.lastIndexOf(tag);
    if (index >= 0) {
      stack.length = index;
    }
    return;
  }
  if (!selfClosing) {
    stack.push(tag);
  }
}

/** 开标签是否按块级 HTML 处理；闭合标签与行内、未知标签返回 false。 */
export function isBlockHtmlStart(node: WikitextSyntaxNode): boolean {
  if (node.type !== "html" || isClosingHtml(node)) {
    return false;
  }
  const tag = htmlTagName(node);
  const kind = classifyHtmlTag(tag);
  return kind === "block" || kind === "banned" || (kind === "void" && tag === "hr");
}

/** 这些块级标签的内容按行内渲染，避免在 tr/td/p 内生成段落。 */
export const INLINE_CONTENT_BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "dt",
  "dd",
  "td",
  "th",
  "caption",
]);

/** pre 保留原始空白，不按 wiki 结构解析。 */
export const RAW_TEXT_BLOCK_TAGS = new Set(["pre"]);

export const BLOCK_CONTENT_TAGS = new Set([
  "ul",
  "ol",
  "dl",
  "table",
  "tr",
  "div",
  "center",
  "blockquote",
]);

export const BLOCK_EXT_TAGS = new Set([
  "pre",
  "references",
  "gallery",
  "syntaxhighlight",
  "imagemap",
  "templatestyles",
  "chem",
  "score",
  "timeline",
  "mapframe",
]);

/** 独立成行时仍按行内展示的扩展标签；其余未专门支持的扩展会成为块级源码卡片。 */
export const INLINE_EXT_TAGS = new Set(["nowiki", "math"]);
