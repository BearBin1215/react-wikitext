/**
 * CJS 类型入口：验证 `require` 条件会解析到 `.d.cts`，
 * 且 `/view`、`/configs` 等子路径在 CJS 下同样有类型。
 */
import { createElement } from "react";
import { MEDIAWIKI_CONFIG, type ParserConfig } from "react-wikitext/configs";
import {
  expandWikitext,
  type WikitextExpandOptions,
  type WikitextTemplateTable,
} from "react-wikitext/expand";
import { prepareWikitext, type WikitextRenderDocument } from "react-wikitext/hast";
import { parseWikitext, type WikitextDocument } from "react-wikitext/parse";
import { WikitextView, type WikitextViewProps } from "react-wikitext/view";

const config: ParserConfig = MEDIAWIKI_CONFIG;
const document: WikitextDocument = parseWikitext("== A ==", { pageName: "Page" });
const prepared: WikitextRenderDocument = prepareWikitext(document);
const props: WikitextViewProps = { document: prepared, idPrefix: "" };

const templateTable: WikitextTemplateTable = new Map([["Template:A", "a"]]);
const expandOptions: WikitextExpandOptions = {
  templates: templateTable,
  resolveTemplate: ({ title }) => (title === "Template:B" ? "b" : null),
};

export const element = createElement(WikitextView, props);
export const parserName = config.parserFunction.length;
export const expanded = expandWikitext("{{A}}{{B}}", expandOptions);
export const expandedPure = expandWikitext("{{#if:1|a|b}}");
