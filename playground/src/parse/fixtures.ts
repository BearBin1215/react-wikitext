import { WikitextParseError, type WikitextParser } from "react-wikitext/parse";

/** 展开验收台使用的模板快照；不含对应条目时按模板缺失处理。 */
export const MOCK_TEMPLATES: Readonly<Record<string, string>> = {
  "Template:Demo/Box": '{| class="wikitable"\n! 名称\n|-\n| {{{name|示例}}}\n|}',
  "Template:Demo/List": "* {{{1|甲}}}\n* {{{2|乙}}}",
  "Template:Demo/Echo": "{{{1}}}",
  "Template:Demo/Loop": "{{Demo/Loop}}",
  "Template:Demo/Broken": "BROKEN",
};

const FALLBACK_MARKER = "前缀BROKEN后缀";

/** 包装基础 parser，最终源码命中标记时抛错，用于模拟回退。 */
export function createFallbackParser(base: WikitextParser): WikitextParser {
  const guard = (source: string): void => {
    if (source.includes(FALLBACK_MARKER)) {
      throw new WikitextParseError(
        "PARSE_FAILED",
        "模拟最终解析失败：展开结果触发了验收台注入的 parser 错误。",
      );
    }
  };
  return {
    name: base.name,
    version: base.version,
    key: `${base.key}:fallback`,
    resolveOptions: (options) => base.resolveOptions(options),
    compile(source, options) {
      guard(source);
      return base.compile(source, options);
    },
    build(program, options) {
      return base.build(program, options);
    },
    parse(source, options) {
      guard(source);
      return base.parse(source, options);
    },
  };
}
