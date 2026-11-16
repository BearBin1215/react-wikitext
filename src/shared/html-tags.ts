/**
 * wiki 渲染用到的 HTML 标签词表。
 *
 * 归一化按 `kind` 判断行内、块级与禁用标签，按 `content` 决定块级标签内部的
 * 解析方式；清洗器与视图复用同一份标签白名单。词表统一在这里维护。
 *
 * 分类集合（行内、块级、空元素、禁用、丢弃与内容模式）只供 `normalize` 使用；
 * `WIKITEXT_TAG_NAMES` 供清洗器与视图使用。`plain` 表示只进白名单、不参与
 * 源码分类，通常是库生成的标签。
 */
type WikitextHtmlTagKind = "inline" | "block" | "void" | "banned" | "drop" | "plain";

/** 块级标签内容的解析方式：行内容器、块级容器或原文容器。 */
type BlockContentKind = "inline" | "block" | "raw";

type HtmlTagDefinition = readonly [WikitextHtmlTagKind, BlockContentKind?];

// 键按字母序排列，派生出的标签集合与白名单顺序因此保持稳定。
const HTML_TAGS = {
  a: ["plain"],
  abbr: ["inline"],
  b: ["inline"],
  bdi: ["inline"],
  bdo: ["inline"],
  big: ["inline"],
  blockquote: ["block", "block"],
  br: ["void"],
  button: ["banned"],
  caption: ["block", "inline"],
  center: ["block", "block"],
  cite: ["inline"],
  code: ["inline"],
  data: ["inline"],
  dd: ["block", "inline"],
  del: ["inline"],
  details: ["plain"],
  dfn: ["inline"],
  div: ["block", "block"],
  dl: ["block", "block"],
  dt: ["block", "inline"],
  em: ["inline"],
  embed: ["banned"],
  figcaption: ["plain"],
  figure: ["plain"],
  font: ["inline"],
  form: ["banned"],
  h1: ["block", "inline"],
  h2: ["block", "inline"],
  h3: ["block", "inline"],
  h4: ["block", "inline"],
  h5: ["block", "inline"],
  h6: ["block", "inline"],
  hr: ["void"],
  i: ["inline"],
  iframe: ["banned"],
  img: ["void"],
  input: ["banned"],
  ins: ["inline"],
  kbd: ["inline"],
  li: ["block", "inline"],
  link: ["drop"],
  mark: ["inline"],
  math: ["banned"],
  meta: ["drop"],
  object: ["banned"],
  ol: ["block", "block"],
  option: ["banned"],
  p: ["block", "inline"],
  pre: ["block", "raw"],
  q: ["inline"],
  rb: ["inline"],
  rp: ["inline"],
  rt: ["inline"],
  rtc: ["plain"],
  ruby: ["inline"],
  s: ["inline"],
  samp: ["inline"],
  script: ["banned"],
  section: ["plain"],
  select: ["banned"],
  small: ["inline"],
  span: ["inline"],
  strong: ["inline"],
  style: ["banned"],
  sub: ["inline"],
  summary: ["plain"],
  sup: ["inline"],
  svg: ["banned"],
  table: ["block", "block"],
  tbody: ["plain"],
  td: ["block", "inline"],
  textarea: ["banned"],
  tfoot: ["plain"],
  th: ["block", "inline"],
  thead: ["plain"],
  time: ["inline"],
  tr: ["block", "block"],
  u: ["inline"],
  ul: ["block", "block"],
  var: ["inline"],
  wbr: ["void"],
} as const satisfies Record<string, HtmlTagDefinition>;

function tagsOfKind(kind: WikitextHtmlTagKind): string[] {
  return Object.entries(HTML_TAGS)
    .filter(([, definition]) => definition[0] === kind)
    .map(([tag]) => tag);
}

function blockTagsOfContent(content: BlockContentKind): string[] {
  return Object.entries(HTML_TAGS)
    .filter(([, definition]) => {
      const entry = definition as HtmlTagDefinition;
      return entry[0] === "block" && entry[1] === content;
    })
    .map(([tag]) => tag);
}

/** 允许出现在最终 HTML 中的标签；不含 banned 与 drop。 */
export const WIKITEXT_TAG_NAMES: readonly string[] = Object.entries(HTML_TAGS)
  .filter(([, definition]) => definition[0] !== "banned" && definition[0] !== "drop")
  .map(([tag]) => tag);

export const INLINE_HTML_TAGS: ReadonlySet<string> = new Set(tagsOfKind("inline"));
export const BLOCK_HTML_TAGS: ReadonlySet<string> = new Set(tagsOfKind("block"));
export const VOID_HTML_TAGS: ReadonlySet<string> = new Set(tagsOfKind("void"));
export const BANNED_HTML_TAGS: ReadonlySet<string> = new Set(tagsOfKind("banned"));
export const DROP_HTML_TAGS: ReadonlySet<string> = new Set(tagsOfKind("drop"));

/** 块级标签的内容按行内渲染，避免在 tr/td/p 内生成段落。 */
export const INLINE_CONTENT_BLOCK_TAGS: ReadonlySet<string> = new Set(blockTagsOfContent("inline"));

/** 块级标签的内容继续按块级规则解析。 */
export const BLOCK_CONTENT_TAGS: ReadonlySet<string> = new Set(blockTagsOfContent("block"));

/** 原文块级标签：内容保留原始空白，不按 wiki 结构解析。 */
export const RAW_TEXT_BLOCK_TAGS: ReadonlySet<string> = new Set(blockTagsOfContent("raw"));
