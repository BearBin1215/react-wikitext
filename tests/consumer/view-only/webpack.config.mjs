import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("./dist-webpack", import.meta.url));

/** 写入 view-only 静态页面，避免为一个 HTML 文件引入额外插件。 */
class ViewPagePlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap("ViewPagePlugin", () => {
      writeFileSync(
        `${dist}/index.html`,
        `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>react-wikitext webpack view-only consumer</title></head>
  <body>
    <div id="root"></div>
    <script src="./bundle.js"></script>
  </body>
</html>
`,
      );
    });
  }
}

export default {
  mode: "production",
  devtool: false,
  target: "web",
  context: fileURLToPath(new URL(".", import.meta.url)),
  entry: "./main.js",
  resolve: {
    tsconfig: false,
  },
  output: {
    path: dist,
    filename: "bundle.js",
    clean: true,
  },
  experiments: {
    css: true,
  },
  optimization: {
    minimize: true,
  },
  plugins: [new ViewPagePlugin()],
  stats: "errors-warnings",
};
