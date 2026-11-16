// 上游 `dist/vendor/expr.js` 是 CJS 且没有 .d.ts；按实际导出声明为命名导出。
// 成功时返回数字；语法或数学错误时返回站点风格的错误 HTML 字符串。
declare module "wikiparser-node/dist/vendor/expr.js" {
  export function expr(expression: string): number | string;
}
