import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { WikitextDocument, WikitextNode, WikitextSyntaxNode } from "react-wikitext/ast";
import { getSourceText } from "react-wikitext/ast";
import { resolveNodeInspectorLabels, type NodeInspectorLabels } from "./labels";
import { isSyntaxNode, nodeRange } from "./tree";
import type { DevtreeKind } from "./tree";

/** `<NodeInspector>` 的属性。 */
export interface NodeInspectorProps {
  /** 解析结果。 */
  readonly document: WikitextDocument;
  /** 要检查的节点。 */
  readonly node?: WikitextNode | WikitextSyntaxNode;
  /** 节点来自哪棵树，默认语义树。 */
  readonly tree?: DevtreeKind;
  /** 覆盖面板文案。 */
  readonly labels?: Partial<NodeInspectorLabels>;
  readonly className?: string;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) {
    throw new Error("document.execCommand('copy') failed.");
  }
}

type CopyState = { kind: "json" | "source"; ok: boolean } | undefined;

/**
 * 查看节点的源码、属性与 JSON，并支持复制，供 playground 调试使用。
 * 属性说明见 {@link NodeInspectorProps}。
 */
export function NodeInspector({
  document: doc,
  node,
  labels,
  className,
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

  // 以节点形状为唯一判据：传入与 `tree` 不匹配的节点时降级显示，而不是断言后崩溃。
  const syntax = node && isSyntaxNode(node) ? node : undefined;
  const semantic = node && !syntax ? node : undefined;

  const source = useMemo(() => {
    if (syntax) {
      return doc.source.slice(syntax.range[0], syntax.range[1]);
    }
    return semantic ? getSourceText(doc, semantic) : "";
  }, [doc, syntax, semantic]);
  const json = useMemo(() => (node ? JSON.stringify(node, null, 2) : ""), [node]);

  const classes = className ? `wikitext-inspector ${className}` : "wikitext-inspector";
  if (!node) {
    return (
      <div className={classes}>
        <p className="wikitext-inspector__empty">{resolved.noSelection}</p>
      </div>
    );
  }

  const copy = (kind: "json" | "source", text: string): void => {
    void copyText(text).then(
      () => setCopyState({ kind, ok: true }),
      () => setCopyState({ kind, ok: false }),
    );
  };

  const actionLabel = (kind: "json" | "source"): string => {
    if (copyState?.kind === kind) {
      return copyState.ok ? resolved.copied : resolved.copyFailed;
    }
    return kind === "json" ? resolved.copyJson : resolved.copySource;
  };

  const range = node ? nodeRange(node) : undefined;

  return (
    <div className={classes}>
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
        <button
          type="button"
          className="wikitext-inspector__action"
          onClick={() => copy("json", json)}
        >
          {actionLabel("json")}
        </button>
        <button
          type="button"
          className="wikitext-inspector__action"
          onClick={() => copy("source", source)}
        >
          {actionLabel("source")}
        </button>
      </div>
      {syntax ? (
        <>
          {Object.keys(syntax.props).length > 0 ? (
            <section className="wikitext-inspector__section">
              <h4 className="wikitext-inspector__title">{resolved.props}</h4>
              <pre className="wikitext-inspector__code">
                {JSON.stringify(syntax.props, null, 2)}
              </pre>
            </section>
          ) : null}
          {syntax.attributes.length > 0 ? (
            <section className="wikitext-inspector__section">
              <h4 className="wikitext-inspector__title">{resolved.attributes}</h4>
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
          <h4 className="wikitext-inspector__title">{resolved.semanticValue}</h4>
          <pre className="wikitext-inspector__code">
            {JSON.stringify({ ...semantic, children: undefined }, null, 2)}
          </pre>
        </section>
      )}
      <section className="wikitext-inspector__section">
        <h4 className="wikitext-inspector__title">{resolved.source}</h4>
        <pre className="wikitext-inspector__code">{source || resolved.generated}</pre>
      </section>
    </div>
  );
}
