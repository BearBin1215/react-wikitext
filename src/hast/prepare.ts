import { unified, type PluggableList } from "unified";
import type { VFile } from "vfile";
import type { Root } from "hast";
import type {
  WikitextDiagnostic,
  WikitextDocument,
  WikitextRenderDocument,
  WikitextRoot,
} from "../ast/model";
import { WikitextPrepareError } from "../ast/errors";
import {
  assertPreparableDocument,
  cloneWorkingAst,
  convertWorkingAst,
  createRenderDocument,
  createWikitextFile,
  finishPreparedHast,
} from "./stages";
import type { ResolvedPrepareSettings } from "./settings";
import { resolvePrepareSettings } from "./settings";
import type { WikitextPrepareOptions } from "./types";
import { takeDiagnostics } from "./vfile";
import { validateWorkingAst } from "./workingAst";

/** unified 在同步路径遇到异步插件时抛出的固定消息；只按原文匹配，避免误判插件自身的错误。 */
const ASYNC_IN_SYNC_MESSAGE = "`runSync` finished async. Use `run` instead";

function wrapStageError(stage: "wikitext" | "rehype" | "prepare", error: unknown): never {
  if (error instanceof WikitextPrepareError) {
    throw error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const asyncInSync = error instanceof Error && message === ASYNC_IN_SYNC_MESSAGE;
  throw new WikitextPrepareError(
    asyncInSync ? "ASYNC_PLUGIN_IN_SYNC_PATH" : "PREPARE_FAILED",
    `Preparation failed during ${stage}: ${message}`,
    { stage, ...(error instanceof Error ? { cause: error } : {}) },
  );
}

function runPluginsSync<T>(
  tree: T,
  file: VFile,
  plugins: readonly unknown[] | undefined,
  stage: "wikitext" | "rehype",
): T {
  if (!plugins || plugins.length === 0) {
    return tree;
  }
  try {
    const processor = unified();
    processor.use(plugins as PluggableList);
    return processor.runSync(tree as never, file) as unknown as T;
  } catch (error) {
    return wrapStageError(stage, error);
  }
}

async function runPluginsAsync<T>(
  tree: T,
  file: VFile,
  plugins: readonly unknown[] | undefined,
  stage: "wikitext" | "rehype",
): Promise<T> {
  if (!plugins || plugins.length === 0) {
    return tree;
  }
  try {
    const processor = unified();
    processor.use(plugins as PluggableList);
    return (await processor.run(tree as never, file)) as unknown as T;
  } catch (error) {
    return wrapStageError(stage, error);
  }
}

/** 装配最终快照；同步与异步路径共用。 */
function assembleRenderDocument(
  document: WikitextDocument,
  processed: WikitextRoot,
  pluginTree: Root,
  settings: ResolvedPrepareSettings,
  converted: ReturnType<typeof convertWorkingAst>,
  diagnostics: WikitextDiagnostic[],
): WikitextRenderDocument {
  const finalized = finishPreparedHast(
    pluginTree,
    settings,
    converted.authorizedImages,
    diagnostics,
    {
      toc: converted.toc,
      document,
    },
  );
  return createRenderDocument(
    document,
    processed,
    finalized,
    settings,
    converted.authorizedImages,
    diagnostics,
  );
}

function prepareSync(
  document: WikitextDocument,
  options: WikitextPrepareOptions,
): WikitextRenderDocument {
  const settings = resolvePrepareSettings(options);
  const diagnostics: WikitextDiagnostic[] = [];
  const file = createWikitextFile(document);
  try {
    const processed = runPluginsSync(
      cloneWorkingAst(document),
      file,
      options.wikitextPlugins,
      "wikitext",
    );
    diagnostics.push(...takeDiagnostics(file, "wikitext"));
    validateWorkingAst(processed);
    const converted = convertWorkingAst(document, processed, settings, diagnostics);
    const pluginTree = runPluginsSync(
      converted.hast,
      file,
      options.rehypePlugins,
      "rehype",
    ) as Root;
    diagnostics.push(...takeDiagnostics(file, "rehype"));
    return assembleRenderDocument(
      document,
      processed,
      pluginTree,
      settings,
      converted,
      diagnostics,
    );
  } catch (error) {
    return wrapStageError("prepare", error);
  }
}

async function prepareAsync(
  document: WikitextDocument,
  options: WikitextPrepareOptions,
): Promise<WikitextRenderDocument> {
  const settings = resolvePrepareSettings(options);
  const diagnostics: WikitextDiagnostic[] = [];
  const file = createWikitextFile(document);
  try {
    const processed = await runPluginsAsync(
      cloneWorkingAst(document),
      file,
      options.wikitextPlugins,
      "wikitext",
    );
    diagnostics.push(...takeDiagnostics(file, "wikitext"));
    validateWorkingAst(processed);
    const converted = convertWorkingAst(document, processed, settings, diagnostics);
    const pluginTree = (await runPluginsAsync(
      converted.hast,
      file,
      options.rehypePlugins,
      "rehype",
    )) as Root;
    diagnostics.push(...takeDiagnostics(file, "rehype"));
    return assembleRenderDocument(
      document,
      processed,
      pluginTree,
      settings,
      converted,
      diagnostics,
    );
  } catch (error) {
    return wrapStageError("prepare", error);
  }
}

/**
 * 把解析结果转换为 HAST 与渲染快照。
 * 同步执行插件，要求所有插件都支持同步调用。
 * @param document 解析结果。
 * @param options 准备选项。
 */
export function prepareWikitext(
  document: WikitextDocument,
  options: WikitextPrepareOptions = {},
): WikitextRenderDocument {
  assertPreparableDocument(document);
  return prepareSync(document, options);
}

/**
 * 异步版本：允许插件返回 Promise。
 * @param document 解析结果。
 * @param options 准备选项。
 */
export async function prepareWikitextAsync(
  document: WikitextDocument,
  options: WikitextPrepareOptions = {},
): Promise<WikitextRenderDocument> {
  assertPreparableDocument(document);
  return prepareAsync(document, options);
}
