import { WikitextParseError } from "../ast/errors";
import {
  createWikitextParser,
  type WikitextParseOptions,
  type WikitextParser,
  type WikitextParserAdapter,
} from "../ast/parser";
import { normalizeConfig } from "../configs/config";
import type { ParserConfig } from "../configs/types";
import { buildSyntaxTree } from "./buildSyntax";
import { getBrowserParser, PARSE_MAX_STAGE, PARSER_NAME, PARSER_VERSION } from "./loadParser";

/** 创建默认解析器时的选项。 */
export interface CreateWikiparserOptions {
  /** 站点配置；工厂创建时会深拷贝并固定下来，后续修改原对象不会影响解析器。 */
  readonly config?: ParserConfig;
  /** 每次解析使用的默认选项。 */
  readonly defaults?: WikitextParseOptions;
}

/** 上游默认配置缺少部分 `#函数` 别名；在默认适配器快照中补齐，不改写共享配置。 */
const PARSER_FUNCTION_ALIASES = [
  "#urlencode",
  "#lc",
  "#uc",
  "#lcfirst",
  "#ucfirst",
  "#padleft",
  "#padright",
] as const;

function addParserFunctionAliases(config: ParserConfig): void {
  const table = config.parserFunction as unknown[];
  for (const entry of table.slice(0, 2)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const aliases = entry as Record<string, unknown>;
    for (const name of PARSER_FUNCTION_ALIASES) {
      if (aliases[name] === undefined) {
        aliases[name] = name.slice(1);
      }
    }
  }
}

/**
 * 默认上游适配器：把 wikiparser-node 浏览器 bundle 的 token 树转换为
 * 本包定义的源码语法树。上游配置由这个适配器保存。
 * @param config 站点配置。
 */
function createWikiparserAdapter(config?: ParserConfig): WikitextParserAdapter {
  const snapshot = normalizeConfig(config);
  addParserFunctionAliases(snapshot);
  return {
    name: PARSER_NAME,
    version: PARSER_VERSION,
    parse(source, context) {
      let rootToken;
      try {
        rootToken = getBrowserParser().parse(
          source,
          false,
          PARSE_MAX_STAGE,
          snapshot,
          context.pageName,
        );
      } catch (error) {
        if (error instanceof WikitextParseError) {
          throw error;
        }
        throw new WikitextParseError(
          "PARSE_FAILED",
          "wikiparser-node failed to parse the source.",
          { cause: error },
        );
      }
      if (!rootToken || typeof rootToken.toString !== "function") {
        throw new WikitextParseError(
          "PARSE_FAILED",
          "wikiparser-node returned an invalid token tree.",
        );
      }
      return buildSyntaxTree(rootToken, source, context.limits);
    },
  };
}

/**
 * 使用默认配置或显式站点配置创建解析器。
 * 配置会在创建时固定；更换配置需要创建新的解析器。
 * @param options 站点配置与默认解析选项。
 */
export function createWikiparser(options: CreateWikiparserOptions = {}): WikitextParser {
  const adapter = createWikiparserAdapter(options.config);
  return createWikitextParser(adapter, { defaults: options.defaults });
}

let defaultParser: WikitextParser | undefined;

/** 默认配置的共享 parser；`parseWikitext` 与 `/expand` 共用同一实例。 */
export function getDefaultParser(): WikitextParser {
  defaultParser ??= createWikiparser();
  return defaultParser;
}

/**
 * 简洁入口：用默认配置的解析器解析源码，适合一次性渲染。
 * @param source 待解析的源码。
 * @param options 解析选项。
 */
export function parseWikitext(source: string, options: WikitextParseOptions = {}) {
  return getDefaultParser().parse(source, options);
}
