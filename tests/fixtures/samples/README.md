# 条目样本测试语料

这些 `.wikitext` 文件是合成的条目形态样本，只用于解析、IR、range 和渲染回归测试，不随 npm 包发布；`package.json` 的 `files` 只包含 `dist`。

- 正文全部是描述样本自身的占位文字，不保留任何条目型内容，也不引用第三方 wiki 的正文与许可。
- 文件名与模板名按语法形态命名（`tables-templates`、`links-lists`、`blocks-and-file`、`definition-lists`、`quote-hide-ext`），不指向任何具体主题。
- `manifest.json` 记录文件名、用作 `pageName` 的标题和该篇覆盖的语法点。
- 文本按 LF 归一化；升级 `wikiparser-node` 时用于 oracle 对比。
- 重复的语法只留一处代表：同构表格合并成两张，成串外链保留两三条，长段落压缩成一句说明。

新增样本时先确认语法点没有被现有五篇覆盖，再同步 `manifest.json` 的 `notes`。
