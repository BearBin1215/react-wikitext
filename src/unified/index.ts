import type { Root } from "hast";
import { unified } from "unified";
import { VFile } from "vfile";
import type {
  WikitextDiagnostic,
  WikitextDocument,
  WikitextRenderDocument,
  WikitextRoot,
} from "../ast/model";
import { WikitextPrepareError } from "../ast/errors";
import type { WikitextParseOptions, WikitextParser } from "../ast/parser";
import {
  assertPreparableDocument,
  cloneWorkingAst,
  convertWorkingAst,
  createRenderDocument,
  finishPreparedHast,
} from "../hast/stages";
import type { ResolvedPrepareSettings } from "../hast/settings";
import { resolvePrepareSettings } from "../hast/settings";
import type { WikitextPrepareOptions, WikitextTocMode } from "../hast/types";
import { takeDiagnostics } from "../hast/vfile";
import { validateWorkingAst } from "../hast/workingAst";

/** unified 在同步路径遇到异步插件时抛出的固定消息；只按原文匹配，避免误判插件自身的错误。 */
const ASYNC_IN_SYNC_MESSAGE = "`runSync` finished async. Use `run` instead";

type WikitextTransformer = (tree: unknown, file: unknown) => unknown | Promise<unknown> | undefined;

function emptyRoot(): WikitextRoot {
  return { type: "root", children: [] } as unknown as WikitextRoot;
}

/** 读取处理器写入的解析快照；供插件与消费方类型化访问。 */
export function getWikitextDocument(file: unknown): WikitextDocument | undefined {
  return (file as VFile | undefined)?.data?.wikitextDocument;
}

/** 读取处理器写入的渲染快照；供消费方类型化访问。 */
export function getWikitextRenderDocument(file: unknown): WikitextRenderDocument | undefined {
  return (file as VFile | undefined)?.data?.wikitextRenderDocument;
}

/** 单个阶段的 transformer；`undefined` 表示保持当前树。 */
export type WikitextTreeTransformer<Tree> = (
  tree: Tree,
  // 插件通常直接标注 VFile；这里保持宽松，避免公共声明绑定内部打包的 vfile 类型。
  file: any,
) => Tree | undefined | void | Promise<Tree | undefined | void>;

/** unified 插件工厂；返回值是处理该阶段树的 transformer。 */
export type WikitextTreePlugin<Tree> = (
  this: unknown,
  // 插件选项形态由具体插件决定，这里不绑定单一签名。
  ...args: any[]
) => WikitextTreeTransformer<Tree>;

/** 插件列表；元素可以是插件函数或 `[plugin, options]` 元组。 */
export type WikitextTreePlugins<Tree> = readonly (
  | WikitextTreePlugin<Tree>
  | readonly [WikitextTreePlugin<Tree>, ...any[]]
)[];

/** 创建处理器时的选项；准备设置与 `prepareWikitext` 完全一致。 */
export interface WikitextProcessorOptions extends Omit<
  WikitextPrepareOptions,
  "wikitextPlugins" | "rehypePlugins"
> {
  /** 解析器。`/unified` 不加载默认解析器，必须显式提供。 */
  readonly parser: WikitextParser;
  /** 解析选项。 */
  readonly parseOptions?: WikitextParseOptions;
  /** 初始的语义树插件；也可以之后用 `useWikitext` 追加。 */
  readonly wikitextPlugins?: WikitextTreePlugins<WikitextRoot>;
  /** 初始的 HAST 插件；也可以之后用 `useHast` 追加。 */
  readonly rehypePlugins?: WikitextTreePlugins<Root>;
}

/**
 * 固定顺序的处理器：解析 → 语义树插件 → 转 HAST → HAST 插件 → 清洗与最终整理。
 *
 * 最终阶段由库在内部追加，宿主无法把插件排在清洗之后，因此从处理器拿到的
 * 渲染快照始终与最终输出一致。
 */
export interface WikitextProcessor {
  /** 追加处理语义树的插件；在转换为 HAST 之前运行。 */
  useWikitext(...plugins: WikitextTreePlugins<WikitextRoot>): WikitextProcessor;
  /** 追加处理 HAST 的插件；在清洗与最终整理之前运行。 */
  useHast(...plugins: WikitextTreePlugins<Root>): WikitextProcessor;
  /** 异步运行；插件可以返回 Promise。 */
  run(source: string): Promise<WikitextRenderDocument>;
  /** 同步运行；遇到异步插件时抛 `ASYNC_PLUGIN_IN_SYNC_PATH`。 */
  runSync(source: string): WikitextRenderDocument;
}

/** 阶段间传递的内部状态；放在 WeakMap 中，不进入公共 VFile data。 */
interface PreparedState {
  readonly document: WikitextDocument;
  readonly ast: WikitextRoot;
  readonly settings: ResolvedPrepareSettings;
  readonly authorizedImages: ReadonlySet<string>;
  readonly diagnostics: WikitextDiagnostic[];
  readonly toc: WikitextTocMode;
}

const preparedStates = new WeakMap<object, PreparedState>();

function asFile(file: unknown): VFile {
  return file as VFile;
}

function asPlugin(plugin: WikitextTransformer): never {
  return (() => plugin) as never;
}

function invalidProcessor(message: string): never {
  throw new WikitextPrepareError("PREPARE_FAILED", message, { stage: "prepare" });
}

function wrapStageError(stage: string, error: unknown): never {
  if (error instanceof WikitextPrepareError) {
    throw error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const asyncInSync = error instanceof Error && message === ASYNC_IN_SYNC_MESSAGE;
  throw new WikitextPrepareError(
    asyncInSync ? "ASYNC_PLUGIN_IN_SYNC_PATH" : "PREPARE_FAILED",
    `Wikitext processor failed during ${stage}: ${message}`,
    { stage: "prepare", ...(error instanceof Error ? { cause: error } : {}) },
  );
}

function parsePlugin(
  parser: WikitextParser,
  parseOptions?: WikitextParseOptions,
): WikitextTransformer {
  return (_tree, file) => {
    const vfile = asFile(file);
    delete vfile.data.wikitextDocument;
    delete vfile.data.wikitextRenderDocument;
    preparedStates.delete(vfile);
    const document = parser.parse(String(vfile.value ?? ""), parseOptions);
    assertPreparableDocument(document);
    const workingAst = cloneWorkingAst(document);
    vfile.data.wikitextDocument = document;
    return workingAst;
  };
}

function rehypePlugin(
  options: Omit<WikitextPrepareOptions, "wikitextPlugins" | "rehypePlugins">,
): WikitextTransformer {
  const settings = resolvePrepareSettings(options);
  return (tree, file) => {
    const vfile = asFile(file);
    const document = vfile.data.wikitextDocument;
    if (!document) {
      invalidProcessor("The processor requires a parsed snapshot; the parse stage did not run.");
    }
    assertPreparableDocument(document);
    const diagnostics = takeDiagnostics(vfile, "wikitext");
    validateWorkingAst(tree);
    const converted = convertWorkingAst(document, tree as WikitextRoot, settings, diagnostics);
    preparedStates.set(vfile, {
      document,
      ast: tree as WikitextRoot,
      settings,
      authorizedImages: converted.authorizedImages,
      diagnostics,
      toc: converted.toc,
    });
    return converted.hast as Root;
  };
}

function finalizePlugin(): WikitextTransformer {
  return (tree, file) => {
    const vfile = asFile(file);
    const prepare = preparedStates.get(vfile);
    if (!prepare) {
      invalidProcessor("The processor requires a converted HAST; the rehype stage did not run.");
    }
    const diagnostics = [...prepare.diagnostics, ...takeDiagnostics(vfile, "rehype")];
    const finalized = finishPreparedHast(
      tree as Root,
      prepare.settings,
      prepare.authorizedImages,
      diagnostics,
      { toc: prepare.toc, document: prepare.document },
    );
    vfile.data.wikitextRenderDocument = createRenderDocument(
      prepare.document,
      prepare.ast,
      finalized,
      prepare.settings,
      prepare.authorizedImages,
      diagnostics,
    );
    return finalized.hast;
  };
}

function readRenderDocument(file: VFile): WikitextRenderDocument {
  const document = file.data.wikitextRenderDocument;
  if (!document) {
    invalidProcessor("The processor completed without producing a render snapshot.");
  }
  return document;
}

/**
 * 创建一个固定顺序的 wikitext 处理器。
 *
 * 与直接拼装 unified 插件相比，最终清洗阶段由库内部追加，宿主插件永远在清洗之前运行；
 * 因此不需要、也无法把插件排在最终整理之后。
 * @param options 解析器、解析选项与准备设置。
 */
export function createWikitextProcessor(options: WikitextProcessorOptions): WikitextProcessor {
  if (!options || typeof options !== "object") {
    invalidProcessor("createWikitextProcessor requires an options object.");
  }
  const { parser, parseOptions, wikitextPlugins, rehypePlugins, ...prepareOptions } = options;
  if (!parser || typeof parser.parse !== "function") {
    invalidProcessor("createWikitextProcessor requires a parser with parse().");
  }
  // 提前校验设置，避免等到每次运行才失败。
  resolvePrepareSettings(prepareOptions);

  const wikiStage: unknown[] = [...(wikitextPlugins ?? [])];
  const hastStage: unknown[] = [...(rehypePlugins ?? [])];

  const build = () =>
    unified()
      .use(asPlugin(parsePlugin(parser, parseOptions)))
      .use(wikiStage as never)
      .use(asPlugin(rehypePlugin(prepareOptions)))
      .use(hastStage as never)
      .use(asPlugin(finalizePlugin()));

  const processor: WikitextProcessor = {
    useWikitext(...plugins) {
      wikiStage.push(...plugins);
      return processor;
    },
    useHast(...plugins) {
      hastStage.push(...plugins);
      return processor;
    },
    async run(source) {
      const file = new VFile({ value: source });
      try {
        await build().run(emptyRoot(), file);
      } catch (error) {
        wrapStageError("run", error);
      }
      return readRenderDocument(file);
    },
    runSync(source) {
      const file = new VFile({ value: source });
      try {
        build().runSync(emptyRoot(), file);
      } catch (error) {
        wrapStageError("runSync", error);
      }
      return readRenderDocument(file);
    },
  };
  return processor;
}
