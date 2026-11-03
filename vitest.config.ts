import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@pg": fileURLToPath(new URL("./playground/src", import.meta.url)),
      "react-wikitext/ast": fileURLToPath(new URL("./src/ast/index.ts", import.meta.url)),
      "react-wikitext/parse": fileURLToPath(new URL("./src/parse/index.ts", import.meta.url)),
      "react-wikitext/expand": fileURLToPath(new URL("./src/expand/index.ts", import.meta.url)),
      "react-wikitext/hast": fileURLToPath(new URL("./src/hast/index.ts", import.meta.url)),
      "react-wikitext/unified": fileURLToPath(new URL("./src/unified/index.ts", import.meta.url)),
      "react-wikitext/view": fileURLToPath(new URL("./src/view/index.ts", import.meta.url)),
      "react-wikitext/configs": fileURLToPath(new URL("./src/configs/index.ts", import.meta.url)),
      "react-wikitext/styles.css": fileURLToPath(new URL("./src/styles/view.css", import.meta.url)),
      "react-wikitext": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    testTimeout: 20_000,
  },
});
