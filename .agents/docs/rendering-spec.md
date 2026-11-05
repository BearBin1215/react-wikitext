# 渲染规范

文档类型：实现规范（Normative）

适用范围：语义 AST 的归一化结果、HAST 转换、最终整理、React 映射与安全规则。

公共组件与扩展点见[文档站 react 页面](../../website/docs/zh/api/react.mdx)；测试分工见[开发约定](./development.md)；未实现能力见[路线图](./roadmap.md)。

本文只描述当前实现。支持的节点按规则渲染；未覆盖的语义结构降级为源码卡片，不猜测近似结构。

## 1. 原则

1. **React 元素优先**：不把 wikitext 或 parser 的 HTML 通过 `dangerouslySetInnerHTML` 注入。
2. **结构在语义阶段形成**：段落、列表项、表格行、配对后的 HTML 是语义 AST 结构，React 层不再扫描源码。
3. **解析与展示分离**：源码语法树服务 playground 与 oracle；语义 AST 决定显示结构；HAST 是通用 HTML 中间层。
4. **不伪造展开结果**：模板、解析器函数、文件等没有求值的一律明确占位，不输出误导性内容；使用 `/expand` 时只有展开失败后保留的调用继续占位。
5. **未知节点可降级**：不认识的语义类型显示原始源码卡片，不抛错、不整页崩溃。
6. **安全边界清晰**：HTML 标签、属性和 URL 都走白名单；样式属性默认丢弃；最终 HAST 统一清洗。
7. **可覆盖**：HTML 标签和 wiki 语义结构提供分层组件覆盖点。
8. **不为保真牺牲可解释性**：不能安全或正确渲染的语法，明确展示源码。

## 2. 处理链

```text
WikitextDocument.ast
  ── 语义归一化结果（parse 阶段已完成）──
  ── wikitextPlugins（克隆工作树）──
  ── resolver + toHast ──▶ HAST（含引用区、分类底栏、目录占位）
  ── rehypePlugins ──▶ HAST
  ── sanitize + finalize ──▶ WikitextRenderDocument（链接/图片属性、引用 id、标题锚点、目录）
  ── WikitextView / hast-util-to-jsx-runtime ──▶ React
```

归一化负责“内容结构是什么”，HAST 转换负责“显示为哪些 HTML 元素”，最终整理负责“安全属性、引用 id、标题锚点与目录”，React 层负责“组件映射、实例 id、错误隔离”。

## 3. 块级语义归一化

输入是源码语法树中非行内 token 的序列；输出是语义 AST 的块级节点。

### 3.1 段落与文本

- 一个 text token 可能包含多个段落（例如 `a\n\nb` 是单个 token），不能假设 token 与 `<p>` 1:1。
- 按 `\n[ \t]*\n(?:[ \t]*\n)*` 切分；单个换行折叠为空格；两个及以上空行切段。
- 连续的行内 token 与 text 行聚合为 `paragraph`；遇空行、标题、列表、表格、水平线、重定向、块级 HTML 或独占一行的块级结构时结束。
- 空白文本不产生段落；只有空白缓冲时直接丢弃。
- 注释、分类、行为开关不切断段落；它们保留为语义节点，但本身不进入正文。
- 段落是语义节点，带 `origin` 合并区间；不写回源码语法树。

### 3.2 标题、水平线与重定向

- `heading` → `heading` 节点，`level` 限制在 1–6；标题内容走行内归一化。
- `hr` → `thematicBreak`。
- `#REDIRECT` 只有首行被 parser 识别为 `redirect`；语义上转换为 `redirect` 节点。
- HAST 阶段：如果根的第一个语义子节点是 `redirect`，只渲染重定向横幅并跳过后续正文；其他位置出现的 `redirect` 按横幅渲染。
- 横幅结构为 `div.redirectMsg.wtr-redirect[role="note"]`，内部依次是 `p.wtr-redirect__label` 与 `ul.redirectText.wtr-redirect__list > li > span.wtr-redirect__target`；`title` 为目标页（不含片段）。
- 重定向显示目标文本（含 `#section`），不自动加载目标页。

### 3.3 列表

- 以源码行前缀 `^([*#;:]+)[ \t]*` 计算层级：
  - `*` → `<ul>`
  - `#` → `<ol>`
  - `;` → `<dl><dt>`
  - `:` → `<dl><dd>`
- 用字符栈比较相邻行的公共前缀，生成嵌套 `list` / `listItem` 或 `definitionList` / `definitionTerm` / `definitionDescription`。
- 同一行内容使用与该行 range 相交的语法子节点做行内归一化；标记本身不进入正文。
- **续行**：下一行不以列表标记开头、且不是空行/块级边界时，算作当前列表项的内容，行间折叠为空格。
- **同行块级 HTML**：列表项行内完整开闭的块级 HTML（`div`、`p`、`blockquote`、`center`、`pre`、`table` 等）按块级归一化，作为列表项的子节点；块内仍按普通块级规则处理。未在同一行闭合的块级 HTML 仍按行内处理并降级为 `unknown`；wikitext 表格继续结束列表。同一列表项内未闭合的禁止标签会保持抑制状态，后续块级 HTML 不能绕过其内容丢弃。
- **定义列表拆分**：`;` 行的顶层 `:` 分隔符由语法树的 `dd` token 识别，不要求冒号两侧有空白；链接、URL、模板、HTML 标签属性中的冒号不参与拆分。`;name:Definition` 与 `; term : definition` 都生成 `dt` + `dd`，分隔冒号本身不进入正文。
- **边界**：空行、标题、表格、块级 HTML、`{|`、行首 `|`/`!`、水平线等结束当前列表；在表格单元格内，列表扫描受单元格内容 range 限制。
- 无法安全归类的行结束列表并按普通段落处理，不生成错误的嵌套结构。

### 3.4 表格

- `td[subtype=caption]` → `tableCaption`；多个 caption 只取第一个。wikitext caption 的属性（如 `align`）保存在 `tableCaption.attributes`，与源码 HTML caption 使用同一属性白名单。
- 直接挂在 `table` 下的连续 `td` 单元格组成隐式 `tableRow`；遇到显式 `tr` 或表格结束时，结束当前行。
- 显式 `tr` 只有在包含至少一个 `td` 时才生成 `tableRow`；空行或只含 caption 的行不产生行节点。
- 单元格内容默认行内归一化；存在列表、定义列表、标题、表格、块级扩展、块级/禁止 HTML，或 text 含空行分段时，改为块级归一化，并把范围限制在单元格内容内。
- 表格属性、行属性、单元格属性从语法属性读取，保留原始 `WikitextAttribute`，安全过滤在 HAST 阶段完成。
- **wikitext 嵌套表格**：若表格源码范围内 `{|` 数量大于 1 且 `|}` 少于 `{|`，整张表转换为 `unknown`，`reason: "nestedTableUnsupported"`，不伪造嵌套结构。
- HTML `<table>` 嵌套由 HTML 块级配对处理，可正常渲染。

### 3.5 HTML 块

- 只对“开标签 + 块级/禁止/void `hr`”进入块级配对；行内标签留在行内状态机。
- 按同名标签深度计数配对；中途遇到标题、水平线、表格、列表、重定向等停止标签时停止搜索。`dd`、块级扩展与块级/禁止 HTML 不属于停止标签，仍可进入块级 HTML 的子内容并按块级归一化。
- 未闭合的已知块级标签在空行或块边界自动闭合；`pre` 等原始文本块与禁止标签不参与空行自动闭合，禁止标签对会在停止标签或范围结束时终止。`pre` 保留原始空白，不按 wiki 结构解析。
- 禁止标签转换为 `htmlElement`，`blocked: true`，内容整对丢弃。
- 未知 HTML 分类转换为 `unknown`，`parserType: "html"`，显示源码卡片。
- `meta`、`link` 不产生元素。
- 块级 HTML 的子内容：`p`、`h1`–`h6`、`li`、`dt`、`dd`、`td`、`th`、`caption` 以及 `ul`、`ol`、`dl`、`table`、`tr`、`div`、`center`、`blockquote` 等容器，在内容含标题、列表、表格、块级扩展或块级/禁止 HTML 时按块级归一化，否则按行内归一化。

### 3.6 块级扩展与独占一行结构

- `template`、`parserFunction`、`file` 只有在源码行上独占一行（允许行内前后空白）时才标记为块级；否则留在段落内。
- 块级扩展标签集合为 `pre`、`gallery`、`syntaxhighlight`、`imagemap`、`templatestyles`、`chem`、`score`、`timeline`、`mapframe`；它们无论出现在行内还是独立成行都标记为块级，未专门支持的标签按块级源码卡片展示。
- 不在块级集合且没有专门展示的扩展，独立成行时按块级源码卡片处理；其余情况保持行内。`nowiki`、`math` 独立成行时仍保持行内展示。

## 4. 行内语义归一化

- `text`：单换行折叠为空格，实体解码一次；值写入 `text.value`。
- `quote`：流式状态机维护 bold/italic 状态；遇到 `quote` 切换状态，连续相同状态的内容包装为 `b` / `i`。粗斜同时开启时输出 `<i><b>…</b></i>`，与 MediaWiki 的引号 DOM 一致。
- `html`：行内开/闭标签用栈配对，同名闭合弹出最近开标签；交错标签按就近匹配自动闭合；未闭合标签在块结束时自动闭合；void 标签直接生成自闭合元素；禁止标签进入抑制状态，内容不输出。
- `link`：内部链接生成 `link(kind: "internal", target, page?, fragment?)`；空标签按 MediaWiki pipe trick 从页面标题提取（`[[Page (context)|]]` → `Page`，命名空间不进入标签），无法提取时回退为目标文本并去掉前导 `:`，不输出空链接。
- `ext-link`：外链生成 `link(kind: "external")`；没有标签时保留空 children，由 HAST 阶段按文档顺序生成 `[N]` 和 `autonumber` class。
- `free-ext-link`：生成 `link(kind: "bareExternal")`，标签为 URL 文本。
- `template`：生成 `template`，参数作为可遍历的 `templateParameter` 子节点；匿名参数记录 1 基 `index`；`displayName` 去掉命名空间前缀。
- `magic-word`：生成 `parserFunction`，参数同样为 `templateParameter`。
- `arg`：生成 `argument`，`name` 为参数名，子节点为默认值。
- `file`：生成 `file`，结构化保存参数与说明内容；说明文字作为真实子树，不在多个字段重复保存。
- `ext`：`ref` 生成 `reference`；其余扩展（包括未专门支持的标签）生成 `extension`。
- `magic-link`：生成 `text`，按源码纯文本输出；`ISBN` / `RFC` / `PMID` 不生成外链。
- `category`、`double-underscore`、`comment`：生成 `category`、`behaviorSwitch`、`comment`，不进入正文。
- 其他未知 token：生成 `unknown`，保留 `parserType` 与源码值；不递归复制标记源码。

HTML 标记、属性 token、表格语法 token、列表标记等语法标记不会作为正文节点输出。

## 5. 语义节点到 HAST

| 语义节点 | 默认 HAST | 说明 |
| --- | --- | --- |
| `root` | 子节点序列 | 根不生成包裹元素；视图另加 `wtr-view` 容器 |
| `paragraph` | `<p class="wtr-paragraph">` | 段落内容递归 |
| `text` | text 节点 | 已解码，不再二次解码 |
| `heading` | `<h1>`–`<h6 class="wtr-heading">` | 标题锚点在最终整理阶段写入 |
| `strong` / `emphasis` | `<b>` / `<i>` | 粗斜状态机的输出；粗斜同时开启为 `<i><b>` |
| `thematicBreak` | `<hr class="wtr-hr" data-node-id="…">` | |
| `link` | `<a>` 或 `<span class="wtr-link">` | 取决于 resolver 与 URL 校验；外链同时带 `wtr-ext-link external text/free/autonumber` |
| `file` | `<figure>` / `<span class="wtr-file">` | 占位或授权 `<img>`；外层附加 `mw-default-size`、`mw-halign-*`，授权图片附加 `mw-file-element` |
| `list` / `listItem` | `<ul>`/`<ol>` + `<li>` | 列表带 `wtr-list--ul`/`wtr-list--ol`，条目带 `wtr-list__item` |
| `definitionList` / `Term` / `Description` | `<dl>` + `<dt>`/`<dd>` | class `wtr-list--dl`；术语与说明带 `wtr-list__item` |
| `table` / `Caption` / `Row` / `Cell` | `<table>` + `<caption>`/`<tbody>`/`<tr>`/`<th>`/`<td>` | 具体 class 见第 9 节 |
| `template` / `parserFunction` | `<details>` 或 `<span>` 占位 | 块级参数列表；行内 badge |
| `argument` | `<span class="wtr-argument">` | 显示 `{{{name}}}` 与默认值 |
| `reference` | `<sup class="reference wtr-ref">` + 编号链接 | 按渲染顺序编号，链接到文末 `cite_note-N`；`title` 为原始内容 |
| `extension` | 按名称映射 | `nowiki`/`pre`/`math`/`syntaxhighlight`/`gallery`/`ref`/`references` |
| `unknown` | `<section>`/`<span>` 源码卡片 | 嵌套表格使用 `wtr-table--degraded` |
| `htmlElement` | 对应标签或禁止占位 | 块级加 `wtr-html-block wtr-html-{tag}`；h1–h6 另加 `wtr-heading` 并参与锚点 |
| `redirect` | `<div class="redirectMsg wtr-redirect">` | 横幅；内部为 `p.wtr-redirect__label` + `ul.redirectText` |
| `code` | `<code>` | |
| `comment` | 不输出 | playground 仍可见 |
| `category` | 不输出 | 汇总到文末分类底栏 |
| `behaviorSwitch` | 不输出 | `toc` / `notoc` 控制目录 |

由语义节点转换出的元素或文本可通过 HAST `data.wikitext = { id, type, origin?, generated? }` 关联语义节点；需要源码定位的元素同时带 `data-node-id`。目录、引用区、分类底栏和填充单元格等生成结构不保证带这些标记。两者都由库生成，源码 HTML 无法注入。

`data-node-id` 是公开输出，不是内部调试属性：标题、链接、文件、模板、引用、列表、表格及其行/单元格、未知节点与重定向横幅都会写入，宿主页面可用于定位或高亮。playground 树行使用独立的 `data-tree-node-id`，两者不再混用；未带 `data-node-id` 的元素仍可通过 `data.wikitext.id` 关联语义节点。

## 6. 链接与图片

### 6.1 内部链接

默认渲染为不可导航文本：

```tsx
<span class="wtr-link" title="Page" data-node-id="…">
  Label
</span>
```

`resolveLink` 返回 `href` 时才生成 `<a class="wtr-link wtr-link--resolved" href="…" title="Page" data-node-id="…">`。`href` 经 `sanitizeHref` 处理，`allowRelativeLinks` 默认开启。resolver 返回 `label` 时替换纯文本标签；只返回 `label` 时不生成链接。`title` 使用页面部分（不含 `#fragment`，去掉前导 `:`）；片段只进入 href。`semanticComponents.link` 可替换整个链接结构（有 href 或降级文本都适用）。

### 6.2 外部链接与裸外链

- 仅允许 `http:`、`https:`、`mailto:`；协议相对链接补 `https:`。
- URL 先做实体解码、去除控制字符/首尾空白，再交给 `URL` 解析；拒绝 `javascript:`、`data:`、`vbscript:` 及混淆变体。
- 默认不调用 resolver 时，外链使用安全化后的源码 URL；无法安全解析时降级为 `<span class="wtr-link wtr-link--blocked">`。
- 外链 `<a>` 的 class 为 `wtr-ext-link external text`（带标签的方括号外链）、`wtr-ext-link external free`（裸 URL）或 `wtr-ext-link external autonumber`（无标签的 `[url]` 按文档顺序生成 `[N]`）。编号独立于引用计数。
- 绝对 HTTP(S)/mailto 外链 `<a>` 带 `rel="nofollow noopener noreferrer"`；`target` 由 `policy.externalLinkTarget` 决定，resolver 的 `target` 优先；设为 `null` 时不写 target。
- 相对链接在 `_blank` 时带 `noopener noreferrer`；语义外链在转换阶段产生的安全 token 会被最终整理保留。
- 最终整理会删除 `_blank`/`_self` 之外的目标，过滤未知 `rel` token，并对插件写入或修改的链接按同一规则补齐。

### 6.3 文件与图片

文件节点默认渲染占位：

```tsx
<figure class="wtr-file wtr-file--block mw-default-size" data-node-id="…">
  <span class="wtr-file__label">File: X.png</span>
  <figcaption class="wtr-file__caption">说明文字</figcaption>
</figure>
```

- 行内文件使用 `<span class="wtr-file wtr-file--inline">`；块级使用 `<figure>`。两者在未指定宽度且不是 `framed`/`manualthumb` 时追加 `mw-default-size`，有 `alignment` 时追加 `mw-halign-{alignment}`，`class=` 参数作为附加 class。
- 行内说明包在 `<span class="wtr-file__caption">` 内；块级说明使用 `<figcaption>`。说明文字来自 `file.children`，链接/模板等子节点递归渲染。
- 参数通过 `getFileParameters` 派生：格式、对齐、垂直对齐、宽高、`upright`、`alt`、`link`、`lang`、`page`、`class`、`border`。
- 宽高支持 `200`、`200px`、`200x100px`；resolver 的 width/height 优先，最终 clamp 到 1–4096。
- `link=` 经 `sanitizeHref` 后生成 `<a class="wtr-file__link">`。
- 只有 `resolveImage(request, context)` 返回 `src` 且通过 http/https 白名单（或显式允许相对图片）时才渲染 `<img class="wtr-file__image mw-file-element" loading="lazy" decoding="async">`；`alt` 缺省用文件名。
- 库不请求 `upload.wikimedia.org` 或任何远程资源；没有 resolver 时保持占位，授权图片由浏览器加载。

### 6.4 图片授权

- 准备阶段记录 resolver 实际返回并通过校验的图片 `src`。
- 最终整理按来源判断 `<img>` 授权：resolver 产物使用 `authorizedImages`；源码 HTML 使用 `policy.allowSourceImages`；插件产物使用 `policy.allowPluginImages`。未授权图片被移除，若存在 `alt` 则保留为文本，并产生 `UNAUTHORIZED_IMAGE` 诊断。
- 插件不能用任意 `img` 绕过默认不出图策略；开启 `allowPluginImages` 也不会自动放行源码 HTML 图片。

## 7. 模板、解析器函数、参数与引用

### 7.1 模板

块级模板：

```tsx
<details class="wtr-template wtr-template--block" data-node-id="…">
  <summary class="wtr-template__summary">Template not expanded: Infobox</summary>
  <ul class="wtr-template__params">
    <li class="wtr-template__param">
      <span class="wtr-template__param-name">name</span>
      <span class="wtr-template__param-eq">=</span>
      <span class="wtr-template__param-value">value</span>
    </li>
  </ul>
</details>
```

- 独占一行时使用块级 `details/summary`；否则使用行内 badge `<span class="wtr-template wtr-template--inline">`，并带源码 `title`。
- 参数列表来自 `templateParameter` 子节点；匿名参数显示 1 基序号，具名参数显示 `name = value`。
- 参数值内部可能包含嵌套模板/链接，递归转换。
- 默认管线不猜测模板含义，不生成 Infobox 外观，不执行模板；需要展开时使用 `/expand`。
- 占位文案来自 `labels.templateNotExpanded`。

### 7.2 解析器函数与参数

- `parserFunction` 显示函数名与参数，明确“不求值”；块级使用 `<details class="wtr-magic-word wtr-magic-word--block">`，行内使用 `<span class="wtr-magic-word">`，参数结构复用模板参数列表。
- `argument` 显示 `{{{name}}}`；有默认值时追加 `<span class="wtr-argument__default"> ← …</span>`，默认值递归转换。
- 默认管线不执行 `#if`、`#switch` 等函数，也不求值 Lua；`/expand` 只展开受支持的纯 wikitext 函数。

### 7.3 展开后的文档

- `expandWikitext` 返回的 `document` 已经过重新解析；展开产生的标题、段落、列表、表格、链接与 HTML 按本规范正常渲染，不再进入模板占位。
- 展开阶段无法处理的调用、缺失模板、循环和预算超限通常保留原始调用文本，并继续使用模板、函数或参数占位；连保留源码都超过长度上限时整次抛错。
- 整体回退时 `document` 使用原始快照，渲染结果与未展开时一致；展开诊断仍会进入渲染诊断。
- 展开结果和模板源码都不跳过语义归一化、HAST 转换与最终清洗。
- `{{!}}` 与 `{{=}}` 在展开阶段变成普通字符，因此不会改变参数分隔，也不会产生额外的占位节点。
- 纯函数范围包括 `#if`、`#ifeq`、`#switch`、`#iferror`、`#expr`、`#ifexpr`、`#len`、`#sub`、`#replace`、`#titleparts`、`#padleft`、`#padright`、`#urlencode`、`#urldecode`、`#lc`、`#uc`、`#lcfirst`、`#ucfirst` 与 `#tag`；表达式错误产生 `EXPRESSION_ERROR`。`#invoke`、`#time`、`#ifexist` 等站点状态函数保留原文并产生 `UNSUPPORTED_CALL`。
- 展开诊断在视图层没有专门组件；宿主通过 `document.diagnostics` 或 `expansion.records` 定位保留调用。

### 7.4 引用

- 每个 `ref` 按分组内的渲染顺序编号：`<sup class="reference wtr-ref" data-node-id="…" title="原始内容"><a class="wtr-ref__link" href="#cite_note-N" aria-label="Reference N">[N]</a></sup>`；`aria-label` 使用 `labels.reference` 加序号。
- 引用注册表按 `(group, name)` 记录定义：命名引用再次出现时复用同一编号与条目，重复定义只保留第一次内容并产生 `REFERENCE_DUPLICATE_DEFINITION` 诊断；没有内容的引用产生 `REFERENCE_MISSING_CONTENT`。
- 默认分组与命名分组各自从 1 编号；分组条目 id 为 `cite_note-<group>-N`，默认分组保持 `cite_note-N`。同一注释被多次引用时，上标 id 依次为 `cite_ref-N`、`cite_ref-N-2`。
- 引用内容默认追加为文末引用区：`<section class="wtr-references" role="doc-endnotes" data-wtr-references=""><ol class="references wtr-references__list"><li class="wtr-references__item">…`。`<references/>` 或 `<references group="x"/>` 作为占位参与布局，最终整理把对应分组的引用区放到占位处；没有占位的分组仍追加在文末。
- 注释项带 `a.wtr-references__backlink[role="doc-backlink"]`，指回正文中的每个上标；恢复快照时会先移除旧回链再重建。
- 引用内容按语义子树渲染（链接、列表、表格、模板占位、文本等），这些节点随后进入 HAST 索引，`WikitextFragment` 可以渲染 `ref` 的子节点。引用区内部再次出现的 `ref` 不参与编号，渲染为无序号占位。
- `semanticComponents.reference` 可替换 `<sup>`，并通过 `number` 读取序号；引用区仍会生成。`semanticComponents.extension` 覆盖其他扩展标签，不覆盖 `ref`。

### 7.5 目录

- 标题数达到默认阈值（4 个）时自动生成目录，放在首个标题所在的顶层块之前（标题可以位于块级 HTML 内）。
- 准备选项 `toc` 可以调整 `minHeadings`、`columns`（1–3）或设为 `false` 关闭全部目录；`minHeadings: 0` 表示只要有标题就生成。
- `__TOC__` 在标记位置强制生成目录，即使标题不足阈值；多个标记只取首个，其余占位被移除。占位可以位于 `<div>`、列表项或强调内，最终整理把首个占位替换为目录。
- `__FORCETOC__` 在不存在 `__TOC__` 时强制生成目录，但仍放在首个标题之前；`__NOEDITSECTION__` 不影响渲染，只产生 `BEHAVIOR_SWITCH_IGNORED` 信息诊断。
- 若存在 `__TOC__` 但没有任何占位能放下（例如被清洗移除），最终整理回退为自动目录，只要文档至少有一个标题。
- `__NOTOC__` 在任何位置都会关闭目录，优先级高于 `__TOC__`、`__FORCETOC__` 和自动目录；`toc: false` 优先级最高。
- 未展开的模板、解析器函数与参数中的魔术字不参与目录判断。没有标题时不输出目录。
- 目录只在最终整理阶段生成一次：`toHast` 只输出占位，阈值与放置都由 finalize 根据最终标题列表决定，包含层级、编号、文本和 `#逻辑锚点` 链接。标题锚点会把 `#`、`%`、`?`、`/` 等片段敏感字符编码为 `.HH`，保证 `id` 与 `href` 一致；`headingIdStrategy: "none"` 时只显示文本，不生成链接。
- `columns > 1` 时目录根节点追加 `wtr-toc--columns-N` class，由样式表实现多列。
- DOM 为 `div.toc.wtr-toc[role="navigation"][data-wtr-toc="toc"]`（`aria-label` 使用目录标题），内部依次是 `div.toctitle.wtr-toc__title` 与嵌套的 `ul.wtr-toc__list`；条目使用 `li.toclevel-N.tocsection-M.wtr-toc__item`，链接带 `wtr-toc__link`，编号与文本分别是 `span.tocnumber.wtr-toc__number`、`span.toctext.wtr-toc__text`。
- 实例前缀由视图统一映射；不做滚动定位、滚动联动或折叠开关。

### 7.6 分类

- `category` 不进入正文，按源码顺序汇总为文末分类底栏。
- 只收集不在未展开模板、解析器函数或参数内的分类节点。分类名去掉命名空间前缀，下划线显示为空格；`sortKey` 不显示。
- 底栏位于引用区之后，DOM 为 `div.catlinks.wtr-categories[role="navigation"]`，内部为 `div.mw-normal-catlinks.wtr-categories__inner`、`span.wtr-categories__label`、`ul.wtr-categories__list`。
- 分类项默认是与内部链接一致的无地址文本 `span.wtr-link.wtr-categories__link`，`title` 保留完整分类页名；需要可导航链接时由宿主样式或组件覆盖。
- 标题文案来自 `labels.categories`；没有分类时不输出底栏。

## 8. 扩展标签

扩展标签统一生成 `extension` 语义节点，保存 `name`、`attributes`、`selfClosing`、`block` 与已解码的内部原文 `raw`。`children` 当前为空，避免重复输出标记。

| 标签 | 当前行为 |
| --- | --- |
| `nowiki` | `<span class="wtr-nowiki">` 纯文本，实体解码，不解析链接/模板 |
| `pre` | `<pre class="wtr-ext-pre">` 原始文本，保留空白 |
| `ref` | 编号 `<sup>` + 分组引用区；见 7.4 |
| `references` | `<references/>` 占位；最终整理把对应分组引用区放到占位处 |
| `math` | `<code class="wtr-math">` 公式源码占位；不引入 KaTeX |
| `syntaxhighlight` | `<pre class="wtr-ext-code language-<lang>"><code class="language-<lang>">` 原始文本；不接语法高亮 |
| `poem` | `<div class="wtr-poem">`，按空行分段，段内换行输出 `<br>` |
| `gallery` | `<div class="wtr-gallery">`；每行文件名可经 `resolveImage` 出图，否则显示文件名与说明 |
| `imagemap`、`templatestyles`、`chem`、`score`、`timeline`、`mapframe` | 块级源码卡片；无论行内还是独立成行都按块级展示 |
| 其他未专门支持的标签 | 源码卡片；独立成行时按块级展示 |

- 未专门支持的标签同样保留名称、属性与内部原文，默认展示为源码卡片并产生 `EXTENSION_UNSUPPORTED` 诊断，不递归渲染内部节点。
- `block` 对块级扩展标签集合始终为 true；其他未专门支持的标签只有在独立成行时才标记为块级。
- 行内源码卡片会截断过长的源码；块级卡片展示完整源码。
- `semanticComponents.extension` 会收到除 `ref` 外的 `extension` 节点；`ref` 走 `semanticComponents.reference`，`<references>` 占位不产生组件调用，最终整理直接输出分组引用区。宿主可以按 `name` 接管未专门支持的标签。

## 9. 表格细节

- 输出顺序固定为 `<table><caption>…</caption><tbody>…`；caption 不放进行。
- 每个含单元格的显式行生成 `<tr class="wtr-table__row">`；隐式行只在有直接单元格时生成。表体固定为 `<tbody class="wtr-table__body">`。
- 单元格按 `kind` 生成 `<th>`/`<td>`，class 为 `wtr-table__cell`；表格本身带 `wtr-table`。
- 表格、行、单元格属性使用 `sanitizedAttributesToProps`，按标签白名单保留：表格 `class`、`title`、`dir`、`lang`、`align`、`bgcolor`、`border`、`cellpadding`、`cellspacing`、`frame`、`rules`、`summary`、`width`；行 `align`、`valign`、`bgcolor`；单元格 `scope`、`colspan`/`rowspan`、`abbr`、`headers`、`axis`、`width`、`height`、`bgcolor`、`nowrap`、`align`、`valign`；表格相关标签允许安全的 `data-*`（保留 `data-sort-value` 等，拒绝 `data-node-id`、`data-node-type`、`data-wikitext`、`data-mw*`、`data-parsoid`、`data-wtr-toc`）。所有标签继续丢弃 `style`、事件属性和 `id`。
- 表格布局在 HAST 阶段按逻辑网格计算：`colspan` 限制在当前空闲列区间内，`rowspan` 限制在剩余行数内，越界声明不会溢出表格或与已有跨行/跨列区域重叠。
- 每行补足到表格最大逻辑列数：未被本行单元格或跨行单元格占用的空位生成带 `wtr-table__cell--filler` 的 `<td>`（wikitext 表格同时带 `wtr-table__cell`），填充单元格不带语义节点，默认无边框、无内边距，不改变原有单元格内容与对齐。逻辑列数超过 100 或单表所需填充格超过 1000 时只缩小 span，不补格。
- 最终 HAST 节点数超过固定预算时，语义 wiki 表格行末连续的空补位格会被省略，并记录每表一条 `TABLE_FILLER_BUDGET_EXCEEDED` 警告。只处理库生成、完全为空、无 `data` / `data-node-id` 的补位格；未超限的表格 DOM 不变，HTML 表格与插件写入的单元格不参与。省略后仍超预算或深度超限时整页准备失败。
- HTML `<table>` 的直接 `<tr>` / `<td>` / `<th>` 行同样执行该布局；未支持的表格分组（如 `tbody`）不参与。HTML 表格的填充单元格只带 `wtr-table__cell--filler`。
- `colspan`/`rowspan` 的原始属性仍按 1–1000 clamp；布局计算只在此基础上进一步缩小，不会放大声明值。对齐、宽度和背景色只作为 HTML 属性输出。
- 单元格内容可以是行内或块级；块级内容在 `<td>`/`<th>` 内生成段落、列表等。
- 单元格内列表扫描不会跨入下一个单元格。
- wikitext 嵌套表格降级为 `section.wtr-table--degraded[role="note"]` 源码卡片，文案来自 `labels.nestedTableUnsupported`。
- HTML `<table>` 嵌套可正常渲染，class 使用 `wtr-html-block wtr-html-table`。

## 10. HTML 白名单、配对与禁止内容

### 10.1 分类

- **行内**：`b`, `strong`, `i`, `em`, `u`, `s`, `del`, `ins`, `sub`, `sup`, `code`, `small`, `big`, `span`, `mark`, `abbr`, `q`, `ruby`, `rb`, `rt`, `rp`, `bdi`, `bdo`, `cite`, `dfn`, `kbd`, `samp`, `data`, `time`, `var`, `font`。
- **块级**：`div`, `p`, `blockquote`, `center`, `pre`, `ul`, `ol`, `dl`, `table`, `caption`, `tr`, `td`, `th`, `h1`–`h6`, `li`, `dt`, `dd`。
- **void**：`br`, `wbr`, `hr`。
- **丢弃**：`meta`, `link` 不产生元素。
- **禁止**：`script`, `style`, `iframe`, `object`, `embed`, `form`, `input`, `button`, `textarea`, `select`, `option`, `svg`, `math`（HTML 版本）等；整对内容丢弃并显示可读占位，不执行。
- **未知但非危险**：不作为真实元素渲染，按源码卡片展示。

### 10.2 配对

- 行内开/闭标签用栈配对：同名闭合弹出最近开标签；交错标签按就近匹配自动闭合；未闭合标签在块结束时自动闭合。
- 块级 HTML 按同名深度配对；未闭合的已知块级标签在空行或块边界自动闭合，`pre` 与禁止标签除外。
- 禁止标签整对丢弃；其内容不能作为 HTML 进入 DOM。
- 不同名复杂交错不做 HTML5 的完整 adoption agency 算法；无法安全展示时降级为源码卡片。
- 未知标签显示 `wtr-unknown` 卡片，标出 `parserType` 与源码。

### 10.3 属性

源码 HTML 属性从语义节点 `attributes` 读取，按标签白名单重建：

- 通用：`class`, `title`, `dir`, `lang`。
- 表格：`align`, `bgcolor`, `border`, `cellpadding`, `cellspacing`, `frame`, `rules`, `summary`, `width`；行：`align`, `valign`, `bgcolor`；单元格：`colspan`, `rowspan`, `scope`, `abbr`, `headers`, `axis`, `width`, `height`, `bgcolor`, `nowrap`, `align`, `valign`；caption：`align`；表格相关标签允许安全的 `data-*`。
- `id`：不在白名单，直接丢弃，避免 DOM clobbering 与宿主页面冲突。
- `style`：只保留排版与外观相关的安全子集（颜色、字体、对齐、宽高、边框、间距、浮动等）；`url(`、`expression(`、`var(`、`@import`、`!important`、反斜杠与尖括号等声明整条丢弃，并产生 `STYLE_DECLARATION_DROPPED` 诊断。插件写入的 `style` 在清洗后按同一规则过滤。
- 事件属性（`on*`）、`srcdoc`、`href`/`src`：不在 HTML 标签白名单内；链接/图片通过 wiki 语法与 resolver 处理。源码 `<img>` 是 void 元素，`src`/`alt`/`width`/`height` 按图片属性白名单保留。
- `class` 做 token 字符集校验；`dir` 只允许 `ltr|rtl|auto`；`lang` 做粗校验；`colspan`/`rowspan` clamp 到 1–1000；`nowrap` 作为布尔属性输出。
- 属性值先做实体解码，再校验；禁止把实体编码的 `javascript:` 漏过 URL 检查。

## 11. 最终清洗与禁止内容

`prepareWikitext` 在 rehype 插件之后统一执行：

1. `sanitizeHast`：`hast-util-sanitize` + wiki schema。
2. `finalizeHast`：安全链接/图片属性、图片授权、引用 id、标题锚点与目录。wikitext 产物与 rehype 插件产物的链接/图片走同一规则：`allowRelativeLinks` / `allowRelativeImages` 在此时生效，外链补默认 `target` 与 `rel`，图片补 `loading`/`decoding`，未授权图片替换为 `alt` 文本并产生诊断。

清洗规则：

- 固定标签集合来自 `WIKITEXT_TAG_NAMES`，再加 `policy.extraTags`，减去 `policy.stripTags`。
- 属性白名单按标签细分；清洗 schema 允许 `data*`，源码 HTML 属性在提取阶段另行拒绝 `data-node-id`、`data-node-type`、`data-wikitext`、`data-wtr-toc` 等库保留名称。
- `href` 协议 `http`/`https`/`mailto`；`src` 协议 `http`/`https`。
- `class` 只接受 `[A-Za-z0-9_-]` 安全字符集。
- 注释与 doctype 不输出；事件属性与源码 HTML 的 `id` 被移除；`style` 经安全子集过滤后保留。
- 禁止标签与 `stripTags` 中的内容不会成为真实元素；无法安全展示的源码使用可读占位。
- 最终整理删除非法 `target`，按绝对 HTTP(S)/mailto 与 `_blank` 规则补全 `rel`，删除未授权或不允许的相对图片，给所有图片设置 `loading="lazy"` 与 `decoding="async"`。

调用方不能把内容插到最终安全阶段之后；`/unified` 的 `createWikitextProcessor` 在内部追加最终阶段，宿主插件只能通过 `useWikitext` / `useHast` 注册在清洗之前。

## 12. React 映射、覆盖与错误隔离

### 12.1 组件优先级

1. 显式 `semanticComponents[type]` 替换整个语义结构。
2. 未替换时，默认 HAST 结构内部的 HTML 标签使用 `components[tag]`。
3. 都没有时使用原生元素。

- `semanticComponents.link` 同时覆盖有 href 与降级文本的链接。
- `semanticComponents.file` 替换整个文件结构；`components.img` 只替换其中的 `<img>`。
- 引号输出 `<b>` / `<i>`，覆盖时使用 `components.b` / `components.i`；源码中的 `<b>` / `<i>` 与引号共用同一覆盖点，源码 `<strong>` / `<em>` 仍走各自的标签覆盖点。
- HTML 组件接收安全 props、HAST 元素、可选的 `semantic` 节点与 `origin`。
- `WikitextFragment` 在 Context 内按语义 id 查找准备结果中的 HAST 节点，适合参数值、说明文字和 ref 内容；同文档限制与重复渲染行为见[文档站 react 页面](../../website/docs/zh/api/react.mdx)。

### 12.2 实例 id

- 准备阶段生成逻辑标题锚点；语义 `heading` 与 HTML `h1`–`h6` 都参与，重复 id 按大小写不敏感追加 `_2`、`_3`。视图在 `headingIdStrategy === "instance"` 时追加前缀。
- `idPrefix` 显式传入时使用；未传时由 React `useId` 产生 `wtr-{id}-` 前缀。
- 实例映射同时改写标题 `id`、文档内 `#fragment` 链接与 `headers` 属性；不运行插件、resolver 或源码结构识别。
- `mediawiki` 策略保留裸锚点，适合与宿主约定一致的单实例场景；多实例应使用默认 `instance`。

### 12.3 错误边界

- 每个顶层 HAST 块由内部错误边界包裹；一个块失败不影响其他块。
- 错误占位为 `section.wtr-render-error[role="alert"][data-node-type="…"]`，显示 `labels.renderFailed`、节点类型与原始源码。
- 段落是容器，错误边界报告其首个具体语义节点，便于定位失败来源。
- `resetKey` 随 document 变化，切换文档后清除错误状态。
- `onRenderError(error, { node })` 提供失败节点；转换/插件错误属于准备阶段，不由此边界处理。
- 源码组件 `<Wikitext>` 在解析或准备失败时调用 `onError(error, { stage })`（`parse` / `prepare`），并可渲染 `fallback`；两者都未提供时才把异常抛给宿主。

## 13. 无障碍

- 标题渲染为真实 heading 元素；容器内层级由文档标题级别决定，不保证整页只有一个 h1。
- 表格生成真实 `<caption>`、`<tbody>`、`<th>`；`<th>` 没有显式 `scope` 时补 `scope="col"`，显式值保留。
- 外链有可读文本，新窗口通过 `target`/`rel` 表达。
- 引用编号链接有 `aria-label` 与序号文本；引用区使用 `role="doc-endnotes"`；注释项回链使用 `role="doc-backlink"`；目录与分类底栏使用 `role="navigation"`，其 `ul` 补 `role="list"`。
- 图片 `alt` 依次使用 resolver 值、`alt=` 参数、说明文字纯文本、文件名。
- 降级表格、块级禁止 HTML 与重定向横幅带 `role="note"`；行内禁止 HTML 与普通未知节点源码卡片不带 `role`，依赖可读文本。
- 代码块使用 `<pre><code>`，保留可复制文本。
- 渲染错误使用 `role="alert"`。
- AST 树使用 `role="tree"`/`treeitem`、`aria-expanded`、`aria-selected`，支持方向键与 Home/End；展开按钮使用 `<button>`。
- 组件覆盖自行提供的交互属于宿主责任。默认视图的 axe（WCAG 2.1 A/AA）与键盘用例由 `tests/consumer/browser/a11y.spec.ts` 在生产 consumer 宿主中执行；屏幕阅读器人工抽查仍未完成，见[路线图](./roadmap.md)。
- 引用上标与回链使用下划线区分，不只依赖颜色；`incomplete` 的逐项归类与宿主责任说明由无障碍用例保存。

## 14. 样式

- 库自有 class 以 `wtr-` 前缀开头；为贴近 MediaWiki，也会输出 `toc`、`toctitle`、`tocnumber`、`toctext`、`toclevel-*`、`tocsection-*`、`external`、`text`、`free`、`autonumber`、`references`、`catlinks`、`mw-normal-catlinks`、`redirectMsg`、`redirectText`、`mw-default-size`、`mw-halign-*`、`mw-file-element` 等兼容 class。
- `styles.css` 只含页面渲染规则，并 `@import "./tokens.css"`；主题 token 只有一份来源，构建时一并发布为 `dist/tokens.css`。playground 的树与检查器样式属于内部工具，不随包发布。
- 使用 CSS Variables：`--wtr-font-mono`、`--wtr-text`、`--wtr-muted`、`--wtr-border`、`--wtr-accent`、`--wtr-accent-soft`、`--wtr-placeholder-bg`、`--wtr-danger`。
- token 定义在 `:root`，宿主可在任意祖先覆盖；库不设置全局元素样式。页面字体默认继承宿主。
- 容器可选 `lang` / `dir`；`dir="rtl"` 时列表、表格、缩进正常排版。
- 深色主题通过 `[data-wtr-theme="dark"]` 或宿主 CSS Variables 覆盖，不依赖媒体查询强制。
- 生成节点不使用内联样式；`hast-util-to-jsx-runtime` 的表格对齐转 style 选项显式关闭。只有源码 HTML 与插件写入的白名单 `style` 声明会保留（见第 10 节清洗规则），其余声明一律丢弃。
- 占位文案来自 `labels`，不硬编码在组件里；默认英文，playground 传中文。

## 15. 公开 DOM 与样式承诺

1.x 内承诺以下基础结构；其余子元素、修饰 class 与 MediaWiki 兼容 class 不自动纳入承诺，仍按兼容规则处理有意变更。

- 根容器保持 `div.wtr-view`。
- 标题按源码级别生成真实 heading 元素。
- 列表、表格、链接、引用保留本规范定义的基础语义与导航关系。
- 稳定 class 集合：`wtr-view`、`wtr-heading`、`wtr-link`、`wtr-list`、`wtr-table`、`wtr-template`、`wtr-argument`、`wtr-file`、`wtr-gallery`、`wtr-ref`、`wtr-references`、`wtr-toc`、`wtr-categories`、`wtr-fragment`。
- 逻辑锚点、实例隔离、引用跳转与 `data-node-id` 的关联语义保持不变；不承诺实例前缀的具体字符串、跨编辑 id 或属性顺序。
- 不承诺默认颜色、尺寸、空白、所有内部包装节点或补格数量永久不变；改变已声明的语义、可访问性与主要样式入口仍按兼容规则处理。
- 危险输入的 DOM 可以随安全修复收紧，不承诺保持原样。

代表性 DOM 由渲染测试与浏览器交互验收；完整 HTML 字符串相等不作为唯一验收方式。
