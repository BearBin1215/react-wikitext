import { createRequire } from "node:module";
import {
  createWikiparser,
  parseWikitext,
  type WikitextDocument,
  type WikitextParseOptions,
  type WikitextParser,
  type WikitextSyntaxNode,
} from "@/parse";
import { PARSE_MAX_STAGE } from "@/parse/loadParser";
import { MEDIAWIKI_CONFIG, type ParserConfig } from "@/configs";
import { normalizeConfig } from "@/configs/config";

const require = createRequire(import.meta.url);
interface NodeParserModule {
  default: {
    parse(
      source: string,
      include: boolean,
      maxStage: number,
      config: ParserConfig,
      page?: string,
    ): {
      json(): OracleNode;
      toHtml(): string;
    };
  };
}
const NodeParser = (require("wikiparser-node") as NodeParserModule).default;

interface OracleNode {
  type?: string;
  name?: string;
  data?: string;
  range?: [number, number];
  childNodes?: OracleNode[];
}

interface TestParseOptions extends WikitextParseOptions {
  readonly config?: ParserConfig;
}

export function cloneConfig(config: ParserConfig = MEDIAWIKI_CONFIG): ParserConfig {
  return normalizeConfig(config);
}

function createParser(config: ParserConfig = MEDIAWIKI_CONFIG): WikitextParser {
  return createWikiparser({ config: cloneConfig(config) });
}

export function parse(source: string, options: TestParseOptions = {}): WikitextDocument {
  const { config, ...rest } = options;
  const parseOptions: WikitextParseOptions = {
    pageName: "Demo",
    retainSyntax: true,
    ...rest,
  };
  return config
    ? createParser(config).parse(source, parseOptions)
    : parseWikitext(source, parseOptions);
}

function oracleJson(source: string, config: ParserConfig = MEDIAWIKI_CONFIG): OracleNode {
  return NodeParser.parse(source, false, PARSE_MAX_STAGE, cloneConfig(config), "Demo").json();
}

export function oracleHtml(source: string, config: ParserConfig = MEDIAWIKI_CONFIG): string {
  return NodeParser.parse(source, false, PARSE_MAX_STAGE, cloneConfig(config), "Demo").toHtml();
}

function flattenOracle(node: OracleNode, path = "0"): Array<{ node: OracleNode; path: string }> {
  const result = [{ node, path }];
  for (const [index, child] of (node.childNodes ?? []).entries()) {
    result.push(...flattenOracle(child, `${path}.${index}`));
  }
  return result;
}

interface RangeDifference {
  path: string;
  type: string;
  expected: [number, number];
  actual: [number, number];
  zeroLength: boolean;
}

function flattenSyntax(
  root: WikitextSyntaxNode,
  path = "0",
): Array<{ node: WikitextSyntaxNode; path: string }> {
  const result = [{ node: root, path }];
  for (const [index, child] of root.children.entries()) {
    result.push(...flattenSyntax(child, `${path}.${index}`));
  }
  return result;
}

export function compareRanges(source: string, config?: ParserConfig): RangeDifference[] {
  const normalized = source.replace(/\r\n?/gu, "\n");
  const doc = parse(normalized, config ? { config } : {});
  if (!doc.syntax) {
    throw new Error("compareRanges requires retainSyntax.");
  }
  const oracle = oracleJson(normalized, config);
  const differences: RangeDifference[] = [];
  const oracleNodes = flattenOracle(oracle);
  const actualNodes = flattenSyntax(doc.syntax);

  for (let index = 0; index < Math.max(oracleNodes.length, actualNodes.length); index++) {
    const expected = oracleNodes[index];
    const actual = actualNodes[index];
    if (!expected || !actual) {
      differences.push({
        path: expected?.path ?? actual?.path ?? String(index),
        type: expected?.node.type ?? actual?.node.type ?? "missing",
        expected: expected?.node.range ?? [-1, -1],
        actual: actual?.node.range ? [actual.node.range[0], actual.node.range[1]] : [-1, -1],
        zeroLength: false,
      });
      continue;
    }
    const expectedRange = expected.node.range ?? [-1, -1];
    const actualRange: [number, number] = [actual.node.range[0], actual.node.range[1]];
    if (expectedRange[0] !== actualRange[0] || expectedRange[1] !== actualRange[1]) {
      differences.push({
        path: expected.path,
        type: expected.node.type ?? actual.node.type,
        expected: expectedRange,
        actual: actualRange,
        zeroLength: expectedRange[0] === expectedRange[1],
      });
    }
  }
  return differences;
}
