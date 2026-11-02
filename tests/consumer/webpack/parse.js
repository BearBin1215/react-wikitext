import { flattenNodes } from "react-wikitext/ast";
import { prepareWikitext } from "react-wikitext/hast";
import { parseWikitext } from "react-wikitext/parse";
import { SOURCE } from "./fixture.js";
import { summarize } from "./hast.js";

const document = parseWikitext(SOURCE);
const prepared = prepareWikitext(document);

globalThis.consumerResult = {
  parser: document.meta.parser,
  parserVersion: document.meta.parserVersion,
  sourceLength: document.source.length,
  nodes: flattenNodes(document.ast).length,
  ...summarize(prepared.hast),
};
