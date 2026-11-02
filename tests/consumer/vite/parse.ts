import { flattenNodes } from "react-wikitext/ast";
import { prepareWikitext } from "react-wikitext/hast";
import { parseWikitext } from "react-wikitext/parse";
import { SOURCE } from "./fixture";
import { summarize } from "./hast";

const document = parseWikitext(SOURCE);
const prepared = prepareWikitext(document);
const summary = summarize(prepared.hast);

(globalThis as { consumerResult?: unknown }).consumerResult = {
  parser: document.meta.parser,
  parserVersion: document.meta.parserVersion,
  sourceLength: document.source.length,
  nodes: flattenNodes(document.ast).length,
  ...summary,
};
