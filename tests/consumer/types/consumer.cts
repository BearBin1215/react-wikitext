/**
 * CJS 类型入口：验证 `require` 条件会解析到 `.d.cts`，
 * 且 `/view`、`/configs` 等子路径在 CJS 下同样有类型。
 */
import { createElement } from "react";
import { MEDIAWIKI_CONFIG, type ParserConfig } from "react-wikitext/configs";
import {
  createTemplateTableProvider,
  createWikitextCompiler,
  type WikitextTemplateTable,
} from "react-wikitext/expand";
import { prepareWikitext, type WikitextRenderSnapshot } from "react-wikitext/hast";
import { createWikiparser, parseWikitext, type WikitextParsedSnapshot } from "react-wikitext/parse";
import {
  AstTree,
  NodeInspector,
  type AstTreeProps,
  type NodeInspectorProps,
} from "react-wikitext/devtools";
import { WikitextView, type WikitextViewProps } from "react-wikitext/view";

const config: ParserConfig = MEDIAWIKI_CONFIG;
const document: WikitextParsedSnapshot = parseWikitext("== A ==", { pageName: "Page" });
const prepared: WikitextRenderSnapshot = prepareWikitext(document);
const props: WikitextViewProps = { snapshot: prepared, idPrefix: "" };
const astTreeProps: AstTreeProps = {
  document,
  kind: "semantic",
  selectedId: null,
  getNodeLabel: (_node, fallback) => fallback,
};
const inspectorProps: NodeInspectorProps = {
  document: prepared,
  node: prepared.ast,
  style: { height: 480 },
};

const templateTable: WikitextTemplateTable = new Map([
  ["Template:A", "a"],
  ["Template:B", "b"],
]);
const compiler = createWikitextCompiler({
  parser: createWikiparser(),
  provider: createTemplateTableProvider({
    key: "consumer",
    revision: "v1",
    templates: templateTable,
  }),
});
const input = { key: "page", revision: "1", text: "{{A}}{{B}}" };

export const element = createElement(WikitextView, props);
export const astTreeElement = createElement(AstTree, astTreeProps);
export const inspectorElement = createElement(NodeInspector, inspectorProps);
export const parserName = config.parserFunction.length;
export const expanded = compiler.compile(input);
export const expandedPure = compiler.compile({ ...input, text: "{{#if:1|a|b}}" });
