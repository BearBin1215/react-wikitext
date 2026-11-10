import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  ancestorIds,
  buildTreeIndex,
  treeRoot,
  type AstTreeDocument,
  type AstTreeKind,
} from "./tree";
import { remapExpandedIds } from "./selection";

/** 展开状态；随树类型与文档绑定，切换树时不会把语义 id 套到语法树上。 */
interface ExpansionState {
  readonly kind: AstTreeKind;
  readonly document: AstTreeDocument;
  readonly ids: ReadonlySet<string>;
}

type ExpansionAction =
  | {
      readonly type: "sync";
      readonly document: AstTreeDocument;
      readonly kind: AstTreeKind;
      readonly depth: number;
    }
  | { readonly type: "toggle"; readonly id: string }
  | { readonly type: "expandAll" }
  | { readonly type: "collapseAll" }
  | { readonly type: "reveal"; readonly id: string };

/** 默认展开到指定深度的所有分支节点。 */
function defaultExpanded(document: AstTreeDocument, kind: AstTreeKind, depth: number): Set<string> {
  const index = buildTreeIndex(treeRoot(document, kind));
  const expanded = new Set<string>();
  for (const entry of index.entries) {
    if (entry.hasChildren && entry.depth < depth) {
      expanded.add(entry.node.id);
    }
  }
  return expanded;
}

function expandAllIds(document: AstTreeDocument, kind: AstTreeKind): Set<string> {
  const index = buildTreeIndex(treeRoot(document, kind));
  return new Set(index.entries.filter((entry) => entry.hasChildren).map((entry) => entry.node.id));
}

function sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const id of left) {
    if (!right.has(id)) {
      return false;
    }
  }
  return true;
}

function revealIds(
  document: AstTreeDocument,
  kind: AstTreeKind,
  ids: ReadonlySet<string>,
  id: string,
): Set<string> | undefined {
  const index = buildTreeIndex(treeRoot(document, kind));
  const missing = ancestorIds(index, id).filter((ancestor) => !ids.has(ancestor));
  return missing.length > 0 ? new Set([...ids, ...missing]) : undefined;
}

function reducer(state: ExpansionState, action: ExpansionAction): ExpansionState {
  switch (action.type) {
    case "sync": {
      if (state.document === action.document && state.kind === action.kind) {
        return state;
      }
      const next =
        state.kind === action.kind
          ? remapExpandedIds(state.document, action.document, state.ids, action.kind)
          : defaultExpanded(action.document, action.kind, action.depth);
      const ids = sameIds(state.ids, next) ? state.ids : next;
      return { kind: action.kind, document: action.document, ids };
    }
    case "toggle": {
      const ids = new Set(state.ids);
      if (ids.has(action.id)) {
        ids.delete(action.id);
      } else {
        ids.add(action.id);
      }
      return { ...state, ids };
    }
    case "expandAll": {
      const next = expandAllIds(state.document, state.kind);
      return sameIds(state.ids, next) ? state : { ...state, ids: next };
    }
    case "collapseAll":
      return state.ids.size === 0 ? state : { ...state, ids: new Set() };
    case "reveal": {
      const ids = revealIds(state.document, state.kind, state.ids, action.id);
      return ids ? { ...state, ids } : state;
    }
    default:
      return state;
  }
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
  readonly document: AstTreeDocument;
  readonly kind: AstTreeKind;
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
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    kind,
    document,
    ids: defaultExpanded(document, kind, defaultExpandedDepth),
  }));
  const expanded = expandedIds ?? state.ids;
  const notified = useRef<ReadonlySet<string>>(state.ids);

  useEffect(() => {
    if (!controlled) {
      dispatch({ type: "sync", document, kind, depth: defaultExpandedDepth });
    }
  }, [controlled, document, kind, defaultExpandedDepth]);

  // 自动重映射与外部选中都会改变展开集合；统一在提交后通知调用方。
  useEffect(() => {
    if (controlled || state.ids === notified.current) {
      return;
    }
    notified.current = state.ids;
    onExpandedChange?.(state.ids);
  }, [controlled, state.ids, onExpandedChange]);

  const notify = useCallback(
    (next: ReadonlySet<string>) => {
      onExpandedChange?.(next);
    },
    [onExpandedChange],
  );

  const toggle = useCallback(
    (id: string) => {
      if (!controlled) {
        dispatch({ type: "toggle", id });
        return;
      }
      const next = new Set(expanded);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      notify(next);
    },
    [controlled, expanded, notify],
  );

  const expandAll = useCallback(() => {
    if (!controlled) {
      dispatch({ type: "expandAll" });
      return;
    }
    const next = expandAllIds(document, kind);
    if (!sameIds(expanded, next)) {
      notify(next);
    }
  }, [controlled, document, kind, expanded, notify]);

  const collapseAll = useCallback(() => {
    if (!controlled) {
      dispatch({ type: "collapseAll" });
      return;
    }
    if (expanded.size > 0) {
      notify(new Set());
    }
  }, [controlled, expanded, notify]);

  const revealAncestors = useCallback(
    (id: string) => {
      if (!controlled) {
        dispatch({ type: "reveal", id });
        return;
      }
      const next = revealIds(document, kind, expanded, id);
      if (next) {
        notify(next);
      }
    },
    [controlled, document, kind, expanded, notify],
  );

  return { expanded, toggle, expandAll, collapseAll, revealAncestors };
}
