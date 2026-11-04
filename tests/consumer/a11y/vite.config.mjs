import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: true,
    target: "es2022",
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        dark: fileURLToPath(new URL("./dark.html", import.meta.url)),
      },
    },
  },
});
