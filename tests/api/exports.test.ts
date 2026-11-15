import { describe, expect, it } from "vitest";
import * as rootEntry from "@/index";
import * as ast from "@/ast";
import * as parse from "@/parse";
import * as expand from "@/expand";
import * as hast from "@/hast";
import * as unified from "@/unified";
import * as view from "@/view";
import * as preview from "@/preview";
import * as worker from "@/worker";
import * as configs from "@/configs";
import * as devtools from "@/devtools";

/**
 * 公共导出面：新增或删除这些符号时，同步更新文档站的 API 参考页。
 * 这里只固定主要运行时导出，类型导出由 consumer 类型测试覆盖。
 */
const SURFACE = {
  root: ["Wikitext", "WikitextView", "WikitextFragment", "useWikitextIds", "WikitextError"],
  ast: [
    "AST_SCHEMA_VERSION",
    "COMPILATION_SCHEMA_VERSION",
    "RENDER_SCHEMA_VERSION",
    "SOURCE_GRAPH_VERSION",
    "SYNTAX_SCHEMA_VERSION",
    "WikitextError",
    "WikitextParseError",
    "createWikitextParser",
    "findNodeAtOffset",
    "findNodeById",
    "findRenderedNodes",
    "findSource",
    "findSourceByRole",
    "flattenNodes",
    "getFileParameters",
    "getSourcePosition",
    "getSourceText",
    "getSpanText",
    "getTemplateParameters",
    "hashText",
    "isNodeType",
    "locateRenderedNode",
    "mapSourceSpan",
    "toPlainText",
    "validateSourceGraph",
  ],
  parse: [
    "DEFAULT_MAX_SOURCE_LENGTH",
    "WikitextError",
    "WikitextParseError",
    "createWikiparser",
    "createWikitextParser",
    "parseWikitext",
  ],
  expand: [
    "WikitextError",
    "WikitextExpandError",
    "createWikitextCompiler",
    "createTemplateTableProvider",
  ],
  hast: [
    "DEFAULT_PREPARE_POLICY",
    "DEFAULT_WIKITEXT_LABELS",
    "WikitextError",
    "WikitextPrepareError",
    "prepareWikitext",
    "prepareWikitextAsync",
    "restoreWikitextRenderSnapshot",
    "sanitizeHref",
    "sanitizeImageUrl",
    "sanitizedAttributesToProps",
    "serializeWikitextRenderSnapshot",
  ],
  unified: ["createWikitextProcessor", "getWikitextSnapshot", "getWikitextRenderSnapshot"],
  view: [
    "WikitextFragment",
    "WikitextView",
    "useWikitextContext",
    "useWikitextIds",
    "useWikitextLabels",
  ],
  preview: ["useWikitextPreview", "createWikitextWorkerExecutor"],
  worker: ["attachWikitextWorker", "createWikitextWorkerHandler"],
  configs: ["MEDIAWIKI_CONFIG", "createMediaWikiConfig"],
  devtools: [
    "AstTree",
    "NodeInspector",
    "DEFAULT_AST_TREE_LABELS",
    "DEFAULT_NODE_INSPECTOR_LABELS",
    "findAstTreeNode",
    "getNodeRange",
    "getNodeSource",
    "isSyntaxNode",
    "remapExpandedIds",
    "restoreSelectedId",
    "snapshotSelection",
  ],
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
    ["preview", preview],
    ["worker", worker],
    ["configs", configs],
    ["devtools", devtools],
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

  it("keeps source graph construction out of public entries", () => {
    const modules = [
      rootEntry,
      ast,
      parse,
      expand,
      hast,
      unified,
      view,
      preview,
      worker,
      configs,
      devtools,
    ];
    for (const symbol of [
      "bindSegmentSources",
      "createSourceGraphBuilder",
      "effectiveSourceId",
      "expandedSourceId",
      "inputSourceId",
      "normalizeWithSegments",
      "normalizedSourceId",
      "templateSourceId",
    ]) {
      for (const module of modules) {
        expect(symbol in module, symbol).toBe(false);
      }
    }
  });
});
