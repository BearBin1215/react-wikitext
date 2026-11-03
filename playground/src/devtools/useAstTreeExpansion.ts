import { useCallback, useEffect, useState } from "react";
import type { WikitextDocument } from "react-wikitext/ast";
import { ancestorIds, buildTreeIndex, treeRoot, type DevtreeKind } from "./tree";
import { remapExpandedIds } from "./selection";

/** 展开状态；随树类型绑定，切换树时不会把语义 id 套到语法树上。 */
interface ExpansionState {
  readonly kind: DevtreeKind;
  readonly document: WikitextDocument;
  readonly ids: ReadonlySet<string>;
}

/** 默认展开到指定深度的所有分支节点。 */
function defaultExpanded(
  document: WikitextDocument,
  kind: DevtreeKind,
  depth: number,
): Set<string> {
  const index = buildTreeIndex(treeRoot(document, kind));
  const expanded = new Set<string>();
  for (const entry of index.entries) {
    if (entry.hasChildren && entry.depth < depth) {
      expanded.add(entry.node.id);
    }
  }
  return expanded;
}

/** 展开状态管理；受控模式由调用方维护，不做隐式重映射。 */
export interface AstTreeExpansion {
  readonly expanded: ReadonlySet<string>;
  toggle(id: string): void;
  expandAll(): void;
  collapseAll(): void;
  /** 展开外部选中项的祖先链。 */
  revealAncestors(id: string): void;
}

export interface UseAstTreeExpansionOptions {
  readonly document: WikitextDocument;
  readonly kind: DevtreeKind;
  readonly defaultExpandedDepth: number;
  readonly expandedIds?: ReadonlySet<string>;
  readonly onExpandedChange?: (ids: ReadonlySet<string>) => void;
}

export function useAstTreeExpansion({
  document,
  kind,
  defaultExpandedDepth,
  expandedIds,
  onExpandedChange,
}: UseAstTreeExpansionOptions): AstTreeExpansion {
  const controlled = expandedIds !== undefined;
  const [state, setState] = useState<ExpansionState>(() => ({
    kind,
    document,
    ids: defaultExpanded(document, kind, defaultExpandedDepth),
  }));
  const expanded = expandedIds ?? state.ids;

  useEffect(() => {
    if (controlled) {
      return;
    }
    // 文档或树类型变化后需要与外部状态同步；这是受控组件镜像非受控状态的常规做法。
    // oxlint-disable-next-line react/set-state-in-effect
    setState((current) => {
      if (current.document === document && current.kind === kind) {
        return current;
      }
      // 换树时重新计算默认展开；只有同一棵树的新文档才按区间重映射 id。
      const ids =
        current.kind === kind
          ? remapExpandedIds(current.document, document, current.ids, kind)
          : defaultExpanded(document, kind, defaultExpandedDepth);
      return { kind, document, ids };
    });
  }, [controlled, document, kind, defaultExpandedDepth]);

  const update = useCallback(
    (updater: (previous: ReadonlySet<string>) => Set<string>) => {
      const next = updater(expanded);
      if (controlled) {
        onExpandedChange?.(next);
      } else {
        setState((current) => ({ ...current, ids: next }));
      }
    },
    [controlled, expanded, onExpandedChange],
  );

  const toggle = useCallback(
    (id: string) => {
      update((previous) => {
        const next = new Set(previous);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [update],
  );

  const expandAll = useCallback(() => {
    const index = buildTreeIndex(treeRoot(document, kind));
    update(() => new Set(index.entries.filter((entry) => entry.hasChildren).map((e) => e.node.id)));
  }, [document, kind, update]);

  const collapseAll = useCallback(() => update(() => new Set()), [update]);

  const revealAncestors = useCallback(
    (id: string) => {
      const index = buildTreeIndex(treeRoot(document, kind));
      const missing = ancestorIds(index, id).filter((ancestor) => !expanded.has(ancestor));
      if (missing.length > 0) {
        update((previous) => new Set([...previous, ...missing]));
      }
    },
    [document, kind, expanded, update],
  );

  return { expanded, toggle, expandAll, collapseAll, revealAncestors };
}
