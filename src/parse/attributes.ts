import type { WikitextSyntaxAttribute } from "../ast/model";
import type { TokenLike } from "./loadParser";

interface RawAttribute {
  name: string;
  value: string | null;
  token: TokenLike;
}

const ATTRS_TYPES = new Set(["html-attrs", "table-attrs", "ext-attrs"]);
const ATTR_TYPE_RE = /^[a-z0-9]+-attr$/u;

function isAttributeToken(token: TokenLike): boolean {
  return typeof token.type === "string" && ATTR_TYPE_RE.test(token.type);
}

function findAttributesToken(token: TokenLike): TokenLike | undefined {
  return token.childNodes?.find(
    (child) => typeof child.type === "string" && ATTRS_TYPES.has(child.type),
  );
}

/**
 * 从 html/table/ext 的 `*-attrs` 子 token 提取属性。
 * 只做解码，不做安全白名单判断。
 */
export function extractAttributes(
  token: TokenLike,
  decode: (text: string) => string,
): RawAttribute[] {
  const attrsToken = findAttributesToken(token);
  if (!attrsToken?.childNodes) {
    return [];
  }
  const result: RawAttribute[] = [];
  for (const child of attrsToken.childNodes) {
    if (!isAttributeToken(child) || !child.name) {
      continue;
    }
    const valueToken = child.childNodes?.find((node) => node.type === "attr-value");
    const rawValue = valueToken?.toString() ?? "";
    result.push({
      name: child.name.toLowerCase(),
      value: rawValue ? decode(rawValue) : null,
      token: child,
    });
  }
  return result;
}

/**
 * 把原始属性转换为带源码区间的语法属性。
 * @param attributes 解码后的原始属性。
 * @param tokenRanges token 到源码区间的映射。
 * @param fallback 找不到 token 区间时使用的默认区间。
 */
export function toSyntaxAttributes(
  attributes: readonly RawAttribute[],
  tokenRanges: WeakMap<TokenLike, readonly [number, number]>,
  fallback: readonly [number, number],
): WikitextSyntaxAttribute[] {
  return attributes.map(({ name, value, token }) => ({
    name,
    value,
    range: tokenRanges.get(token) ?? fallback,
  }));
}
