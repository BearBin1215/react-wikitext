import minimum from "wikiparser-node/config/minimum.json";
import zhwiki from "wikiparser-node/config/zhwiki.json";
import type { ParserConfig } from "@/configs";

export const MINIMUM_CONFIG = minimum as unknown as ParserConfig;
export const ZH_CONFIG = zhwiki as unknown as ParserConfig;

export function configWithHtmlTags(tags: readonly string[]): ParserConfig {
  const config = structuredClone(MINIMUM_CONFIG);
  const html = config.html as string[][];
  html[0]!.push(...tags);
  return config;
}
