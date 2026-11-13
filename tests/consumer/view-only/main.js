import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { WikitextView } from "react-wikitext/view";
// oxlint-disable-next-line import/no-unassigned-import -- CSS entry
import "react-wikitext/styles.css";
import snapshot from "./snapshot.json";

const root = globalThis.document.getElementById("root");
if (!root) {
  throw new Error("missing root");
}
createRoot(root).render(createElement(WikitextView, { snapshot, idPrefix: "" }));
