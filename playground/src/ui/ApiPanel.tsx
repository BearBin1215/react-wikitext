import { useMemo } from "react";
import {
  findNodeById,
  getFileParameters,
  getSourceText,
  getTemplateParameters,
  toPlainText,
  type WikitextDocument,
  type WikitextNode,
  type WikitextParameter,
} from "react-wikitext/ast";
import {
  sanitizeHref,
  sanitizedAttributesToProps,
  type WikitextRenderDocument,
} from "react-wikitext/hast";
import { CopyButton } from "./CopyButton";

interface ApiPanelProps {
  document?: WikitextDocument;
  prepared?: WikitextRenderDocument;
  node?: WikitextNode;
  onSelect: (node: WikitextNode) => void;
}

function parametersJson(parameters: readonly WikitextParameter[]) {
  return parameters.map((parameter) => ({
    name: parameter.name,
    anonymous: parameter.anonymous,
    ...(parameter.index === undefined ? {} : { index: parameter.index }),
    value: toPlainText(parameter.node),
  }));
}

function selectedPayload(document: WikitextDocument, node: WikitextNode): Record<string, unknown> {
  switch (node.type) {
    case "template": {
      return {
        helper: "getTemplateParameters",
        name: node.displayName,
        parameters: parametersJson(getTemplateParameters(node)),
      };
    }
    case "parserFunction": {
      return {
        helper: "getTemplateParameters",
        name: node.name,
        parameters: parametersJson(getTemplateParameters(node)),
      };
    }
    case "argument": {
      return {
        helper: "argument",
        name: node.name,
        value: toPlainText(node),
      };
    }
    case "file": {
      const data = getFileParameters(node);
      return {
        helper: "getFileParameters",
        name: data.name,
        ...(data.caption === undefined ? {} : { caption: data.caption }),
        ...(data.alt === undefined ? {} : { alt: data.alt }),
        ...(data.link === undefined
          ? {}
          : { link: data.link, sanitizedLink: sanitizeHref(data.link, { allowRelative: true }) }),
        ...(data.lang === undefined ? {} : { lang: data.lang }),
        ...(data.page === undefined ? {} : { page: data.page }),
        ...(data.className === undefined ? {} : { className: data.className }),
        ...(data.upright === undefined ? {} : { upright: data.upright }),
        ...(data.width === undefined ? {} : { width: data.width }),
        ...(data.height === undefined ? {} : { height: data.height }),
        ...(data.format === undefined ? {} : { format: data.format }),
        ...(data.alignment === undefined ? {} : { alignment: data.alignment }),
        ...(data.verticalAlignment === undefined
          ? {}
          : { verticalAlignment: data.verticalAlignment }),
        border: data.border,
        parameters: data.parameters.map((parameter) => ({
          name: parameter.name,
          value: parameter.value,
          explicit: parameter.explicit,
        })),
      };
    }
    case "link": {
      const external = node.kind !== "internal";
      return {
        helper: external ? "sanitizeHref" : "link fields",
        kind: node.kind,
        target: node.target,
        ...(node.page === undefined ? {} : { page: node.page }),
        ...(node.fragment === undefined ? {} : { fragment: node.fragment }),
        sanitizedHref: external
          ? sanitizeHref(node.target)
          : sanitizeHref(node.target, { allowRelative: true }),
      };
    }
    case "htmlElement": {
      return {
        helper: "sanitizedAttributesToProps",
        tag: node.tag,
        rawAttributes: node.attributes,
        reactAttributes: sanitizedAttributesToProps(node.attributes),
      };
    }
    default:
      break;
  }
  return {
    helper: "toPlainText",
    text: toPlainText(node).slice(0, 500),
    source: getSourceText(document, node).slice(0, 500),
  };
}

export function ApiPanel({ document, prepared, node, onSelect }: ApiPanelProps) {
  const headings = useMemo(() => prepared?.headings ?? [], [prepared]);

  const payload = useMemo((): Record<string, unknown> | undefined => {
    if (!document || !node) {
      return undefined;
    }
    const base: Record<string, unknown> = {
      node: { id: node.id, type: node.type, range: node.origin?.range },
    };
    try {
      return { ...base, ...selectedPayload(document, node) };
    } catch (error) {
      return {
        ...base,
        helper: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }, [document, node]);

  const json = payload ? JSON.stringify(payload, null, 2) : "";
  const helper = payload && typeof payload.helper === "string" ? payload.helper : "public helper";

  return (
    <div className="pg-api" data-testid="pg-api">
      <section>
        <h3>标题（prepared.headings）</h3>
        {!prepared ? (
          <p className="pg-note">等待准备渲染文档。</p>
        ) : headings.length === 0 ? (
          <p className="pg-note">当前文档没有标题。</p>
        ) : (
          <table className="pg-api__table">
            <thead>
              <tr>
                <th scope="col">级别</th>
                <th scope="col">文本</th>
                <th scope="col">id</th>
              </tr>
            </thead>
            <tbody>
              {headings.map((heading) => {
                const headingNode = findNodeById(prepared, heading.nodeId);
                return (
                  <tr key={heading.nodeId}>
                    <td>{heading.level}</td>
                    <td>
                      <button
                        type="button"
                        className="pg-api__select"
                        onClick={() => {
                          if (headingNode) {
                            onSelect(headingNode);
                          }
                        }}
                      >
                        {heading.text || "（空标题）"}
                      </button>
                    </td>
                    <td>
                      <code>{heading.id ?? "—"}</code>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h3>选中节点</h3>
        {!document ? (
          <p className="pg-note">等待解析。</p>
        ) : !node ? (
          <p className="pg-note">在 AST 树或标题列表中选择节点。</p>
        ) : (
          <>
            <div className="pg-api__toolbar">
              <span className="pg-note">
                {node.id} · {node.type} · {helper}
              </span>
              <CopyButton text={json} label="复制 JSON" />
            </div>
            <pre className="pg-code" data-testid="pg-api-json">
              <code>{json}</code>
            </pre>
          </>
        )}
      </section>
    </div>
  );
}
