import { isExternalHref } from "../shared/url";

const SAFE_REL_TOKENS = new Set(["nofollow", "noopener", "noreferrer"]);

interface SafeRelOptions {
  readonly href: string;
  readonly target?: unknown;
  /** 调用方已知的语义外链标记；未提供时按绝对协议判断。 */
  readonly external?: boolean;
}

function relTokens(value: unknown): string[] {
  if (typeof value === "string") {
    return value.split(/\s+/u).filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.filter((token): token is string => typeof token === "string");
  }
  return [];
}

/**
 * 过滤既有 token 并按链接目标补齐安全 `rel`。
 * 与 MediaWiki 1.43 一致：外链补 `nofollow`，仅在 `_blank` 时追加
 * `noreferrer noopener`；相对链接在 `_blank` 时补 `noopener noreferrer`。
 */
export function resolveSafeRel(value: unknown, options: SafeRelOptions): string[] | undefined {
  const rel = relTokens(value).filter((token) => SAFE_REL_TOKENS.has(token));
  const external = options.external ?? isExternalHref(options.href);
  if (external) {
    rel.push("nofollow");
    if (options.target === "_blank") {
      rel.push("noreferrer", "noopener");
    }
  } else if (options.target === "_blank") {
    rel.push("noopener", "noreferrer");
  }
  return rel.length > 0 ? [...new Set(rel)] : undefined;
}
