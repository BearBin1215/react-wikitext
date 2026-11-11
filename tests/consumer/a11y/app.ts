import { createElement, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { flattenNodes } from "react-wikitext/ast";
import { AstTree, NodeInspector, type AstTreeNode } from "react-wikitext/devtools";
import { prepareWikitext } from "react-wikitext/hast";
import { parseWikitext } from "react-wikitext/parse";
import { WikitextView } from "react-wikitext/view";
// oxlint-disable-next-line import/no-unassigned-import -- Vite CSS entries
import "react-wikitext/styles.css";
// oxlint-disable-next-line import/no-unassigned-import -- Vite CSS entries
import "react-wikitext/devtools.css";
// oxlint-disable-next-line import/no-unassigned-import -- host fixture styles
import "./host.css";
import { ARTICLE } from "./source";

const prepared = prepareWikitext(parseWikitext(ARTICLE), {
  resolveImage: (request) =>
    request.name === "Local.svg"
      ? { src: "./local.svg", alt: `Local fixture: ${request.name}` }
      : null,
  policy: { allowRelativeImages: true },
});

const failing = prepareWikitext(parseWikitext("== Failing table ==\n\n{|\n| a\n|}"));

const DEVTOOLS_SOURCE = `== Example ==
Text with [[Internal page|a link]] and {{Infobox|title=Demo}}.`;

function ThrowingTable(): never {
  throw new Error("fixture failure");
}

function DevtoolsFixture() {
  const doc = useMemo(() => parseWikitext(DEVTOOLS_SOURCE), []);
  const [selected, setSelected] = useState<AstTreeNode | undefined>(() =>
    flattenNodes(doc.ast).find((node) => node.type === "heading"),
  );
  return createElement(
    "section",
    { "aria-labelledby": "devtools-heading" },
    createElement("h2", { id: "devtools-heading" }, "Devtools"),
    createElement(
      "div",
      {
        style: {
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 16,
          height: 360,
        },
      },
      createElement(AstTree, {
        document: doc,
        selectedId: selected?.id ?? null,
        onSelect: (node: AstTreeNode) => setSelected(node),
      }),
      createElement(NodeInspector, { document: doc, node: selected }),
    ),
  );
}

function App({ dark }: { readonly dark: boolean }) {
  return createElement(
    "main",
    dark ? { "data-wikitext-theme": "dark" } : {},
    createElement("h1", { className: "host-title" }, "Accessibility fixture"),
    createElement(
      "section",
      { "aria-labelledby": "reading-heading" },
      createElement("h2", { id: "reading-heading" }, "Reading"),
      createElement(WikitextView, { document: prepared }),
    ),
    createElement(
      "section",
      { "aria-labelledby": "instances-heading" },
      createElement("h2", { id: "instances-heading" }, "Multiple instances"),
      createElement(WikitextView, { document: prepared, idPrefix: "first-" }),
      createElement(WikitextView, { document: prepared, idPrefix: "second-" }),
    ),
    createElement(
      "section",
      { "aria-labelledby": "states-heading" },
      createElement("h2", { id: "states-heading" }, "States"),
      createElement(WikitextView, {
        document: failing,
        semanticComponents: { table: ThrowingTable },
      }),
    ),
    createElement(DevtoolsFixture),
  );
}

export function renderApp(dark: boolean): void {
  const root = globalThis.document.getElementById("root");
  if (!root) {
    throw new Error("missing root");
  }
  createRoot(root).render(createElement(App, { dark }));
}
