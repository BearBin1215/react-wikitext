import { writeFileSync } from "node:fs";
import { join } from "node:path";

const page = (title, script, body = "") =>
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
  </head>
  <body>
${body}
    <script src="./${script}"></script>
  </body>
</html>
`;

/** webpack 没有 HTML 插件；由构建配置在 afterEmit 中写入固定页面。 */
export function writeWebpackPages(dist) {
  writeFileSync(
    join(dist, "index.html"),
    page("react-wikitext root consumer", "index.js", '    <div id="root"></div>'),
  );
  writeFileSync(join(dist, "parse.html"), page("react-wikitext parse-only consumer", "parse.js"));
  writeFileSync(
    join(dist, "worker-page.html"),
    page("react-wikitext worker consumer", "worker-page.js"),
  );
}
