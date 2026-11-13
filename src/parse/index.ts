export { createWikiparser, parseWikitext } from "./adapter";
export type { CreateWikiparserOptions } from "./adapter";
export {
  createWikitextParser,
  type CreateParserOptions,
  type WikitextBuildOptions,
  type WikitextCompileOptions,
  type WikitextParseOptions,
  type WikitextParser,
  type WikitextParserAdapter,
  type WikitextParserContext,
  type WikitextParserLimits,
  type WikitextResolvedParseOptions,
  type WikitextSyntaxProgram,
} from "../parser";
export { DEFAULT_MAX_SOURCE_LENGTH } from "../ast/source";
export type { ResolvedParseLimits } from "../ast/limits";
export { WikitextError, WikitextParseError, type WikitextErrorCode } from "../ast/errors";
export type {
  KnownWikitextDiagnosticCode,
  WikitextDiagnostic,
  WikitextDiagnosticCode,
  WikitextNode,
  WikitextParsedMeta,
  WikitextParsedSnapshot,
  WikitextSyntaxAttribute,
  WikitextSyntaxNode,
  WikitextSyntaxRoot,
} from "../ast/model";
export {
  getSourcePosition,
  getSpanText,
  mapSourceSpan,
  type WikitextSourceGraph,
  type WikitextSourceSpan,
} from "../ast/sourceGraph";
