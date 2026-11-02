import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Wikitext } from "react-wikitext";
// oxlint-disable-next-line import/no-unassigned-import -- Vite CSS entry
import "react-wikitext/styles.css";
import { SOURCE } from "./fixture";

const root = globalThis.document.getElementById("root");
if (!root) {
  throw new Error("missing root");
}
createRoot(root).render(createElement(Wikitext, { source: SOURCE }));
