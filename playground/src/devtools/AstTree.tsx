import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from "react";
import type { WikitextDocument } from "react-wikitext/ast";
import { resolveAstTreeLabels, type AstTreeLabels } from "./labels";
import { findDevtreeNode } from "./selection";
import {
  buildTreeIndex,
  childrenOf,
  nodeRange,
  nodeSource,
  treeRoot,
  type DevtreeKind,
  type DevtreeNode,
} from "./tree";
import { useAstTreeExpansion } from "./useAstTreeExpansion";
import { useAstTreeSearch } from "./useAstTreeSearch";

export type { DevtreeNode } from "./tree";

/** `<AstTree>` 的属性。 */
export interface AstTreeProps {
  /** 解析结果。 */
  readonly document: WikitextDocument;
  /** 展示哪棵树，默认语义树；选 `syntax` 时要求文档保留了源码语法树。 */
  readonly tree?: DevtreeKind;
  /** 当前选中的节点 id。 */
  readonly selectedId?: string;
  /** 选中节点时触发。 */
  readonly onSelect?: (node: DevtreeNode, kind: DevtreeKind) => void;
  /** 初始展开到第几层，默认 2。 */
  readonly defaultExpandedDepth?: number;
  /** 受控的展开集合；提供后由调用方维护。 */
  readonly expandedIds?: ReadonlySet<string>;
  /** 展开集合变化时触发。 */
  readonly onExpandedChange?: (ids: ReadonlySet<string>) => void;
  /** 覆盖面板文案。 */
  readonly labels?: Partial<AstTreeLabels>;
  readonly className?: string;
}

function nodeLabel(node: DevtreeNode): string {
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
      return node.value.trim().slice(0, 40);
    case "link":
      return node.target;
    case "template":
      return node.displayName;
    case "parserFunction":
    case "extension":
    case "file":
      return node.name;
    case "unknown":
      return node.parserType;
    case "argument":
      return node.name;
    default:
      return "";
  }
}

/**
 * 可展开、搜索与键盘导航的语法树面板，供 playground 调试使用。
 * 属性说明见 {@link AstTreeProps}。
 */
export function AstTree({
  document,
  tree = "semantic",
  selectedId,
  onSelect,
  defaultExpandedDepth = 2,
  expandedIds,
  onExpandedChange,
  labels,
  className,
}: AstTreeProps): ReactElement {
  const resolved = resolveAstTreeLabels(labels);
  const { expanded, toggle, expandAll, collapseAll, revealAncestors } = useAstTreeExpansion({
    document,
    kind: tree,
    defaultExpandedDepth,
    ...(expandedIds === undefined ? {} : { expandedIds }),
    ...(onExpandedChange === undefined ? {} : { onExpandedChange }),
  });
  const [search, setSearch] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const searchId = useId();

  const root = treeRoot(document, tree);
  const index = useMemo(() => buildTreeIndex(root), [root]);
  const results = useAstTreeSearch(document, tree, search, nodeLabel);

  useEffect(() => {
    if (!selectedId || !findDevtreeNode(document, selectedId, tree)) {
      return;
    }
    revealAncestors(selectedId);
  }, [document, selectedId, tree, revealAncestors]);

  useEffect(() => {
    const rows = container.current?.querySelectorAll<HTMLElement>("[data-tree-node-id]");
    const element = Array.from(rows ?? []).find(
      (candidate) => candidate.dataset.treeNodeId === selectedId,
    );
    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [selectedId, expanded, document, tree]);

  const select = (node: DevtreeNode): void => {
    onSelect?.(node, tree);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>): void => {
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
    const focus = (element: HTMLElement | undefined): void => {
      element?.focus();
      event.preventDefault();
    };
    switch (event.key) {
      case "ArrowDown":
        focus(labelButtons[position + 1]);
        break;
      case "ArrowUp":
        focus(labelButtons[position - 1]);
        break;
      case "Home":
        focus(labelButtons[0]);
        break;
      case "End":
        focus(labelButtons[labelButtons.length - 1]);
        break;
      case "ArrowRight":
        if (entry.hasChildren && !expanded.has(nodeId)) {
          toggle(nodeId);
          event.preventDefault();
        } else if (entry.hasChildren) {
          focus(labelButtons[position + 1]);
        }
        break;
      case "ArrowLeft": {
        if (expanded.has(nodeId)) {
          toggle(nodeId);
          event.preventDefault();
          break;
        }
        // 直接在当前已渲染的行里找父节点，不拼接属性选择器。
        const parent = entry.parentId;
        focus(
          parent === undefined
            ? undefined
            : labelButtons.find((button) => button.dataset.treeLabel === parent),
        );
        break;
      }
      default:
        break;
    }
  };

  const focusId = selectedId ?? root?.id;
  const classes = className ? `wtr-tree ${className}` : "wtr-tree";

  if (!root) {
    return (
      <div className={classes} ref={container}>
        <p className="wtr-tree__empty">{resolved.noSyntax}</p>
      </div>
    );
  }

  const renderNode = (node: DevtreeNode): ReactElement => {
    const entry = index.byId.get(node.id);
    const children = childrenOf(node);
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(node.id);
    const isSelected = node.id === selectedId;
    const extra = nodeLabel(node);
    const range = nodeRange(node);
    return (
      <li
        role="treeitem"
        aria-level={(entry?.depth ?? 0) + 1}
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isSelected}
        key={node.id}
      >
        <div
          className={`wtr-tree__row${isSelected ? " is-selected" : ""}`}
          data-tree-node-id={node.id}
        >
          {hasChildren ? (
            <button
              type="button"
              className="wtr-tree__toggle"
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? resolved.collapse : resolved.expand} ${node.type}`}
              tabIndex={-1}
              onClick={() => toggle(node.id)}
            >
              {isExpanded ? "−" : "+"}
            </button>
          ) : (
            <span className="wtr-tree__spacer" aria-hidden="true" />
          )}
          <button
            type="button"
            className="wtr-tree__label"
            data-tree-label={node.id}
            tabIndex={node.id === focusId ? 0 : -1}
            aria-current={isSelected ? "true" : undefined}
            onClick={() => select(node)}
            title={nodeSource(document, node).slice(0, 200)}
          >
            <span className="wtr-tree__type">{node.type}</span>
            {range ? (
              <span className="wtr-tree__range">
                [{range[0]}, {range[1]})
              </span>
            ) : (
              <span className="wtr-tree__range">{resolved.noRange}</span>
            )}
            {extra ? <span className="wtr-tree__name">{extra}</span> : null}
          </button>
        </div>
        {hasChildren && isExpanded ? (
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          <ul role="group" className="wtr-tree__children">
            {children.map(renderNode)}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <div className={classes} ref={container}>
      <div className="wtr-tree__toolbar">
        <label className="wtr-tree__search-label" htmlFor={searchId}>
          {resolved.searchLabel}
        </label>
        <input
          id={searchId}
          className="wtr-tree__search"
          type="search"
          value={search}
          placeholder={resolved.searchPlaceholder}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button type="button" className="wtr-tree__action" onClick={expandAll}>
          {resolved.expandAll}
        </button>
        <button type="button" className="wtr-tree__action" onClick={collapseAll}>
          {resolved.collapseAll}
        </button>
      </div>
      {search.trim() ? (
        <ul className="wtr-tree__results">
          {results.length === 0 ? <li className="wtr-tree__empty">{resolved.noResults}</li> : null}
          {results.map((result) => (
            <li key={result.node.id}>
              <button
                type="button"
                className="wtr-tree__result"
                onClick={() => {
                  setSearch("");
                  select(result.node);
                }}
              >
                <span className="wtr-tree__type">{result.node.type}</span>
                <span className="wtr-tree__snippet">
                  {result.source.replace(/\s+/gu, " ").slice(0, 80)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul
          role="tree"
          className="wtr-tree__root"
          aria-label={tree === "syntax" ? resolved.syntaxTree : resolved.treeLabel}
          onKeyDown={handleKeyDown}
        >
          {renderNode(root)}
        </ul>
      )}
    </div>
  );
}
