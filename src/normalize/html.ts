import type { WikitextSyntaxNode } from "../ast/model";
import {
  BANNED_HTML_TAGS,
  BLOCK_HTML_TAGS,
  DROP_HTML_TAGS,
  INLINE_HTML_TAGS,
  VOID_HTML_TAGS,
} from "../shared/html-tags";

type HtmlKind = "void" | "inline" | "block" | "banned" | "drop" | "unknown";

/** 块级标签的正则表达式片段，供行级扫描（例如判断列表续行）复用。 */
export const BLOCK_TAG_SOURCE = [...BLOCK_HTML_TAGS].join("|");

export function classifyHtmlTag(tag: string): HtmlKind {
  const name = tag.toLowerCase();
  if (DROP_HTML_TAGS.has(name)) {
    return "drop";
  }
  if (BANNED_HTML_TAGS.has(name)) {
    return "banned";
  }
  if (VOID_HTML_TAGS.has(name)) {
    return "void";
  }
  if (INLINE_HTML_TAGS.has(name)) {
    return "inline";
  }
  if (BLOCK_HTML_TAGS.has(name)) {
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

export const BLOCK_EXT_TAGS: ReadonlySet<string> = new Set([
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
export const INLINE_EXT_TAGS: ReadonlySet<string> = new Set(["nowiki", "math"]);
