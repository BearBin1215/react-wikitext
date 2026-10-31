import { Fragment, type ReactNode } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import type { Root, RootContent } from "hast";
import { toJsxRuntime, type Components } from "hast-util-to-jsx-runtime";

/**
 * 把 HAST 节点渲染成 React 节点。
 * `components` 由调用方按文档构建，保证 extraTags、handlers 与 components 覆盖同一套标签。
 */
export function renderHastNodes(
  nodes: readonly RootContent[],
  components: Partial<Components> | undefined,
): ReactNode {
  const root: Root = { type: "root", children: [...nodes] };
  return toJsxRuntime(root, {
    ...(components ? { components } : {}),
    passNode: true,
    Fragment,
    jsx,
    jsxs,
    tableCellAlignToStyle: false,
  }) as ReactNode;
}
