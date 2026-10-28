import * as ParserBundle from "wikiparser-node/bundle/bundle.min.js";
import { WikitextParseError } from "../ast/errors";

// 包声明了 sideEffects:false，bundle 又没有 ESM 导出，`void` 不足以阻止打包器移除模块。
// 因此在模块加载时读取一次全局对象，确保 IIFE 得到执行。
const parserBundleKeys = Object.keys(ParserBundle as Record<string, unknown>).length;

/** 上游 token 中本包会用到的字段。 */
export interface TokenLike {
  readonly type?: string;
  readonly name?: string;
  readonly data?: string;
  readonly level?: number;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly anon?: boolean;
  readonly modifier?: string;
  readonly closed?: boolean;
  readonly closing?: boolean;
  readonly selfClosing?: boolean;
  readonly subtype?: string;
  readonly extension?: string;
  readonly childNodes?: readonly TokenLike[];
  toString(): string;
}

interface UpstreamParser {
  parse(
    source: string,
    include?: boolean,
    maxStage?: number,
    config?: unknown,
    pageName?: string,
  ): TokenLike;
}

// 导入后立即捕获；不要等到第一次 parse 才读取全局对象，否则可能读到后续加载的另一份副本。
const capturedParser = (globalThis as { Parser?: UpstreamParser }).Parser;

/** 读取 bundle 挂到全局对象上的解析器；不可用时抛出 `PARSER_UNAVAILABLE`。 */
export function getBrowserParser(): UpstreamParser {
  if (!capturedParser || typeof capturedParser.parse !== "function") {
    throw new WikitextParseError(
      "PARSER_UNAVAILABLE",
      "wikiparser-node browser bundle did not initialize globalThis.Parser " +
        `(namespace keys: ${parserBundleKeys}).`,
    );
  }
  return capturedParser;
}

/** 适配器名称，写入文档元数据。 */
export const PARSER_NAME = "wikiparser-node";
/** 适配器对应的上游版本。 */
export const PARSER_VERSION = "1.48.1";
/** 与浏览器包默认阶段一致；升级解析器时需要重新审查。 */
export const PARSE_MAX_STAGE = 11;
