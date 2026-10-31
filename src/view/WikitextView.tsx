import { useId, useMemo, type ReactElement } from "react";
import type { RootContent } from "hast";
import type { WikitextNode } from "../ast/model";
import { getSourceText } from "../ast/query";
import { hastNodeId } from "../shared/hast";
import { bridgeTagNames, createBridgeComponents } from "./bridge";
import {
  createHastIndex,
  createSemanticIndex,
  WikitextViewContext,
  type WikitextViewContextValue,
} from "./context";
import { renderHastNodes } from "./render";
import { RenderErrorBoundary } from "./RenderErrorBoundary";
import type { WikitextViewProps } from "./types";
import { assertRenderDocument } from "./validate";

/** 实例前缀只允许出现在 DOM id 与片段中的安全字符；空串或全非法字符回退到实例 id。 */
function resolveInstancePrefix(
  strategy: string,
  idPrefix: string | undefined,
  reactId: string,
): string {
  if (strategy !== "instance") {
    return "";
  }
  const fallback = `wtr-${reactId.replace(/[^A-Za-z0-9_-]/gu, "")}-`;
  if (idPrefix === undefined) {
    return fallback;
  }
  const cleaned = idPrefix.replace(/[^A-Za-z0-9_-]/gu, "").slice(0, 128);
  return cleaned || fallback;
}

function anonymousNode(index: number): WikitextNode {
  return {
    type: "unknown",
    id: `block-${index}`,
    parserType: "block",
    value: "",
    block: true,
  };
}

function firstDescendant(
  node: RootContent,
  semanticIndex: ReadonlyMap<string, WikitextNode>,
): WikitextNode | undefined {
  if (node.type !== "element") {
    return undefined;
  }
  for (const child of node.children) {
    const id = hastNodeId(child);
    const semantic = id ? semanticIndex.get(id) : undefined;
    if (semantic) {
      return semantic;
    }
    const nested = firstDescendant(child, semanticIndex);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function blockInfo(
  block: RootContent,
  semanticIndex: ReadonlyMap<string, WikitextNode>,
  index: number,
): WikitextNode {
  if (block.type === "element") {
    const id = hastNodeId(block);
    const semantic = id ? semanticIndex.get(id) : undefined;
    if (semantic) {
      // 段落是块级容器；错误边界报告其中第一个具体语义节点，便于定位失败来源。
      return semantic.type === "paragraph"
        ? (firstDescendant(block, semanticIndex) ?? semantic)
        : semantic;
    }
  }
  return anonymousNode(index);
}

/**
 * 渲染准备阶段的结果。
 * 每个顶层块都包在错误边界里，单个块失败不会影响其余内容。
 * 属性说明见 {@link WikitextViewProps}。
 */
export function WikitextView({
  document,
  components,
  semanticComponents,
  lang,
  dir,
  idPrefix,
  className,
  containerProps,
  onRenderError,
}: WikitextViewProps): ReactElement {
  assertRenderDocument(document);
  const reactId = useId();
  const strategy = document.meta.headingIdStrategy;
  const resolvedPrefix = resolveInstancePrefix(strategy, idPrefix, reactId);

  const semanticIndex = useMemo(() => createSemanticIndex(document), [document]);
  const hastIndex = useMemo(() => createHastIndex(document.hast), [document]);
  const mapId = useMemo(
    () => (id: string) => (resolvedPrefix ? `${resolvedPrefix}${id}` : id),
    [resolvedPrefix],
  );
  const mapHref = useMemo(
    () => (href: string) =>
      href.startsWith("#") && href.length > 1 ? `#${mapId(href.slice(1))}` : href,
    [mapId],
  );

  const bridgeComponents = useMemo(
    () =>
      createBridgeComponents(
        bridgeTagNames(document.meta.policy.extraTags, components as Record<string, unknown>),
      ),
    [document, components],
  );

  const context = useMemo<WikitextViewContextValue>(
    () => ({
      document,
      semanticIndex,
      hastIndex,
      components: components ?? {},
      semanticComponents: semanticComponents ?? {},
      bridgeComponents,
      idPrefix: resolvedPrefix,
      mapId,
      mapHref,
      ...(onRenderError === undefined ? {} : { onRenderError }),
    }),
    [
      document,
      semanticIndex,
      hastIndex,
      components,
      semanticComponents,
      bridgeComponents,
      resolvedPrefix,
      mapId,
      mapHref,
      onRenderError,
    ],
  );

  // containerProps 只补充属性：children 与 className 由组件自身决定，避免冲突。
  const containerRest = { ...containerProps };
  const containerClassName = containerRest.className;
  delete containerRest.className;
  delete containerRest.children;
  const rootClassName = ["wtr-view", className, containerClassName].filter(Boolean).join(" ");

  const blocks = useMemo(
    () =>
      document.hast.children.map((block, index) => ({
        key: hastNodeId(block) ?? `block-${index}`,
        node: blockInfo(block, semanticIndex, index),
        element: renderHastNodes([block], bridgeComponents),
      })),
    [document, semanticIndex, bridgeComponents],
  );

  // 组件身份变化也要重建错误边界；否则同一快照下更换组件不会清除错误。
  const resetKey = useMemo(
    () => ({ document, components, semanticComponents }),
    [document, components, semanticComponents],
  );

  return (
    <WikitextViewContext.Provider value={context}>
      <div
        {...containerRest}
        className={rootClassName}
        {...(lang ? { lang } : {})}
        {...(dir ? { dir } : {})}
      >
        {blocks.map((block) => (
          <RenderErrorBoundary
            key={block.key}
            node={block.node}
            source={getSourceText(document, block.node)}
            label={document.meta.labels.renderFailed}
            resetKey={resetKey}
            {...(onRenderError ? { onRenderError } : {})}
          >
            {block.element}
          </RenderErrorBoundary>
        ))}
      </div>
    </WikitextViewContext.Provider>
  );
}
