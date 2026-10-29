import { WikitextParseError } from "@/ast/errors";
import { createWikiparser, type WikitextParser } from "@/parse";

/** 包装默认 parser：原始源码、模板源码或最终源码与 `marker` 相同时抛解析错误。 */
export function parserThrowingOn(marker: string): WikitextParser {
  const base = createWikiparser();
  return {
    name: "marker-parser",
    version: "1.0.0",
    resolveOptions: (options) => base.resolveOptions(options),
    parse(source, options) {
      if (source === marker) {
        throw new WikitextParseError("PARSE_FAILED", `Rejected marker source: ${marker}`);
      }
      return base.parse(source, options);
    },
  };
}
