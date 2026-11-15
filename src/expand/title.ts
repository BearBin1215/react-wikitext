import type { ResolvedParseLimits } from "../ast/limits";
import type { WikitextParser } from "../parser";
import type { WikitextLruCache } from "./cache";

/**
 * 创建模板标题规范化函数。
 *
 * 规范化交给 parser：把文本包成 `{{...}}` 编译一次，读取模板名。结果按
 * 页面名与文本缓存；编译失败按“无法解析”缓存，避免重复尝试。
 * @param parser 宿主注入的解析器。
 * @param cache 标题缓存。
 */
export function createTitleResolver(
  parser: WikitextParser,
  cache: WikitextLruCache<string | null>,
): (text: string, pageName: string | undefined, limits: ResolvedParseLimits) => string | undefined {
  return (text, pageName, limits) => {
    const key = `${pageName ?? ""}\u0000${text}`;
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached ?? undefined;
    }
    let title: string | null = null;
    const snippet = `{{${text}}}`;
    try {
      const program = parser.compile(snippet, {
        ...(pageName === undefined ? {} : { pageName }),
        maxSourceLength: Math.max(limits.maxSourceLength, snippet.length),
      });
      const template = program.syntax.children.find((child) => child.type === "template");
      const parsed = template?.props.name;
      title = typeof parsed === "string" && parsed ? parsed : null;
    } catch {
      title = null;
    }
    cache.set(key, title);
    return title ?? undefined;
  };
}
