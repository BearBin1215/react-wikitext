import * as path from "node:path";
import { defineConfig } from "@rspress/core";
import { pluginPreview } from "@rspress/plugin-preview";

const repository = "https://github.com/BearBin1215/react-wikitext";

export default defineConfig({
  root: path.join(__dirname, "docs"),
  outDir: path.join(__dirname, "doc_build"),
  themeDir: path.join(__dirname, "theme"),
  lang: "en",
  title: "react-wikitext",
  description: "React components for rendering wikitext.",
  llms: true,
  locales: [
    {
      lang: "en",
      label: "English",
      title: "react-wikitext",
      description: "React components for rendering wikitext.",
    },
    {
      lang: "zh",
      label: "中文",
      title: "react-wikitext",
      description: "用于渲染 wikitext 的 React 组件。",
    },
  ],
  globalStyles: path.join(__dirname, "styles/global.css"),
  markdown: {
    defaultWrapCode: true,
    link: {
      checkDeadLinks: {
        excludes: ["/llms.txt", "/llms-full.txt", "/zh/llms.txt", "/zh/llms-full.txt"],
      },
      checkAnchors: true,
      autoPrefix: true,
    },
  },
  themeConfig: {
    socialLinks: [
      { icon: "github", mode: "link", content: repository },
      { icon: "npm", mode: "link", content: "https://www.npmjs.com/package/react-wikitext" },
    ],
    editLink: { docRepoBaseUrl: `${repository}/blob/main/website/docs` },
    footer: { message: "GPL-3.0-or-later · react-wikitext" },
  },
  plugins: [pluginPreview()],
  builderConfig: {
    resolve: {
      alias: {
        "react-wikitext/styles.css": path.join(__dirname, "../src/styles/view.css"),
        "react-wikitext/ast": path.join(__dirname, "../src/ast/index.ts"),
        "react-wikitext/parse": path.join(__dirname, "../src/parse/index.ts"),
        "react-wikitext/expand": path.join(__dirname, "../src/expand/index.ts"),
        "react-wikitext/hast": path.join(__dirname, "../src/hast/index.ts"),
        "react-wikitext/unified": path.join(__dirname, "../src/unified/index.ts"),
        "react-wikitext/view": path.join(__dirname, "../src/view/index.ts"),
        "react-wikitext/configs": path.join(__dirname, "../src/configs/index.ts"),
        "react-wikitext": path.join(__dirname, "../src/index.ts"),
      },
    },
  },
});
