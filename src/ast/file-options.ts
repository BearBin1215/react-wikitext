/**
 * 文件参数的唯一词表：语法解析（哪些键算具名参数）与语义派生（哪些键映射到渲染字段）共用，
 * 避免两侧对“具名参数”的认知不一致。
 */

/** 允许写成 `key=value` 的文件参数键；大小写与键两侧空白不影响识别。 */
export const FILE_KEY_VALUE_KEYS: ReadonlySet<string> = new Set([
  "alt",
  "caption",
  "class",
  "lang",
  "link",
  "manualthumb",
  "page",
  "upright",
  "width",
]);

/** 显示格式关键字；同名参数也按格式处理。 */
export const FILE_FORMAT_NAMES: ReadonlySet<string> = new Set([
  "thumbnail",
  "manualthumb",
  "framed",
  "frameless",
]);

/** 水平对齐关键字。 */
export const FILE_ALIGNMENT_NAMES: ReadonlySet<string> = new Set([
  "left",
  "right",
  "center",
  "none",
]);

/** 垂直对齐关键字。 */
export const FILE_VERTICAL_ALIGNMENT_NAMES: ReadonlySet<string> = new Set([
  "baseline",
  "sub",
  "super",
  "top",
  "text-top",
  "middle",
  "bottom",
  "text-bottom",
]);

/** 不带值的开关类关键字。 */
export const FILE_FLAG_NAMES: ReadonlySet<string> = new Set(["border"]);

/** MediaWiki 新媒体 DOM 中会生成块级 `figure` 的格式关键字。 */
const BLOCK_LAYOUT_FORMATS: ReadonlySet<string> = new Set([
  "thumbnail",
  "thumb",
  "framed",
  "frame",
  "manualthumb",
]);

/**
 * MediaWiki 新媒体 DOM 下文件是否使用块级 `figure` 包装。
 * 缩略图、framed 与任何显式水平对齐都是块级；frameless 只有带对齐时才是。
 */
export function fileLayoutIsBlock(parameters: readonly { readonly name: string }[]): boolean {
  let blockFormat = false;
  let alignment = false;
  for (let index = parameters.length - 1; index >= 0; index--) {
    const name = parameters[index]!.name;
    blockFormat ||= BLOCK_LAYOUT_FORMATS.has(name);
    alignment ||= FILE_ALIGNMENT_NAMES.has(name);
    if (blockFormat && alignment) {
      break;
    }
  }
  return blockFormat || alignment;
}
