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
