import defaultConfig from "./mediawiki.json";
import type { ParserConfig } from "./types";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/**
 * 来源：wikiparser-node@1.48.1/config/default.json 快照。
 * 上游未标注对应的 MediaWiki 版本，这里保留上游文件名与版本，不冒充站点配置。
 * `excludes` 与 `doubleUnderscore` 的数组形式由 `normalizeConfig` 在深拷贝后补齐。
 *
 * 常量本身被深冻结：修改它不会影响解析器，只会得到运行时错误。
 * 需要调整站点配置时使用 `createMediaWikiConfig` 生成覆盖后的副本。
 */
export const MEDIAWIKI_CONFIG: ParserConfig = deepFreeze(defaultConfig as unknown as ParserConfig);
