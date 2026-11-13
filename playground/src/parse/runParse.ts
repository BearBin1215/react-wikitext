import { hashText } from "react-wikitext/ast";
import {
  createTemplateTableProvider,
  createWikitextCompiler,
  type WikitextCompiler,
} from "react-wikitext/expand";
import {
  createWikiparser,
  type WikitextParsedSnapshot,
  type WikitextParseOptions,
  type WikitextParser,
} from "react-wikitext/parse";
import { PARSER_CONFIGS, type ParserConfigKey } from "./configs";
import { createFallbackParser, MOCK_TEMPLATES } from "./fixtures";
import type { ParsePayload, ParseRequest, ParseStats, WikitextExpansionInfo } from "./protocol";

const parsers = new Map<ParserConfigKey, WikitextParser>();
const fallbackParsers = new Map<ParserConfigKey, WikitextParser>();
const compilers = new Map<string, WikitextCompiler>();

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

/** 校验台的编译会话；按配置与回退模式复用，换配置时新建实例。 */
function compilerFor(configKey: ParserConfigKey, fallback: boolean): WikitextCompiler {
  const key = `${configKey}:${fallback ? "fallback" : "plain"}`;
  let compiler = compilers.get(key);
  if (!compiler) {
    compiler = createWikitextCompiler({
      parser: expandParserFor(configKey, fallback),
      provider: createTemplateTableProvider({
        key: "playground:offline",
        revision: "playground-v1",
        templates: MOCK_TEMPLATES,
      }),
    });
    compilers.set(key, compiler);
  }
  return compiler;
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

/** 把来源图中的顶层调用映射为验收台展示记录。 */
function expansionInfo(snapshot: WikitextParsedSnapshot): WikitextExpansionInfo {
  const records = snapshot.graph.invocations
    .filter((invocation) => invocation.parentId === undefined)
    .map((invocation) => {
      const output = invocation.outputs[0];
      return {
        kind: invocation.kind,
        name: invocation.name,
        originalRange: [invocation.start, invocation.end] as const,
        expandedRange: output
          ? ([output.start, output.end] as const)
          : ([invocation.start, invocation.end] as const),
        status: invocation.status,
      };
    });
  return {
    status: "complete",
    records,
    diagnostics: snapshot.diagnostics.filter((diagnostic) => diagnostic.stage === "expand"),
  };
}

/** 执行一次 playground 解析；worker 与主线程共用同一路径。 */
export async function runParse(request: ParseRequest): Promise<ParsePayload> {
  const parseOptions = buildParseOptions(request);
  if (request.expandTemplates) {
    // 展开入口单独接收 pageName，解析选项里不应再带一份。
    const expandParseOptions = { ...parseOptions };
    delete expandParseOptions.pageName;
    const compilation = await compilerFor(request.configKey, request.expandFallback).compile(
      {
        key: `playground:${request.configKey}`,
        revision: hashText(request.source),
        text: request.source,
      },
      {
        pageName: request.pageName,
        parseOptions: expandParseOptions,
        retainSyntax: true,
      },
    );
    const expansion = expansionInfo(compilation.snapshot);
    return {
      doc: compilation.snapshot,
      expansion: { ...expansion, status: compilation.status },
    };
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

export type { WikitextParsedSnapshot, WikitextExpansionInfo };
