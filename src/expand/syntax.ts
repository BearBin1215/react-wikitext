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

export function sourceText(source: string, node: WikitextSyntaxNode | WikitextSyntaxRoot): string {
  return source.slice(node.range[0], node.range[1]);
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
