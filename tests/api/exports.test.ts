import { describe, expect, it } from "vitest";
import * as rootEntry from "@/index";
import * as ast from "@/ast";
import * as parse from "@/parse";
import * as expand from "@/expand";
import * as hast from "@/hast";
import * as unified from "@/unified";
import * as view from "@/view";
import * as configs from "@/configs";

/**
 * 公共导出面：新增或删除这些符号时，同步更新文档站的 API 参考页。
 * 这里只固定主要运行时导出，类型导出由 consumer 类型测试覆盖。
 */
const SURFACE = {
  root: ["Wikitext", "WikitextView", "WikitextFragment", "useWikitextIds", "WikitextError"],
  ast: [
    "AST_SCHEMA_VERSION",
    "RENDER_SCHEMA_VERSION",
    "SYNTAX_SCHEMA_VERSION",
    "WikitextError",
    "WikitextParseError",
    "createWikitextParser",
    "findNodeAtOffset",
    "flattenNodes",
    "getFileParameters",
    "getSourceText",
    "getTemplateParameters",
    "toPlainText",
  ],
  parse: [
    "DEFAULT_MAX_SOURCE_LENGTH",
    "WikitextError",
    "WikitextParseError",
    "createWikiparser",
    "createWikitextParser",
    "parseWikitext",
  ],
  expand: ["WikitextError", "WikitextExpandError", "expandWikitext"],
  hast: [
    "DEFAULT_PREPARE_POLICY",
    "DEFAULT_WIKITEXT_LABELS",
    "WikitextError",
    "WikitextPrepareError",
    "prepareWikitext",
    "prepareWikitextAsync",
    "restoreWikitextRenderDocument",
    "sanitizeHref",
    "sanitizeImageUrl",
    "sanitizedAttributesToProps",
    "serializeWikitextRenderDocument",
  ],
  unified: ["createWikitextProcessor", "getWikitextDocument", "getWikitextRenderDocument"],
  view: [
    "WikitextFragment",
    "WikitextView",
    "useWikitextContext",
    "useWikitextIds",
    "useWikitextLabels",
  ],
  configs: ["MEDIAWIKI_CONFIG", "createMediaWikiConfig"],
} as const;

describe("public export surface", () => {
  it.each([
    ["root", rootEntry],
    ["ast", ast],
    ["parse", parse],
    ["expand", expand],
    ["hast", hast],
    ["unified", unified],
    ["view", view],
    ["configs", configs],
  ] as const)("%s keeps its runtime exports", (name, module) => {
    const exported = new Set(Object.keys(module));
    for (const symbol of SURFACE[name]) {
      expect(exported.has(symbol), `${name}: ${symbol}`).toBe(true);
    }
  });

  it("does not export internal state helpers from the root entry", () => {
    expect("prepareWikitext" in rootEntry).toBe(false);
    expect("parseWikitext" in rootEntry).toBe(false);
  });
});
