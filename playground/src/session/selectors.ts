import { useMemo } from "react";
import type { WikitextDocument } from "react-wikitext/ast";
import { prepareWikitext, type WikitextRenderDocument } from "react-wikitext/hast";
import type { WikitextViewProps } from "react-wikitext/view";
import type { AstTreeLabels, NodeInspectorLabels } from "@pg/devtools";
import { serializeParseError } from "@pg/parse/errors";
import type { ParseErrorInfo } from "@pg/parse/protocol";
import { buildDevtoolsLabels, buildPrepareOptions, buildViewProps } from "@pg/harness/viewProps";
import type { PlaygroundOptions } from "@pg/state/options";

/** 把依赖字段拼成稳定签名，避免因为无关选项变化而重新准备文档。 */
function signature(values: readonly (string | number | boolean | undefined)[]): string {
  return values.map((value) => String(value ?? "")).join("\u0000");
}

/** 准备结果；错误与解析错误分开保存。 */
export interface PrepareOutcome {
  readonly prepared?: WikitextRenderDocument;
  readonly prepareError?: ParseErrorInfo;
}

/**
 * 只在真正影响准备的字段变化时重新执行 prepare。
 * 例如页面名、解析上限、`lang`、`dir` 不会触发清洗与插件。
 */
export function usePrepareOutcome(
  document: WikitextDocument | undefined,
  options: PlaygroundOptions,
): PrepareOutcome {
  const key = signature([
    options.linkResolver,
    options.imageResolver,
    options.labelLanguage,
    options.externalLinkTarget,
    options.headingIdStrategy,
  ]);
  return useMemo<PrepareOutcome>(() => {
    if (!document) {
      return {};
    }
    try {
      return { prepared: prepareWikitext(document, buildPrepareOptions(options)) };
    } catch (error) {
      return { prepareError: serializeParseError(error) };
    }
    // key 覆盖了唯一影响准备的字段；options 只是这些字段的容器。
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [document, key]);
}

/** 视图属性；只在组件模式、语言、方向与标题策略变化时重建。 */
export function useViewProps(options: PlaygroundOptions): Omit<WikitextViewProps, "document"> {
  const key = signature([
    options.componentsMode,
    options.lang,
    options.dir,
    options.headingIdStrategy,
    options.headingIdPrefix,
  ]);
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => buildViewProps(options), [key]);
}

/** devtools 文案；只随展示语言变化。 */
export function useDevtoolsLabels(options: PlaygroundOptions): {
  tree?: Partial<AstTreeLabels>;
  inspector?: Partial<NodeInspectorLabels>;
} {
  const language = options.labelLanguage;
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => buildDevtoolsLabels(options), [language]);
}
