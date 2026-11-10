import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "react-wikitext/styles.css";
import "react-wikitext/devtools.css";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
