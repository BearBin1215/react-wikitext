import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import { resolveNodeInspectorLabels, type NodeInspectorLabels } from "./labels";
import {
  isSyntaxNode,
  nodeRange,
  nodeSource,
  type AstTreeDocument,
  type AstTreeNode,
} from "./tree";

/** `<NodeInspector>` 的属性。 */
export interface NodeInspectorProps {
  /** 解析快照或渲染快照；用于读取源码与判断节点来源。 */
  readonly document: AstTreeDocument;
  /** 要检查的节点；语义节点与源码语法节点都可以，省略时显示空状态。 */
  readonly node?: AstTreeNode;
  /** 覆盖面板文案。 */
  readonly labels?: Partial<NodeInspectorLabels>;
  readonly className?: string;
  readonly style?: CSSProperties;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 权限被拒绝或 API 不可用时继续使用 execCommand 回退。
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("document.execCommand('copy') failed.");
    }
  } finally {
    area.remove();
  }
}

function stringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return undefined;
  }
}

type CopyState = { kind: "json" | "source"; ok: boolean; nodeId: string } | undefined;

/**
 * 查看节点的源码、属性与 JSON，并支持复制。
 * 属性说明见 {@link NodeInspectorProps}。
 */
export function NodeInspector({
  document: doc,
  node,
  labels,
  className,
  style,
}: NodeInspectorProps): ReactElement {
  const resolved = resolveNodeInspectorLabels(labels);
  const [copyState, setCopyState] = useState<CopyState>(undefined);

  useEffect(() => {
    if (!copyState) {
      return;
    }
    const timer = setTimeout(() => setCopyState(undefined), 1_500);
    return () => clearTimeout(timer);
  }, [copyState]);

  // 以节点形状为唯一判据：传入任意来源的节点时降级显示，而不是断言后崩溃。
  const syntax = node && isSyntaxNode(node) ? node : undefined;
  const semantic = node && !syntax ? node : undefined;

  const source = useMemo(() => (node ? nodeSource(doc, node) : ""), [doc, node]);
  const semanticJson = useMemo(
    () => (semantic ? stringify({ ...semantic, children: undefined }) : undefined),
    [semantic],
  );

  const classes = className ? `wikitext-inspector ${className}` : "wikitext-inspector";
  if (!node) {
    return (
      <section className={classes} aria-label={resolved.regionLabel} style={style}>
        <p className="wikitext-inspector__empty">{resolved.noSelection}</p>
      </section>
    );
  }

  const copy = (kind: "json" | "source", text: string): void => {
    const nodeId = node.id;
    void copyText(text).then(
      () => setCopyState({ kind, ok: true, nodeId }),
      () => setCopyState({ kind, ok: false, nodeId }),
    );
  };

  const copyJson = (): void => {
    // 完整 JSON 可能包含整棵子树；等到用户点击时再序列化，避免选中根节点就卡住。
    const json = stringify(node);
    if (json === undefined) {
      setCopyState({ kind: "json", ok: false, nodeId: node.id });
      return;
    }
    copy("json", json);
  };

  const actionLabel = (kind: "json" | "source"): string => {
    if (copyState?.kind === kind && copyState.nodeId === node.id) {
      return copyState.ok ? resolved.copied : resolved.copyFailed;
    }
    return kind === "json" ? resolved.copyJson : resolved.copySource;
  };

  const range = nodeRange(node);
  const generated = range === undefined;
  const copyStatus =
    copyState?.nodeId === node.id
      ? `${copyState.kind === "json" ? resolved.copyJson : resolved.copySource}: ${
          copyState.ok ? resolved.copied : resolved.copyFailed
        }`
      : "";

  return (
    <section className={classes} aria-label={resolved.regionLabel} style={style}>
      <output className="wikitext-inspector__status">{copyStatus}</output>
      <div className="wikitext-inspector__header">
        <strong className="wikitext-inspector__type">{node.type}</strong>
        {range ? (
          <span className="wikitext-inspector__range">
            [{range[0]}, {range[1]})
          </span>
        ) : (
          <span className="wikitext-inspector__range">{resolved.generated}</span>
        )}
        <span className="wikitext-inspector__id">{node.id}</span>
      </div>
      <div className="wikitext-inspector__actions">
        <button type="button" className="wikitext-inspector__action" onClick={copyJson}>
          {actionLabel("json")}
        </button>
        <button
          type="button"
          className="wikitext-inspector__action"
          disabled={!source}
          onClick={() => copy("source", source)}
        >
          {actionLabel("source")}
        </button>
      </div>
      {syntax ? (
        <>
          {Object.keys(syntax.props).length > 0 ? (
            <section className="wikitext-inspector__section">
              <h3 className="wikitext-inspector__title">{resolved.props}</h3>
              {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- 可滚动代码块需要键盘焦点 */}
              <pre className="wikitext-inspector__code" tabIndex={0}>
                {JSON.stringify(syntax.props, null, 2)}
              </pre>
            </section>
          ) : null}
          {syntax.attributes.length > 0 ? (
            <section className="wikitext-inspector__section">
              <h3 className="wikitext-inspector__title">{resolved.attributes}</h3>
              <ul className="wikitext-inspector__attributes">
                {syntax.attributes.map((attribute) => (
                  <li key={`${attribute.name}:${attribute.range[0]}`}>
                    <code>{attribute.name}</code>
                    {attribute.value === null
                      ? ` ${resolved.booleanAttribute}`
                      : `= ${attribute.value}`}
                    <span className="wikitext-inspector__range">
                      {" "}
                      [{attribute.range[0]}, {attribute.range[1]})
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : (
        <section className="wikitext-inspector__section">
          <h3 className="wikitext-inspector__title">{resolved.semanticValue}</h3>
          {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- 可滚动代码块需要键盘焦点 */}
          <pre className="wikitext-inspector__code" tabIndex={0}>
            {semanticJson ?? resolved.unserializable}
          </pre>
        </section>
      )}
      <section className="wikitext-inspector__section">
        <h3 className="wikitext-inspector__title">{resolved.source}</h3>
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- 可滚动代码块需要键盘焦点 */}
        <pre className="wikitext-inspector__code" tabIndex={source ? 0 : undefined}>
          {generated ? resolved.generated : source}
        </pre>
      </section>
    </section>
  );
}
