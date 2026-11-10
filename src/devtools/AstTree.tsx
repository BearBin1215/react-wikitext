import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from "react";
import { resolveAstTreeLabels, type AstTreeLabels } from "./labels";
import { restoreSelectedId, snapshotSelection, type SelectionSnapshot } from "./selection";
import {
  ancestorIds,
  buildTreeIndex,
  childrenOf,
  nodeRange,
  treeRoot,
  type AstTreeDocument,
  type AstTreeKind,
  type AstTreeNode,
  type TreeIndex,
} from "./tree";
import { useAstTreeExpansion } from "./useAstTreeExpansion";
import { useAstTreeSearch } from "./useAstTreeSearch";

/** `<AstTree>` 的属性。 */
export interface AstTreeProps {
  /** 解析快照或渲染快照；语义树只读取 `source` 与 `ast`。 */
  readonly document: AstTreeDocument;
  /** 展示哪棵树，默认语义树；`syntax` 要求文档通过 `retainSyntax` 保留了源码语法树。 */
  readonly kind?: AstTreeKind;
  /** 受控的选中节点 id；`null` 表示受控且没有选中，`undefined` 表示非受控。 */
  readonly selectedId?: string | null;
  /** 非受控模式的初始选中节点 id。 */
  readonly defaultSelectedId?: string;
  /** 选中节点时触发；`kind` 是当前树类型。 */
  readonly onSelect?: (node: AstTreeNode, kind: AstTreeKind) => void;
  /** 初始展开到第几层，默认 2；非受控模式只在挂载或换树时使用。 */
  readonly defaultExpandedDepth?: number;
  /** 受控的展开集合；提供后由调用方维护。 */
  readonly expandedIds?: ReadonlySet<string>;
  /** 展开集合变化时触发；受控与非受控模式都会调用。 */
  readonly onExpandedChange?: (ids: ReadonlySet<string>) => void;
  /** 覆盖节点说明文字；第二个参数是内置说明，返回空字符串表示不显示。 */
  readonly getNodeLabel?: (node: AstTreeNode, fallback: string) => string;
  /** 覆盖面板文案。 */
  readonly labels?: Partial<AstTreeLabels>;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** 非受控选区；保留快照，文档变化后可以按节点类型与源码区间找回。 */
interface InternalSelection {
  readonly document: AstTreeDocument;
  readonly id: string;
  readonly snapshot: SelectionSnapshot | undefined;
}

function fallbackNodeLabel(_node: AstTreeNode, fallback: string): string {
  return fallback;
}

function focusRow(event: ReactKeyboardEvent<HTMLElement>, element: HTMLElement | undefined): void {
  if (!element) {
    return;
  }
  element.focus();
  event.preventDefault();
}

function resultSnippet(source: string, query: string): string {
  const text = source.replace(/\s+/gu, " ");
  const normalized = query.trim().toLowerCase();
  const index = normalized ? text.toLowerCase().indexOf(normalized) : -1;
  if (index <= 40) {
    return text.slice(0, 80);
  }
  const start = Math.max(0, index - 40);
  return `…${text.slice(start, start + 80)}`;
}

function defaultNodeLabel(node: AstTreeNode): string {
  if ("props" in node) {
    const name = typeof node.props.name === "string" ? node.props.name : undefined;
    if (name) {
      return name;
    }
    if (typeof node.props.level === "number") {
      return `h${node.props.level}`;
    }
    if (typeof node.props.data === "string") {
      return node.props.data.trim().slice(0, 40);
    }
    return "";
  }
  switch (node.type) {
    case "heading":
      return `h${node.level}`;
    case "text":
    case "code":
    case "comment":
      return node.value.trim().slice(0, 40);
    case "link":
      return node.target;
    case "template":
      return node.displayName;
    case "parserFunction":
    case "extension":
    case "file":
    case "argument":
    case "behaviorSwitch":
      return node.name;
    case "category":
    case "redirect":
      return node.target;
    case "htmlElement":
      return node.tag;
    case "unknown":
      return node.parserType;
    default: {
      const record = node as {
        readonly name?: unknown;
        readonly target?: unknown;
        readonly value?: unknown;
      };
      if (typeof record.name === "string") {
        return record.name;
      }
      if (typeof record.target === "string") {
        return record.target;
      }
      if (typeof record.value === "string") {
        return record.value.trim().slice(0, 40);
      }
      return "";
    }
  }
}

/**
 * 可展开、搜索与键盘导航的 AST 调试树。
 * 属性说明见 {@link AstTreeProps}。
 */
export function AstTree({
  document,
  kind = "semantic",
  selectedId,
  defaultSelectedId,
  onSelect,
  defaultExpandedDepth = 2,
  expandedIds,
  onExpandedChange,
  getNodeLabel = fallbackNodeLabel,
  labels,
  className,
  style,
}: AstTreeProps): ReactElement {
  const resolved = resolveAstTreeLabels(labels);
  const { expanded, toggle, expandAll, collapseAll, revealAncestors } = useAstTreeExpansion({
    document,
    kind,
    defaultExpandedDepth,
    ...(expandedIds === undefined ? {} : { expandedIds }),
    ...(onExpandedChange === undefined ? {} : { onExpandedChange }),
  });
  const [search, setSearch] = useState("");
  const [selectionEpoch, setSelectionEpoch] = useState(0);
  const [internalSelections, setInternalSelections] = useState<
    Partial<Record<AstTreeKind, InternalSelection>>
  >(() =>
    defaultSelectedId
      ? {
          [kind]: {
            document,
            id: defaultSelectedId,
            snapshot: snapshotSelection(document, defaultSelectedId, kind),
          },
        }
      : {},
  );
  const container = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const pendingFocus = useRef<string | undefined>(undefined);
  const lastScrolled = useRef<
    { document: AstTreeDocument; kind: AstTreeKind; id: string } | undefined
  >(undefined);
  const lastRevealed = useRef<
    { document: AstTreeDocument; kind: AstTreeKind; id: string; index: TreeIndex } | undefined
  >(undefined);
  const searchId = useId();

  const root = treeRoot(document, kind);
  const index = useMemo(() => buildTreeIndex(root), [root]);
  const labelOf = useMemo(
    () => (node: AstTreeNode) => getNodeLabel(node, defaultNodeLabel(node)),
    [getNodeLabel],
  );
  const { results, truncated } = useAstTreeSearch(document, kind, search, labelOf);

  const internal = internalSelections[kind];
  const internalSelectedId = useMemo(() => {
    if (!internal) {
      return undefined;
    }
    if (internal.document === document) {
      return internal.id;
    }
    return internal.snapshot ? restoreSelectedId(document, internal.snapshot, kind) : undefined;
  }, [internal, document, kind]);
  const currentSelectedId =
    selectedId === undefined ? internalSelectedId : (selectedId ?? undefined);

  useEffect(() => {
    if (!currentSelectedId || !index.byId.has(currentSelectedId)) {
      lastRevealed.current = undefined;
      return;
    }
    const last = lastRevealed.current;
    if (
      last?.document === document &&
      last.kind === kind &&
      last.id === currentSelectedId &&
      last.index === index
    ) {
      return;
    }
    // 只在选中项或文档变化时展开祖先；用户后来折叠的选择不能被自动撤销。
    lastRevealed.current = { document, kind, id: currentSelectedId, index };
    revealAncestors(currentSelectedId);
  }, [currentSelectedId, index, revealAncestors, document, kind, selectionEpoch]);

  useEffect(() => {
    if (!currentSelectedId) {
      lastScrolled.current = undefined;
      return;
    }
    const last = lastScrolled.current;
    if (last?.document === document && last.kind === kind && last.id === currentSelectedId) {
      return;
    }
    const rows = container.current?.querySelectorAll<HTMLElement>("[data-tree-node-id]");
    const element = Array.from(rows ?? []).find(
      (candidate) => candidate.dataset.treeNodeId === currentSelectedId,
    );
    if (!element) {
      return;
    }
    if (typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
    lastScrolled.current = { document, kind, id: currentSelectedId };
  }, [currentSelectedId, expanded, document, kind, selectionEpoch]);

  useEffect(() => {
    const id = pendingFocus.current;
    if (!id || search.trim() || id !== currentSelectedId) {
      return;
    }
    const rows = container.current?.querySelectorAll<HTMLElement>("[data-tree-node-id]");
    const element = Array.from(rows ?? []).find((candidate) => candidate.dataset.treeNodeId === id);
    if (!element) {
      return;
    }
    element.focus();
    pendingFocus.current = undefined;
  }, [search, expanded, index, selectionEpoch, currentSelectedId]);

  const select = (node: AstTreeNode): void => {
    // 重新选中同一节点也要重新展开祖先并滚动，不能只比较 id。
    lastRevealed.current = undefined;
    lastScrolled.current = undefined;
    setSelectionEpoch((epoch) => epoch + 1);
    if (selectedId === undefined) {
      setInternalSelections((current) => ({
        ...current,
        [kind]: {
          document,
          id: node.id,
          snapshot: snapshotSelection(document, node.id, kind),
        },
      }));
    }
    onSelect?.(node, kind);
  };

  const handleTreeKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>): void => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-tree-label]");
    if (!target || !container.current) {
      return;
    }
    const labelButtons = Array.from(
      container.current.querySelectorAll<HTMLElement>("[data-tree-label]"),
    );
    const position = labelButtons.indexOf(target);
    const nodeId = target.dataset.treeLabel;
    const entry = nodeId ? index.byId.get(nodeId) : undefined;
    if (position < 0 || !entry || !nodeId) {
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        focusRow(event, labelButtons[position + 1]);
        break;
      case "ArrowUp":
        focusRow(event, labelButtons[position - 1]);
        break;
      case "Home":
        focusRow(event, labelButtons[0]);
        break;
      case "End":
        focusRow(event, labelButtons[labelButtons.length - 1]);
        break;
      case "ArrowRight":
        if (entry.hasChildren && !expanded.has(nodeId)) {
          toggle(nodeId);
          event.preventDefault();
        } else if (entry.hasChildren) {
          focusRow(event, labelButtons[position + 1]);
        }
        break;
      case "ArrowLeft": {
        if (expanded.has(nodeId)) {
          toggle(nodeId);
          event.preventDefault();
          break;
        }
        const parent = entry.parentId;
        focusRow(
          event,
          parent === undefined
            ? undefined
            : labelButtons.find((button) => button.dataset.treeLabel === parent),
        );
        break;
      }
      case "Enter":
      case " ":
        pendingFocus.current = undefined;
        select(entry.node);
        event.preventDefault();
        break;
      default:
        break;
    }
  };

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape" && search) {
      setSearch("");
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowDown" && results.length > 0) {
      const first = container.current?.querySelector<HTMLElement>(".wikitext-tree__result");
      if (first) {
        first.focus();
        event.preventDefault();
      }
    }
  };

  const handleResultsKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>): void => {
    if (event.key === "Escape") {
      setSearch("");
      searchInput.current?.focus();
      event.preventDefault();
      return;
    }
    const target = (event.target as HTMLElement).closest<HTMLElement>(".wikitext-tree__result");
    if (!target) {
      return;
    }
    const buttons = Array.from(
      container.current?.querySelectorAll<HTMLElement>(".wikitext-tree__result") ?? [],
    );
    const position = buttons.indexOf(target);
    if (position < 0) {
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        focusRow(event, buttons[position + 1]);
        break;
      case "ArrowUp":
        focusRow(event, buttons[position - 1]);
        break;
      case "Home":
        focusRow(event, buttons[0]);
        break;
      case "End":
        focusRow(event, buttons[buttons.length - 1]);
        break;
      default:
        break;
    }
  };

  const focusId =
    currentSelectedId &&
    index.byId.has(currentSelectedId) &&
    ancestorIds(index, currentSelectedId).every((ancestor) => expanded.has(ancestor))
      ? currentSelectedId
      : root?.id;
  const classes = className ? `wikitext-tree ${className}` : "wikitext-tree";

  if (!root) {
    return (
      <div className={classes} data-tree-kind={kind} ref={container} style={style}>
        <p className="wikitext-tree__empty">{resolved.noSyntax}</p>
      </div>
    );
  }

  const renderNode = (node: AstTreeNode): ReactElement => {
    const entry = index.byId.get(node.id);
    const children = childrenOf(node);
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(node.id);
    const isSelected = node.id === currentSelectedId;
    const fallback = defaultNodeLabel(node);
    const extra = getNodeLabel(node, fallback);
    const range = nodeRange(node);
    const preview = range
      ? document.source.slice(range[0], Math.min(range[1], range[0] + 200))
      : undefined;
    return (
      // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- 键盘处理在树的容器上统一完成
      <li
        role="treeitem"
        aria-level={(entry?.depth ?? 0) + 1}
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isSelected}
        tabIndex={node.id === focusId ? 0 : -1}
        data-tree-node-id={node.id}
        data-tree-label={node.id}
        key={node.id}
        onClick={(event) => {
          event.stopPropagation();
          pendingFocus.current = undefined;
          select(node);
        }}
      >
        <div className={`wikitext-tree__row${isSelected ? " is-selected" : ""}`}>
          {hasChildren ? (
            <span
              aria-hidden="true"
              className="wikitext-tree__toggle"
              onClick={(event) => {
                event.stopPropagation();
                // 指针点击后把焦点还给行，键盘用户使用左右方向键展开。
                (event.currentTarget as HTMLElement)
                  .closest<HTMLElement>("[data-tree-label]")
                  ?.focus();
                toggle(node.id);
              }}
            >
              {isExpanded ? "−" : "+"}
            </span>
          ) : (
            <span className="wikitext-tree__spacer" aria-hidden="true" />
          )}
          <span className="wikitext-tree__label" title={preview || undefined}>
            <span className="wikitext-tree__type">{node.type}</span>
            {range ? (
              <span className="wikitext-tree__range">
                [{range[0]}, {range[1]})
              </span>
            ) : (
              <span className="wikitext-tree__range">{resolved.noRange}</span>
            )}
            {extra ? <span className="wikitext-tree__name">{extra}</span> : null}
          </span>
        </div>
        {hasChildren && isExpanded ? (
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          <ul role="group" className="wikitext-tree__children">
            {children.map(renderNode)}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <div className={classes} data-tree-kind={kind} ref={container} style={style}>
      <div className="wikitext-tree__toolbar">
        <label className="wikitext-tree__search-label" htmlFor={searchId}>
          {resolved.searchLabel}
        </label>
        <input
          id={searchId}
          ref={searchInput}
          className="wikitext-tree__search"
          type="search"
          value={search}
          placeholder={resolved.searchPlaceholder}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={handleSearchKeyDown}
        />
        <button type="button" className="wikitext-tree__action" onClick={expandAll}>
          {resolved.expandAll}
        </button>
        <button type="button" className="wikitext-tree__action" onClick={collapseAll}>
          {resolved.collapseAll}
        </button>
      </div>
      {search.trim() ? (
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- 结果列表统一处理方向键与 Escape
        <ul
          className="wikitext-tree__results"
          aria-label={resolved.searchResults}
          onKeyDown={handleResultsKeyDown}
        >
          {results.length === 0 ? (
            <li className="wikitext-tree__empty">{resolved.noResults}</li>
          ) : null}
          {results.map((result) => (
            <li key={result.node.id}>
              <button
                type="button"
                className="wikitext-tree__result"
                onClick={() => {
                  setSearch("");
                  select(result.node);
                  pendingFocus.current = result.node.id;
                }}
              >
                <span className="wikitext-tree__type">{result.node.type}</span>
                <span className="wikitext-tree__snippet">
                  {resultSnippet(result.source, search)}
                </span>
              </button>
            </li>
          ))}
          {truncated ? <li className="wikitext-tree__empty">{resolved.resultsTruncated}</li> : null}
        </ul>
      ) : (
        <ul
          role="tree"
          className="wikitext-tree__root"
          aria-label={kind === "syntax" ? resolved.syntaxTree : resolved.treeLabel}
          onKeyDown={handleTreeKeyDown}
        >
          {renderNode(root)}
        </ul>
      )}
    </div>
  );
}
