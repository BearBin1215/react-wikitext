import { fileURLToPath } from "node:url";
import { writeWebpackPages } from "../browser/pages.mjs";

const dist = fileURLToPath(new URL("./dist", import.meta.url));

/** 写入浏览器验收页面；不引入额外 HTML 插件依赖。 */
class ConsumerPagesPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap("ConsumerPagesPlugin", () => {
      writeWebpackPages(dist);
    });
  }
}

export default {
  mode: "production",
  devtool: false,
  target: "web",
  context: fileURLToPath(new URL(".", import.meta.url)),
  entry: {
    index: "./root.js",
    parse: "./parse.js",
    "worker-page": "./worker-page.js",
  },
  resolve: {
    // 隔离仓库 tsconfig 的 react-wikitext paths，按真实 consumer 走 package exports。
    tsconfig: false,
  },
  output: {
    path: dist,
    filename: "[name].js",
    chunkFilename: "[name].js",
    clean: true,
  },
  experiments: {
    css: true,
  },
  optimization: {
    minimize: true,
  },
  plugins: [new ConsumerPagesPlugin()],
  stats: "errors-warnings",
};
