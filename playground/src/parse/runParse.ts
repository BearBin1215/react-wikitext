import { expandWikitext, type WikitextExpansionInfo } from "react-wikitext/expand";
import {
  createWikiparser,
  type WikitextDocument,
  type WikitextParseOptions,
  type WikitextParser,
} from "react-wikitext/parse";
import { PARSER_CONFIGS, type ParserConfigKey } from "./configs";
import { createFallbackParser, MOCK_TEMPLATES } from "./fixtures";
import type { ParsePayload, ParseRequest, ParseStats } from "./protocol";

const parsers = new Map<ParserConfigKey, WikitextParser>();
const fallbackParsers = new Map<ParserConfigKey, WikitextParser>();

function parserFor(configKey: ParserConfigKey): WikitextParser {
  let parser = parsers.get(configKey);
  if (!parser) {
    parser = createWikiparser({ config: PARSER_CONFIGS[configKey] });
    parsers.set(configKey, parser);
  }
  return parser;
}

function expandParserFor(configKey: ParserConfigKey, fallback: boolean): WikitextParser {
  if (!fallback) {
    return parserFor(configKey);
  }
  let parser = fallbackParsers.get(configKey);
  if (!parser) {
    parser = createFallbackParser(parserFor(configKey));
    fallbackParsers.set(configKey, parser);
  }
  return parser;
}

/** 解析选项的唯一映射；复现片段也复用它。 */
export function buildParseOptions(
  request: Pick<ParseRequest, "pageName" | "maxSourceLength" | "maxNodeCount">,
): WikitextParseOptions {
  return {
    pageName: request.pageName,
    retainSyntax: true,
    ...(request.maxSourceLength === undefined ? {} : { maxSourceLength: request.maxSourceLength }),
    ...(request.maxNodeCount === undefined ? {} : { maxSemanticNodes: request.maxNodeCount }),
  };
}

/** 执行一次 playground 解析；worker 与主线程共用同一路径。 */
export async function runParse(request: ParseRequest): Promise<ParsePayload> {
  const parseOptions = buildParseOptions(request);
  if (request.expandTemplates) {
    // 展开入口单独接收 pageName，解析选项里不应再带一份。
    const expandParseOptions = { ...parseOptions };
    delete expandParseOptions.pageName;
    const result = await expandWikitext(request.source, {
      parser: expandParserFor(request.configKey, request.expandFallback),
      pageName: request.pageName,
      parseOptions: expandParseOptions,
      templates: MOCK_TEMPLATES,
    });
    return { doc: result.document, expansion: result.expansion };
  }
  return { doc: parserFor(request.configKey).parse(request.source, parseOptions) };
}

/** 组装统计信息；worker 与主线程使用同一格式。 */
export function statsFor(request: ParseRequest, durationMs: number): ParseStats {
  return {
    durationMs: Math.round(durationMs * 10) / 10,
    configKey: request.configKey,
    pageName: request.pageName,
  };
}

export type { WikitextDocument, WikitextExpansionInfo };
