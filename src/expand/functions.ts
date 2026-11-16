/**
 * `/expand` 使用的纯函数工具：表达式求值、字符串处理与 `#tag` 输出构造。
 * 表达式求值复用上游 `wikiparser-node` 的 MediaWiki 移植；这里只负责结果格式化和错误判定。
 * 这里不解析 wikitext、不访问站点状态，也不产生诊断；调用方负责把失败转成诊断。
 */

import { escapeText } from "entities";
import { expr } from "wikiparser-node/dist/vendor/expr.js";

/** 把结果格式化为紧凑的数字字符串；最多保留 14 位有效数字。 */
function formatExpressionNumber(value: number): string {
  return String(Number(value.toPrecision(14)));
}

/** 求值 `#expr` 表达式；语法或数学错误时返回 `undefined`。 */
export function evaluateExpression(input: string): string | undefined {
  const result = expr(input);
  // 上游用错误 HTML 字符串表示失败；数字结果里仍可能出现 NaN 或 Infinity。
  if (typeof result !== "number" || !Number.isFinite(result)) {
    return undefined;
  }
  return formatExpressionNumber(result);
}

/** `#titleparts`：按 `/` 切分并取指定区段；`first` 为 1 基，负数从末尾计数。 */
export function titleParts(input: string, count: number, first: number): string {
  const parts = input.split("/");
  const start = first < 0 ? Math.max(0, parts.length + first) : Math.max(0, first - 1);
  if (count === 0) {
    return parts.slice(start).join("/");
  }
  const end = count < 0 ? Math.max(start, parts.length + count) : start + count;
  return parts.slice(start, end).join("/");
}

/**
 * 按 Unicode 码点计数。
 *
 * 源码 offset 与编辑器定位仍然按 UTF-16 表示；`#len` 等站点函数使用码点，
 * 两者不能混为一谈。
 * @param input 待计数文本。
 */
export function codePointLength(input: string): number {
  let length = 0;
  for (const _character of input) {
    void _character;
    length++;
  }
  return length;
}

/**
 * `#sub`：按 Unicode 码点截取。
 *
 * - 省略长度或显式长度 `0` 时取到结尾；
 * - 负长度从结果末尾缩短；
 * - 负起点从末尾计数，越界按站点实现钳制。
 * @param input 原始文本。
 * @param start 起点，负数从末尾计数。
 * @param length 长度；`undefined` 或 `0` 表示取到结尾。
 */
export function substring(input: string, start: number, length?: number): string {
  const characters = Array.from(input);
  const total = characters.length;
  const from = start < 0 ? Math.max(0, total + start) : start;
  if (from >= total) {
    return "";
  }
  if (length === undefined || length === 0) {
    return characters.slice(from).join("");
  }
  if (length < 0) {
    const end = Math.max(from, total + length);
    return characters.slice(from, end).join("");
  }
  return characters.slice(from, from + length).join("");
}

/** `#padleft` / `#padright`：用指定填充字符按码点补到目标长度。 */
export function pad(
  input: string,
  length: number,
  padding: string,
  side: "left" | "right",
): string {
  const characters = Array.from(input);
  const paddingCharacters = Array.from(padding);
  if (characters.length >= length || paddingCharacters.length === 0) {
    return input;
  }
  const missing = length - characters.length;
  const filler: string[] = [];
  for (let index = 0; index < missing; index++) {
    filler.push(paddingCharacters[index % paddingCharacters.length]!);
  }
  const paddingValue = filler.join("");
  return side === "left" ? `${paddingValue}${input}` : `${input}${paddingValue}`;
}

/**
 * `#replace`：按完整字符序列替换。
 *
 * 空查找串按 MediaWiki 规则等价于单个空格；`limit` 为负数表示不限制次数。
 * @param input 原始文本。
 * @param search 查找串。
 * @param replacement 替换串。
 * @param limit 最多替换次数；负数表示不限制。
 */
export function replaceText(
  input: string,
  search: string,
  replacement: string,
  limit = -1,
): string {
  const needle = search === "" ? " " : search;
  if (limit < 0) {
    return input.split(needle).join(replacement);
  }
  if (limit === 0) {
    return input;
  }
  let result = "";
  let cursor = 0;
  let replaced = 0;
  for (;;) {
    const found = input.indexOf(needle, cursor);
    if (found < 0 || replaced >= limit) {
      return result + input.slice(cursor);
    }
    result += input.slice(cursor, found) + replacement;
    cursor = found + needle.length;
    replaced++;
  }
}

/**
 * 站点风格的错误输出。
 *
 * `#iferror` 按错误标记判断可见输出，因此错误必须表现为带 `error` 类的元素，
 * 而不是仅存在于库诊断中。
 * @param message 错误说明。
 */
export function errorOutput(message: string): string {
  return `<strong class="error">${escapeText(message)}</strong>`;
}

/** 判断可见输出是否带站点错误标记；`#iferror` 只依据可见输出。 */
export function isErrorOutput(text: string): boolean {
  return /<(?:strong|span|p|div)\s+(?:[^\s>]+\s+)*?class="\s*(?:[^"\s>]+\s+)*?error(?:\s[^">]*)?"/u.test(
    text,
  );
}

/** `#urlencode`：使用与浏览器一致的标准百分号编码。 */
export function urlEncode(input: string): string {
  return encodeURIComponent(input);
}

/** `#urldecode`：非法序列保留原文。 */
export function urlDecode(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

const TAG_NAME = /^[A-Za-z][A-Za-z0-9]*$/u;
const TAG_ATTRIBUTE = /^[A-Za-z][A-Za-z0-9-]*$/u;

/**
 * 构造 `#tag` 的 wikitext 输出；标签名非法时返回 undefined。
 * 内容与属性值都按 wikitext 处理，之后仍会经过正常解析与清洗。
 */
export function tagOutput(
  name: string,
  content: string,
  attributes: ReadonlyArray<{ readonly name: string; readonly value: string }>,
): string | undefined {
  const tag = name.trim();
  if (!TAG_NAME.test(tag)) {
    return undefined;
  }
  const rendered = attributes
    .map((attribute) => ({ name: attribute.name.trim(), value: attribute.value }))
    .filter((attribute) => TAG_ATTRIBUTE.test(attribute.name))
    .map((attribute) => ` ${attribute.name}="${attribute.value.replace(/"/gu, "&quot;")}"`);
  return `<${tag}${rendered.join("")}>${content}</${tag}>`;
}
