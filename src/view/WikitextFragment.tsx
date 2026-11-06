import { Fragment, type ReactElement, type ReactNode } from "react";
import { useWikitextContext } from "./context";
import { renderHastNodes } from "./render";
import type { WikitextFragmentProps } from "./types";

/** 在 `<WikitextView>` 上下文内渲染准备结果中的片段。 */
export function WikitextFragment({
  nodes,
  mode = "inline",
  className,
}: WikitextFragmentProps): ReactElement {
  const context = useWikitextContext();
  const rendered: ReactNode[] = [];
  for (const node of nodes) {
    // 跨文档的同 id 节点会静默命中错误内容，因此只接受当前文档的节点对象。
    if (context.semanticIndex.get(node.id) !== node) {
      throw new Error("WikitextFragment nodes must belong to the rendered document.");
    }
    const hast = context.hastIndex.get(node.id);
    if (!hast) {
      continue;
    }
    rendered.push(
      <Fragment key={node.id}>{renderHastNodes([hast], context.bridgeComponents)}</Fragment>,
    );
  }
  if (mode === "block") {
    return (
      <div className={className ? `wikitext-fragment ${className}` : "wikitext-fragment"}>
        {rendered}
      </div>
    );
  }
  return className ? <span className={className}>{rendered}</span> : <>{rendered}</>;
}
