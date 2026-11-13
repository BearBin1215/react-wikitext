import { flattenNodes, type WikitextParsedSnapshot, type WikitextNode } from "react-wikitext/ast";
import type { WikitextRenderSnapshot } from "react-wikitext/hast";
import type { WikitextExpansionInfo } from "@pg/parse/protocol";
import { DEFAULT_MAX_SOURCE_LENGTH } from "react-wikitext/parse";
import { SCENE_GROUP_LABELS, SOURCE_GROUPS, type SceneDefinition } from "@pg/catalog";
import { buildParseOptions } from "@pg/parse/runParse";
import type { ParseErrorInfo } from "@pg/parse/protocol";
import { DEFAULT_MAX_NODES, type PlaygroundOptions } from "@pg/state/options";
import type { StatusFacts } from "@pg/ui/facts";

/** 复现信息所需的快照；所有字段来自会话派生值。 */
export interface ReproInput {
  readonly scene: SceneDefinition;
  readonly text: string;
  readonly parseText: string;
  readonly options: PlaygroundOptions;
  readonly document?: WikitextParsedSnapshot;
  readonly prepared?: WikitextRenderSnapshot;
  readonly error?: ParseErrorInfo;
  readonly prepareError?: ParseErrorInfo;
  readonly expansion?: WikitextExpansionInfo;
  readonly selectedNode?: WikitextNode;
  readonly facts: StatusFacts;
}

function fenceFor(source: string): string {
  return source.includes("```") ? "````" : "```";
}

function prepareOptionsJson(input: ReproInput): Record<string, unknown> {
  return {
    headingIdStrategy: input.options.headingIdStrategy,
    policy: { externalLinkTarget: input.options.externalLinkTarget },
    labels: input.options.labelLanguage,
    resolveLink: input.options.linkResolver,
    resolveImage: input.options.imageResolver,
  };
}

export function buildReproMarkdown(input: ReproInput): string {
  const { document, prepared, error, prepareError, selectedNode, facts } = input;
  const origin = selectedNode?.origin;
  const selectedRange = origin ? ([origin.start, origin.end] as const) : undefined;
  const diagnostics = prepared?.diagnostics ?? document?.diagnostics ?? [];
  const lines = [
    "## 复现信息",
    `- 试验台模式：${facts.mode}`,
    `- 输入源：${input.scene.id}（${SCENE_GROUP_LABELS[input.scene.sceneGroup]} / ${
      SOURCE_GROUPS[input.scene.group]
    }）— ${input.scene.title}`,
    `- 解析器：${
      document
        ? `${document.meta.parser} ${document.meta.parserVersion} / AST schema ${document.meta.astSchemaVersion}`
        : "—"
    }`,
    `- 配置：${input.options.parserConfig}`,
    `- 页面名：${input.options.pageName}`,
    `- 源码上限：${input.options.maxSourceLength ?? DEFAULT_MAX_SOURCE_LENGTH}`,
    `- 节点上限：${input.options.maxNodeCount ?? DEFAULT_MAX_NODES}`,
    `- 保留语法树：${document ? (document.meta.retainSyntax ? "是" : "否") : "—"}`,
    `- 解析位置：${facts.executedInWorker ? "Web Worker" : "主线程"}`,
    `- 解析耗时：${facts.durationMs === undefined ? "—" : `${facts.durationMs} ms`}`,
    `- 节点数：${document ? flattenNodes(document.ast).length : "—"}`,
    `- 源码归一化：${document ? (document.meta.sourceNormalized ? "是" : "否") : "—"}`,
    `- 诊断数：${document ? diagnostics.length : "—"}`,
    `- 展开状态：${input.expansion?.status ?? "未启用"}`,
    `- 准备结果：${prepareError ? "失败" : prepared ? `成功（${prepared.headings.length} 标题）` : "—"}`,
    `- 解析错误：${error ? `${error.code ?? error.name}: ${error.message}` : "无"}`,
    `- 准备错误：${
      prepareError ? `${prepareError.code ?? prepareError.name}: ${prepareError.message}` : "无"
    }`,
    `- 选中节点：${
      selectedNode
        ? `${selectedNode.id} (${selectedNode.type}) ${
            selectedRange ? `[${selectedRange[0]}, ${selectedRange[1]}]` : "（生成节点，无 range）"
          }`
        : "无"
    }`,
  ];
  if (input.scene.transformSource) {
    lines.push("- 解析前转换：是");
  }
  const fence = fenceFor(input.text);
  lines.push("", "## 源码", `${fence}wikitext`, input.text, fence);
  if (input.parseText !== input.text) {
    const parseFence = fenceFor(input.parseText);
    lines.push("", "## 送入解析的源码", `${parseFence}wikitext`, input.parseText, parseFence);
  }
  lines.push(
    "",
    "## 选项",
    "```json",
    JSON.stringify(input.options, null, 2),
    "```",
    "",
    "## 准备选项",
    "```json",
    JSON.stringify(prepareOptionsJson(input), null, 2),
    "```",
    "",
    "## 预期 / 实际",
    "- 预期：",
    "- 实际：",
  );
  return lines.join("\n");
}

export function buildReproTest(input: ReproInput): string {
  const { options, error, prepareError } = input;
  const imports = ['import { describe, expect, it } from "vitest";'];
  if (options.parserConfig === "minimum") {
    imports.push('import type { ParserConfig } from "react-wikitext/configs";');
    imports.push('import minimum from "wikiparser-node/config/minimum.json";');
  } else if (options.parserConfig === "zhwiki") {
    imports.push('import type { ParserConfig } from "react-wikitext/configs";');
    imports.push('import zhwiki from "wikiparser-node/config/zhwiki.json";');
  }
  imports.push('import { createWikiparser } from "react-wikitext/parse";');
  if (!error) {
    imports.push('import { prepareWikitext } from "react-wikitext/hast";');
    imports.push('import { flattenNodes } from "react-wikitext/ast";');
  }

  const parserConfig =
    options.parserConfig === "minimum"
      ? "{ config: minimum as unknown as ParserConfig }"
      : options.parserConfig === "zhwiki"
        ? "{ config: zhwiki as unknown as ParserConfig }"
        : "";

  const parseOptions = buildParseOptions({
    pageName: options.pageName,
    ...(options.maxSourceLength === undefined ? {} : { maxSourceLength: options.maxSourceLength }),
    ...(options.maxNodeCount === undefined ? {} : { maxNodeCount: options.maxNodeCount }),
  });
  const parseOptionLines = Object.entries(parseOptions).map(
    ([key, value]) => `${key}: ${JSON.stringify(value)},`,
  );
  const prepareOptionLines = [
    `headingIdStrategy: ${JSON.stringify(options.headingIdStrategy)},`,
    `policy: { externalLinkTarget: ${JSON.stringify(options.externalLinkTarget)} },`,
    ...(options.linkResolver ? ["// resolveLink: 与验收台相同的链接 resolver，"] : []),
    ...(options.imageResolver ? ["// resolveImage: 与验收台相同的图片 resolver，"] : []),
  ];

  const expansionNote = input.expansion
    ? [
        `  // 展开阶段状态：${input.expansion.status}；需要完整复现请用 createWikitextCompiler 与验收台的示例模板表。`,
      ]
    : [];

  const body = error
    ? [
        `  // 记录到的错误：${error.code ?? error.name}: ${error.message}`,
        '  it("reproduces the recorded parse error", () => {',
        "    expect(() =>",
        "      parser.parse(source, {",
        ...parseOptionLines.map((line) => `        ${line}`),
        "      }),",
        "    ).toThrow();",
        "  });",
      ]
    : [
        ...expansionNote,
        '  it("parses and prepares the source", () => {',
        "    const document = parser.parse(source, {",
        ...parseOptionLines.map((line) => `      ${line}`),
        "    });",
        "    expect(flattenNodes(document.ast).length).toBeGreaterThan(0);",
        ...(prepareError
          ? [
              `    // 记录到的准备错误：${prepareError.code ?? prepareError.name}: ${prepareError.message}`,
              "    expect(() =>",
              "      prepareWikitext(document, {",
              ...prepareOptionLines.map((line) => `        ${line}`),
              "      }),",
              "    ).toThrow();",
            ]
          : [
              "    const prepared = prepareWikitext(document, {",
              ...prepareOptionLines.map((line) => `      ${line}`),
              "    });",
              "    expect(prepared.hast.children.length).toBeGreaterThan(0);",
              "    // TODO: 断言具体节点、origin span 或渲染结果。",
            ]),
        "  });",
      ];

  return [
    imports.join("\n"),
    "",
    ...(input.parseText === input.text
      ? []
      : ["// 该输入源在解析前转换了源码；下面是送入解析器的文本。"]),
    `const source = ${JSON.stringify(input.parseText, null, 2)};`,
    `const parser = createWikiparser(${parserConfig});`,
    "",
    'describe("wikitext repro", () => {',
    ...body,
    "});",
  ].join("\n");
}
