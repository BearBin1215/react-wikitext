import minimum from "wikiparser-node/config/minimum.json";
import zhwiki from "wikiparser-node/config/zhwiki.json";
import { MEDIAWIKI_CONFIG, type ParserConfig } from "react-wikitext/configs";

export const PARSER_CONFIG_KEYS = ["mediawiki", "zhwiki", "minimum"] as const;

export type ParserConfigKey = (typeof PARSER_CONFIG_KEYS)[number];

export const PARSER_CONFIGS: Record<ParserConfigKey, ParserConfig> = {
  mediawiki: MEDIAWIKI_CONFIG,
  zhwiki: zhwiki as unknown as ParserConfig,
  minimum: minimum as unknown as ParserConfig,
};

export const PARSER_CONFIG_LABELS: Record<ParserConfigKey, string> = {
  mediawiki: "mediawiki（内置默认）",
  zhwiki: "zhwiki（中文维基）",
  minimum: "minimum（内置最小配置）",
};
