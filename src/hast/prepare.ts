import { unified, type PluggableList } from "unified";
import type { VFile } from "vfile";
import type { Root } from "hast";
import type {
  WikitextDiagnostic,
  WikitextParsedSnapshot,
  WikitextRenderSnapshot,
  WikitextRoot,
} from "../ast/model";
import { measureAsync, measureSync } from "../instrumentation";
import {
  assertPreparableDocument,
  cloneWorkingAst,
  convertWorkingAst,
  createRenderDocument,
  createWikitextFile,
  finishPreparedHast,
  wrapPrepareError,
} from "./stages";
import type { ResolvedPrepareSettings } from "./settings";
import { resolvePrepareSettings } from "./settings";
import type { WikitextPrepareOptions } from "./types";
import { takeDiagnostics } from "./vfile";
import { validateWorkingAst } from "./workingAst";

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
    return wrapPrepareError(stage, error);
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
    return wrapPrepareError(stage, error);
  }
}

/** 装配最终快照；同步与异步路径共用。 */
function assembleRenderDocument(
  document: WikitextParsedSnapshot,
  processed: WikitextRoot,
  pluginTree: Root,
  settings: ResolvedPrepareSettings,
  converted: ReturnType<typeof convertWorkingAst>,
  diagnostics: WikitextDiagnostic[],
): WikitextRenderSnapshot {
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
  document: WikitextParsedSnapshot,
  options: WikitextPrepareOptions,
): WikitextRenderSnapshot {
  const settings = resolvePrepareSettings(options);
  const profile = options.profile;
  const diagnostics: WikitextDiagnostic[] = [];
  const file = createWikitextFile(document);
  try {
    const cloned = measureSync("prepare-clone", profile, () => cloneWorkingAst(document));
    const processed = measureSync("prepare-plugin", profile, () =>
      runPluginsSync(cloned, file, options.wikitextPlugins, "wikitext"),
    );
    diagnostics.push(...takeDiagnostics(file, "wikitext", document.activeSourceId));
    validateWorkingAst(processed);
    const converted = measureSync("prepare-convert", profile, () =>
      convertWorkingAst(document, processed, settings, diagnostics),
    );
    const pluginTree = measureSync(
      "prepare-rehype",
      profile,
      () => runPluginsSync(converted.hast, file, options.rehypePlugins, "rehype") as Root,
    );
    diagnostics.push(...takeDiagnostics(file, "rehype", document.activeSourceId));
    return measureSync("prepare-assemble", profile, () =>
      assembleRenderDocument(document, processed, pluginTree, settings, converted, diagnostics),
    );
  } catch (error) {
    return wrapPrepareError("prepare", error);
  }
}

async function prepareAsync(
  document: WikitextParsedSnapshot,
  options: WikitextPrepareOptions,
): Promise<WikitextRenderSnapshot> {
  const settings = resolvePrepareSettings(options);
  const profile = options.profile;
  const diagnostics: WikitextDiagnostic[] = [];
  const file = createWikitextFile(document);
  try {
    const cloned = measureSync("prepare-clone", profile, () => cloneWorkingAst(document));
    const processed = await measureAsync("prepare-plugin", profile, () =>
      runPluginsAsync(cloned, file, options.wikitextPlugins, "wikitext"),
    );
    diagnostics.push(...takeDiagnostics(file, "wikitext", document.activeSourceId));
    validateWorkingAst(processed);
    const converted = measureSync("prepare-convert", profile, () =>
      convertWorkingAst(document, processed, settings, diagnostics),
    );
    const pluginTree = await measureAsync(
      "prepare-rehype",
      profile,
      async () =>
        (await runPluginsAsync(converted.hast, file, options.rehypePlugins, "rehype")) as Root,
    );
    diagnostics.push(...takeDiagnostics(file, "rehype", document.activeSourceId));
    return measureSync("prepare-assemble", profile, () =>
      assembleRenderDocument(document, processed, pluginTree, settings, converted, diagnostics),
    );
  } catch (error) {
    return wrapPrepareError("prepare", error);
  }
}

/**
 * 把解析结果转换为 HAST 与渲染快照。
 * 同步执行插件，要求所有插件都支持同步调用。
 * @param document 解析结果。
 * @param options 准备选项。
 */
export function prepareWikitext(
  document: WikitextParsedSnapshot,
  options: WikitextPrepareOptions = {},
): WikitextRenderSnapshot {
  assertPreparableDocument(document);
  return prepareSync(document, options);
}

/**
 * 异步版本：允许插件返回 Promise。
 * @param document 解析结果。
 * @param options 准备选项。
 */
export async function prepareWikitextAsync(
  document: WikitextParsedSnapshot,
  options: WikitextPrepareOptions = {},
): Promise<WikitextRenderSnapshot> {
  assertPreparableDocument(document);
  return prepareAsync(document, options);
}
