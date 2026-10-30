const EXTERNAL_HREF = /^(?:https?|mailto):/iu;
const RELATIVE_PREFIX = /^(?:\/|\.\/|\.\.\/|#|\?)/u;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

/** 判断已校验的链接地址是否为绝对外链。 */
export function isExternalHref(href: string): boolean {
  return EXTERNAL_HREF.test(href);
}

/**
 * 判断地址是否为相对引用；协议相对地址（`//host`）不算相对。
 * 裸相对路径只接受不含冒号的形式，避免 `java\script:` 这类写法被当作相对路径。
 */
export function isRelativeHref(href: string): boolean {
  if (href.startsWith("//")) {
    return false;
  }
  if (RELATIVE_PREFIX.test(href)) {
    return true;
  }
  return !SCHEME.test(href) && !href.includes(":");
}
