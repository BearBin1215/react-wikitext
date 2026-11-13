import { createElement } from "react";
import {
  Wikitext,
  WikitextFragment,
  WikitextView,
  useWikitextContext,
  type KnownWikitextDiagnosticCode,
  type WikitextAttribute,
  type WikitextDiagnostic,
  type WikitextDiagnosticCode,
  type WikitextDiagnosticSeverity,
  type WikitextErrorInfo,
  type WikitextFailureStage,
  type WikitextFileCaptionKind,
  type WikitextHastHandlers,
  type WikitextHeadingIdStrategy,
  type WikitextHtmlComponents,
  type WikitextNodeBase,
  type WikitextStage,
  type WikitextLinkKind,
  type WikitextPoint,
  type WikitextPosition,
  type WikitextSourceSpan,
  type WikitextParseOptions,
  type WikitextParser,
  type WikitextPrepareOptions,
  type WikitextResolvedPolicy,
  type WikitextSemanticComponents,
  type WikitextTocOptions,
  type WikitextTable,
  type WikitextViewProps,
} from "react-wikitext";

const rootParseOptions: WikitextParseOptions = { retainSyntax: true };
const rootPrepareOptions: WikitextPrepareOptions = { toc: { minHeadings: 2, columns: 2 } };
const rootTocOptions: WikitextTocOptions = { minHeadings: 3 };
const rootDiagnosticCode: WikitextDiagnosticCode = "FILE_PLACEHOLDER";
const knownDiagnosticCode: KnownWikitextDiagnosticCode = "FILE_PLACEHOLDER";
const stage: WikitextStage = "prepare";
interface ConsumerCallout extends WikitextNodeBase<"consumerCallout"> {
  readonly tone: "info" | "warn";
}
const consumerCallout: ConsumerCallout = {
  type: "consumerCallout",
  id: "callout",
  tone: "info",
};
const hastHandlers: WikitextHastHandlers = {
  template: (node) => {
    // 内建键按 WikitextNodeMap 推导节点类型。
    void node.displayName;
    return undefined;
  },
};
void knownDiagnosticCode;
void stage;
void consumerCallout;
void hastHandlers;
const rootFailureStage: WikitextFailureStage = "prepare";
const rootErrorInfo: WikitextErrorInfo = { stage: rootFailureStage };
const rootParser: WikitextParser = createWikiparser();
void rootParseOptions;
void rootPrepareOptions;
void rootTocOptions;
void rootDiagnosticCode;
void rootErrorInfo;
void rootParser;

export type RootTypeClosure = {
  attribute: WikitextAttribute;
  diagnosticSeverity: WikitextDiagnosticSeverity;
  stage: WikitextStage;
  fileCaptionKind: WikitextFileCaptionKind;
  headingIdStrategy: WikitextHeadingIdStrategy;
  linkKind: WikitextLinkKind;
  point: WikitextPoint;
  position: WikitextPosition;
  range: WikitextSourceSpan;
  resolvedPolicy: WikitextResolvedPolicy;
  table: WikitextTable;
};
import {
  flattenNodes,
  getFileParameters,
  getSourceText,
  getTemplateParameters,
  isNodeType,
  toPlainText,
  type WikitextFile,
  type WikitextFileInfo,
  type WikitextNode,
  type WikitextRoot,
} from "react-wikitext/ast";
import {
  WikitextError as HastWikitextError,
  WikitextPrepareError,
  prepareWikitext,
  prepareWikitextAsync,
  serializeWikitextRenderSnapshot,
  type WikitextImageResolver,
  type WikitextLinkResolver,
  type WikitextPluginList,
} from "react-wikitext/hast";
import {
  WikitextError as ExpandWikitextError,
  WikitextExpandError,
  createTemplateTableProvider,
  createWikitextCompiler,
  type WikitextCompilation,
  type WikitextCompiler,
  type WikitextCompilerStats,
  type WikitextCompileCallOptions,
  type WikitextExpandErrorCode,
  type WikitextInput,
  type WikitextTemplateProvider,
  type WikitextTemplateRequest,
  type WikitextTemplateSnapshot,
  type WikitextTemplateSource,
  type WikitextTemplateTable,
} from "react-wikitext/expand";
import { createWikiparser, parseWikitext, type WikitextParserLimits } from "react-wikitext/parse";
import { createWikitextProcessor } from "react-wikitext/unified";
import {
  AstTree,
  NodeInspector,
  findAstTreeNode,
  getNodeRange,
  getNodeSource,
  isSyntaxNode,
  remapExpandedIds,
  restoreSelectedId,
  snapshotSelection,
  type AstTreeDocument,
  type AstTreeKind,
  type AstTreeLabels,
  type AstTreeNode,
  type AstTreeProps,
  type NodeInspectorLabels,
  type NodeInspectorProps,
  type SelectionSnapshot,
} from "react-wikitext/devtools";

const parser: WikitextParser = createWikiparser();
const parserLimits: WikitextParserLimits = { maxSyntaxNodes: 1_000, maxDepth: 100 };
void parserLimits;
const document = parser.parse("== Head ==\n[[A|B]] {{T|x=1}}", {
  pageName: "Consumer",
  retainSyntax: true,
});

const templateRecord: Record<string, string> = { "Template:T": "{{{x}}}" };
const templateMap: ReadonlyMap<string, string> = new Map<string, string>([
  ["Template:T", "{{{x}}}"],
]);
const templateTable: WikitextTemplateTable = templateRecord;
const templateTableFromMap: WikitextTemplateTable = templateMap;
void templateTable;
void templateTableFromMap;

const provider: WikitextTemplateProvider = createTemplateTableProvider({
  key: "consumer:offline",
  revision: "templates-v1",
  templates: templateMap,
});
const compiler: WikitextCompiler = createWikitextCompiler({
  parser,
  provider,
  cache: { maxEntries: 100, maxBytes: 1_000_000 },
  fetch: { concurrency: 2, batchSize: 10 },
});
const input: WikitextInput = { key: "page:consumer", revision: "edit-1", text: "{{T|x=1}}" };
const callOptions: WikitextCompileCallOptions = {
  pageName: "Consumer",
  retainSyntax: true,
  failureMode: "preserve",
  parseOptions: { retainSyntax: true },
  budget: { maxDepth: 40, maxInvocations: 100, maxExpandedLength: 10_000 },
};
void compiler.compile(input, callOptions).then((compilation: WikitextCompilation) => {
  const invocation = compilation.snapshot.graph.invocations[0];
  const diagnostic = compilation.snapshot.diagnostics[0];
  void invocation?.outputs;
  void diagnostic?.location;
  void compilation.status;
  void compilation.inputSourceId;
  void compilation.attemptedSourceId;
  void compilation.snapshot.activeSourceId;
  void compilation.dependencies;
  return undefined;
});
const compilerStats: WikitextCompilerStats = compiler.getStats();
void compilerStats.programCompilations;
void compiler.invalidate();
void compiler.clearCache();
void compiler.dispose();

const remoteSnapshot: WikitextTemplateSnapshot = {
  key: "consumer:remote",
  revision: "r1",
  get(title: string, request: WikitextTemplateRequest): WikitextTemplateSource | null {
    void request.location;
    return title === "Template:T" ? { title, source: "{{{x}}}" } : null;
  },
  getMany(titles: readonly string[]) {
    return new Map(titles.map((title) => [title, null]));
  },
  release() {},
};
const remoteProvider: WikitextTemplateProvider = {
  key: "consumer:remote",
  open() {
    return remoteSnapshot;
  },
};
void remoteProvider;
void createWikitextCompiler({ parser, provider: remoteProvider });

void WikitextExpandError;
const expandErrorCode: WikitextExpandErrorCode = "TEMPLATE_NOT_FOUND";
void expandErrorCode;
void ExpandWikitextError;
const parsedDocument = parseWikitext("text");
void parsedDocument;

const astTreeDocument: AstTreeDocument = parsedDocument;
const astTreeKind: AstTreeKind = "semantic";
const astTreeLabels: Partial<AstTreeLabels> = { treeLabel: "AST" };
const astTreeProps: AstTreeProps = {
  document: astTreeDocument,
  kind: astTreeKind,
  selectedId: null,
  labels: astTreeLabels,
  getNodeLabel: (_node, fallback) => fallback,
  style: { height: 480 },
};
const astTreeNode: AstTreeNode | undefined = findAstTreeNode(
  astTreeDocument,
  parsedDocument.ast.id,
  astTreeKind,
);
const selection: SelectionSnapshot | undefined = snapshotSelection(
  astTreeDocument,
  astTreeNode?.id,
  astTreeKind,
);
const restoredId: string | undefined = restoreSelectedId(astTreeDocument, selection);
const remapped: ReadonlySet<string> = remapExpandedIds(astTreeDocument, astTreeDocument, new Set());
if (astTreeNode) {
  const range: readonly [number, number] | undefined = getNodeRange(astTreeNode);
  const source: string = getNodeSource(astTreeDocument, astTreeNode);
  const syntax: boolean = isSyntaxNode(astTreeNode);
  void range;
  void source;
  void syntax;
}
const inspectorLabels: Partial<NodeInspectorLabels> = { copyJson: "Copy" };
const inspectorProps: NodeInspectorProps = {
  document: astTreeDocument,
  ...(astTreeNode ? { node: astTreeNode } : {}),
  labels: inspectorLabels,
  style: { height: 480 },
};
const renderedTreeProps: AstTreeProps = { document: prepareWikitext(parsedDocument) };
export const astTreeElement = createElement(AstTree, astTreeProps);
export const inspectorElement = createElement(NodeInspector, inspectorProps);
void renderedTreeProps;
void selection;
void restoredId;
void remapped;

const semanticNodes: readonly WikitextNode[] = flattenNodes(document.ast);
const link = semanticNodes.find((node) => isNodeType(node, "link"));
if (link) {
  void toPlainText(link);
}
const template = semanticNodes.find((node) => isNodeType(node, "template"));
if (template) {
  const parameters = getTemplateParameters(template);
  void parameters[0]?.node.children;
}
const file = semanticNodes.find((node) => isNodeType(node, "file")) as WikitextFile | undefined;
if (file) {
  const fileInfo: WikitextFileInfo = getFileParameters(file);
  void fileInfo;
}
if (semanticNodes[0]) {
  void getSourceText(document, semanticNodes[0]);
}

const resolveLink: WikitextLinkResolver = (request) =>
  request.kind === "internal" ? { href: `/wiki/${encodeURIComponent(request.target)}` } : undefined;
const resolveImage: WikitextImageResolver = (request) =>
  request.name ? { src: `/img/${request.name}`, alt: request.name } : null;

const prepared = prepareWikitext(document, {
  resolveLink,
  resolveImage,
  labels: { templateNotExpanded: "模板未展开" },
  policy: { allowRelativeImages: true, externalLinkTarget: "_self" },
  headingIdStrategy: "instance",
});
const pluginList: WikitextPluginList = [];
void prepareWikitextAsync(document, { wikitextPlugins: pluginList });
void prepared.headings;
void serializeWikitextRenderSnapshot(prepared);

const rootDiagnostics: readonly WikitextDiagnostic[] = document.diagnostics;
void rootDiagnostics;
void WikitextPrepareError;
void HastWikitextError;

const semanticComponents: WikitextSemanticComponents = {
  link: ({ target, href, children }) =>
    createElement("span", { title: target, "data-href": href }, children),
  template: ({ node }) =>
    createElement("span", null, node.type === "template" ? node.displayName : node.name),
  unknown: ({ node, parsedType }) => createElement("span", null, `${node.type}:${parsedType}`),
};
const components: WikitextHtmlComponents = {
  img: ({ src, alt }) => createElement("img", { src, alt }),
  a: ({ href, children }) => createElement("a", { href }, children),
};

const viewProps: WikitextViewProps = {
  snapshot: prepared,
  components,
  semanticComponents,
  idPrefix: "host-",
  containerProps: { role: "region", "aria-label": "wikitext" },
  onRenderError: (error, info) => {
    void error;
    void info.node;
  },
};
createElement(WikitextView, viewProps);
createElement(WikitextFragment, { nodes: prepared.ast.children, mode: "block" });
createElement(Wikitext, { source: "text" });
createElement(Wikitext, {
  source: "text",
  parser,
  prepareOptions: { resolveLink },
  onPrepared: (preparedDocument) => {
    void preparedDocument.diagnostics;
    void preparedDocument.meta.limits;
  },
  onError: (error) => {
    void error.code;
  },
});

type WikitextContainerProps = NonNullable<Parameters<typeof Wikitext>[0]["containerProps"]>;
const wikitextContainerPropsExcludeDangerous: "dangerouslySetInnerHTML" extends keyof WikitextContainerProps
  ? never
  : true = true;
void wikitextContainerPropsExcludeDangerous;

void useWikitextContext;

const processor = createWikitextProcessor({
  parser,
  resolveLink,
  headingIdStrategy: "mediawiki",
  wikitextPlugins: [],
  rehypePlugins: [],
});
processor.useWikitext(() => (tree: WikitextRoot) => {
  void tree;
});
processor.useHast(() => (tree) => {
  void tree;
});
void processor.runSync("text");
void processor.run("text");
