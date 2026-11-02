import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: true,
    target: "es2022",
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        parse: fileURLToPath(new URL("./parse.html", import.meta.url)),
        worker: fileURLToPath(new URL("./worker.html", import.meta.url)),
      },
    },
  },
});
