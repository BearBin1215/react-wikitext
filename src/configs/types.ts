import type { ConfigData } from "wikiparser-node";

/**
 * 浏览器 parse 需要的站点配置。上游 `config/*.json` 没有 `excludes`，
 * 由 `normalizeConfig` 补齐；`excludes` 在这里声明为可选。
 */
export type ParserConfig = ConfigData & { excludes?: string[] };
