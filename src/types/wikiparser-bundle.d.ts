// 浏览器包是无 ESM 导出的 IIFE，只通过全局 Parser 暴露 API。
// 这里声明为无导出模块，避免类型层伪造 default 影响打包器的互操作判断。
declare module "wikiparser-node/bundle/bundle.min.js";
