import type { WikitextSyntaxNode, WikitextSyntaxRoot } from "../ast/model";

/** 内容保持原文、不参与模板展开的扩展标签。 */
const RAW_EXTENSION_NAMES = new Set([
  "nowiki",
  "pre",
  "math",
  "syntaxhighlight",
  "source",
  "gallery",
  "imagemagick",
  "imagemap",
  "templatedata",
  "templatestyles",
  "chem",
  "score",
  "timeline",
  "mapframe",
  "graph",
]);

const RAW_EXTENSION_PATTERN = new RegExp(
  `<(${[...RAW_EXTENSION_NAMES].join("|")})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>|<(?:${[
    ...RAW_EXTENSION_NAMES,
  ].join("|")})\\b[^>]*\\/>`,
  "giu",
);

/** 去掉原文扩展标签及其内容，用于条件判断。 */
export function stripRawExtensions(text: string): string {
  return text.replace(RAW_EXTENSION_PATTERN, "");
}

/**
 * 扫描不参与模板展开的保护区域：注释与原文扩展标签。
 *
 * 预处理在语法编译之前运行，因此这里不依赖语法树，但必须与默认适配器的
 * 扩展标签配置保持一致；结果按起点排序且互不重叠。
 * @param text LF 归一化后的源码。
 */
export function scanProtectedRegions(text: string): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  const pattern = new RegExp(RAW_EXTENSION_PATTERN.source, RAW_EXTENSION_PATTERN.flags);
  const comment = /<!--[\s\S]*?-->/gu;
  const push = (start: number, end: number): void => {
    if (end > start) {
      ranges.push([start, end]);
    }
  };
  for (const match of text.matchAll(comment)) {
    push(match.index, match.index + match[0].length);
  }
  for (const match of text.matchAll(pattern)) {
    push(match.index, match.index + match[0].length);
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- 产物 target 为 ES2022。
  return ranges.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
}

export function findChild(
  node: WikitextSyntaxNode | WikitextSyntaxRoot,
  type: string,
): WikitextSyntaxNode | undefined {
  return node.children.find((child) => child.type === type);
}

export function isCallNode(node: WikitextSyntaxNode): boolean {
  return node.type === "template" || node.type === "magic-word" || node.type === "arg";
}

function isRawExtension(node: WikitextSyntaxNode): boolean {
  const name = typeof node.props.name === "string" ? node.props.name.toLowerCase() : "";
  return node.type === "ext" && RAW_EXTENSION_NAMES.has(name);
}

export function isOpaqueNode(node: WikitextSyntaxNode): boolean {
  return node.type === "comment" || isRawExtension(node);
}
