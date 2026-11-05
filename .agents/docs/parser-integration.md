# 解析器接入

文档类型：实现规范（Normative）

适用范围：`wikiparser-node@1.48.1` 浏览器包的加载、默认适配器、配置快照、源码语法树、range/属性重建、`retainSyntax`、预算与 oracle。

公开类型见[文档站 parse 页面](../../website/docs/zh/api/parse.mdx)；测试分工见[开发约定](./development.md)；未完成事项见[路线图](./roadmap.md)。

解析器精确锁定为 `wikiparser-node@1.48.1`，不提供兼容区间，也不支持多版本并存。升级时按本文第 8 节整体替换，并以 `tests/` 中的 oracle、range 与真实语料 fixture 作为回归基线。

## 1. 运行时事实

`wikiparser-node` 的 Node 版与浏览器版使用不同入口：

| 能力 | Node 完整版 | 浏览器 `bundle.min.js` | 浏览器 `bundle-lsp.min.js` |
| --- | --- | --- | --- |
| `Parser.parse()` | 有 | 有 | 有 |
| live token 遍历 | 有 | 有 | 有 |
| 原生 `getRange()` | `json()` 结果有 range，token 本身没有 | 无 | 无 |
| `json()` | 有 | 不在支持面内 | 不在支持面内 |
| `lint()` | 有 | 不在支持面内 | 不在支持面内 |
| `toHtml()` | 有 | 无 | 无 |
| `querySelectorAll()` | 有 | 无 | 有 |
| 属性读取 | 完整 | 大多数 token 没有 `getAttr` | 类似 |
| 浏览器可用 | 否（依赖 fs/path 等） | 是 | 是 |

结论：

- 浏览器运行时只使用 `bundle.min.js` 的 `parse()` + token 遍历。
- 不依赖 `json()`、`lint()`、`toHtml()`、`querySelectorAll()`、`getAttr()`。
- 原生 range 不存在，必须由适配器重建；属性必须从 `*-attr` 子 token 提取。
- Node 完整版只作为开发期 oracle，不进入运行时。
- parser 会把 CRLF 归一化为 LF；坐标相关逻辑必须先归一化源码。

## 2. 加载方式

浏览器包是 IIFE，加载后挂到 `globalThis.Parser`，没有 ESM export。上游 `package.json` 声明 `"sideEffects": false`，因此打包器会认为它“没有可用导出、也没有副作用”。副作用导入、`void NS` 或只读取命名空间属性都不能保证模块执行。

当前实现位于 `src/parse/loadParser.ts`：

```ts
import * as ParserBundle from "wikiparser-node/bundle/bundle.min.js";
import { WikitextParseError } from "../ast/errors";

// sideEffects:false 且没有 ESM export：`void` 不足以保留 IIFE。
// 运行时读取是让打包器保留模块的副作用锚点；长度同时用于诊断。
const parserBundleKeys = Object.keys(ParserBundle as Record<string, unknown>).length;

const capturedParser = (globalThis as { Parser?: UpstreamParser }).Parser;

export function getBrowserParser(): UpstreamParser {
  if (!capturedParser || typeof capturedParser.parse !== "function") {
    throw new WikitextParseError(
      "PARSER_UNAVAILABLE",
      "wikiparser-node browser bundle did not initialize globalThis.Parser " +
        `(namespace keys: ${parserBundleKeys}).`,
    );
  }
  return capturedParser;
}
```

约束：

- 模块只执行一次 IIFE；不要重复 import 或覆盖全局。
- 导入后立即捕获全局 Parser；宿主同时加载其他版本时可能互相覆盖，当前不支持并存。
- 不可用时抛 `WikitextParseError("PARSER_UNAVAILABLE")`，错误信息包含 bundle 命名空间键数量，便于定位打包器移除 IIFE。
- `wikiparser-node` 是运行时依赖；库构建把包及其深层导入保持 external，由 consumer 打包器负责加载。CJS 产物不会内联 IIFE。
- 不要改用副作用导入、`void` 读取、`?url` + `<script>` 或 `?raw` + `eval`；这些方案会引入 CSP、Worker 与打包器差异。
- 只有 `src/parse/loadParser.ts` 加载 parser；`/ast`、`/hast`、`/unified`、`/view`、`/configs` 都不加载它。

## 3. 默认适配器与配置快照

浏览器 `parse` 签名：

```ts
Parser.parse(wikitext, include?, maxStage?, config?, page?)
```

默认适配器位于 `src/parse/adapter.ts`，调用：

```ts
const snapshot = normalizeConfig(config);
const rootToken = getBrowserParser().parse(
  source,            // 已 LF 归一化
  false,             // include = false
  PARSE_MAX_STAGE,   // 11，与浏览器包默认阶段一致
  snapshot,
  context.pageName,
);
return buildSyntaxTree(rootToken, source, context.limits);
```

职责划分：

- `createWikitextParser(adapter, options)`：源码归一化、预算合并、语法树校验、语义 AST 构建、诊断整理、schema/meta 输出。它不依赖默认 IIFE；调用 adapter 时通过 `context.limits` 提供有效的 `maxSyntaxNodes` 与 `maxDepth`。
- 默认上游适配器由 `createWikiparser` 内部创建；配置在创建时执行内部 `normalizeConfig` 并深拷贝快照。适配器本身不是公共导出。
- `createWikiparser({ config, defaults })`：组合默认适配器与通用 parser。
- `parseWikitext(source, options)`：使用默认配置的共享默认 parser，作为简洁入口。

关键点：

- **必须先做 LF 归一化**：parser 内部会把 CRLF 归一化，但 token `toString()` 不含 `\r`；用原源码反查 range 会整体错位。
- 上游 `config/*.json` 没有 `excludes` 字段；浏览器 parse 会读取它，缺失会报 `excludes is not iterable`，因此 `normalizeConfig` 补 `excludes: []`。
- 不按数组字段混合合并站点配置；调用方传入 config 时整体深拷贝使用，只补 `excludes` 并展开 `doubleUnderscore`。
- 库内置 `MEDIAWIKI_CONFIG`，来源是 `wikiparser-node@1.48.1` 的 `config/default.json` 快照；来源记录在源码注释中，不作为公共常量导出。
- 最小配置不作为公共导出；测试与 playground 直接读取上游 `wikiparser-node/config/minimum.json`。在它下面 ref/gallery/图片参数会退化，相关测试会显式覆盖这种差异。
- `pageName` 用于页面上下文（如 `{{PAGENAME}}`）；库不擅自造页面名。
- 同一份源码配不同 config 或 pageName 可能产生不同 AST；它们属于解析输入。
- 更换配置时创建新的 parser，避免每次解析隐式修改共享配置。

`normalizeConfig` 是内部实现，核心逻辑：

```ts
const cloned = structuredClone(config);
if (!Array.isArray(cloned.excludes)) {
  cloned.excludes = [];
}
const [insensitive, sensitive, insensitiveMap, sensitiveMap] = cloned.doubleUnderscore;
if (insensitive.length === 0) insensitive.push(...Object.keys(insensitiveMap));
if (sensitive.length === 0) sensitive.push(...Object.keys(sensitiveMap));
```

最小校验覆盖浏览器 parse 必需字段：对象、`html` 三数组元组、`parserFunction` 四元组、`doubleUnderscore` 四元组且后两项为对象、`namespaces`/`nsid`/`img` 为对象、`ext` 为数组。缺失时抛 `WikitextParseError("INVALID_CONFIG")`。不做完整 schema 校验；config 是可信输入，完整校验成本高且容易与上游变化耦合。

## 4. 源码语法树、range 与属性

### 4.1 节点结构

适配器把上游 token 转换为本包定义的普通对象：

```ts
interface WikitextSyntaxNode {
  readonly id: string;                       // 路径式标识，根为 "0"
  readonly type: string;                     // 上游 token type，缺失时为 "text"
  readonly range: WikitextRange;             // [start, end)，基于 LF 源码
  readonly position: WikitextPosition;       // 由 range 计算的 unist 1 基行列
  readonly props: Readonly<Record<string, WikitextPrimitive>>;
  readonly attributes: readonly WikitextSyntaxAttribute[];
  readonly children: readonly WikitextSyntaxNode[];
}
```

`props` 只复制白名单标量：

```text
name, data, level, bold, italic, anon, modifier,
closed, closing, selfClosing, subtype, extension
```

不复制 `parent`、`config`、内部缓存字段。`childNodes` 缺失表示叶子节点。`id` 采用 `0`、`0.0`、`0.0.1` 这样的路径；只有开启 `retainSyntax` 时才进入公共快照。

### 4.2 关键 token 事实

- HTML 是扁平的 `html` 开/闭 token，`closing` 可读；不要假设它有嵌套子内容。
- 表格表头在缺少 `|-` 时以 `td[subtype=th]` 直接挂在 `table` 下；`caption` 是 `td[subtype=caption]`。
- 列表标记 `list` / `dd` 的文本带尾随空格，正文是兄弟节点。
- 一个 text token 可以跨多个段落；拆分在语义归一化阶段完成，不在语法树层拆。
- `#REDIRECT` 只有位于第一行才是 `redirect`。
- `image-parameter` 通过 `name` 标识参数，内容在子节点里；解析器不会把 `=` 放进子 token 文本，搜索子 token 时需要从等号之后开始。
- 语法标记 token（`table-syntax`、`*-attr-dirty`、`heading-trail`、`quote`、`list` 等）保留在语法树；语义归一化按需跳过或消费。

### 4.3 Range 重建

浏览器 token 没有 range，`toString()` 返回该节点对应的 LF 源码片段。`buildSyntaxTree` 按父子文本顺序重建：

1. 根节点 range = `[0, source.length]`，父文本 = 整个 source。
2. 对每个父节点：
   - `cursor = 0`；
   - 依次遍历子节点；
   - 取 `childText = child.toString()`；
   - 非空子节点：`rel = parentText.indexOf(childText, cursor)`；
   - 计算 `childRange = [parentStart + rel, parentStart + rel + childText.length]`；
   - `cursor = rel + childText.length`；
   - 递归时把父文本切到子节点片段，`parentStart` 换成 `childRange[0]`。
3. 空文本子节点按零长度锚点规则处理，默认 `[parentStart + cursor, parentStart + cursor]`。
4. `image-parameter` 的 `name` 与值分属不同 token 且不带 `=`；参数以 `=` 开头时，子 token 从等号之后开始搜索。

保护措施：

- `indexOf` 返回 `-1` 时不能直接使用；当前实现回退到 cursor 并继续构建。该类偏差由 oracle 对比发现，不写入公共文档的警告字段。
- 同一文本重复出现时，顺序查找 + cursor 是正确性的关键；不要从 0 开始查找。
- 根节点 `toString()` 长度应等于归一化 source 长度；不等时由 oracle 测试发现。

零长度节点锚点：

1. `heading-trail` → 父节点末尾。
2. `html-attrs` / `ext-attrs` → 开标签 `>` 或 `/>` 的位置。
3. `ext-inner` → 闭标签起点或自闭合位置。
4. `attr-value` → 引号外侧。
5. 最后一个空 `text` → 父节点末尾。
6. 无法确定时保留 cursor。

`findNodeAtOffset`、编辑器选中和 playground 选择快照都跳过零长度节点的恢复；选择快照本身可以为零长度节点生成。

### 4.4 属性提取

浏览器包大多数 token 没有 `getAttr()`，但 `html-attrs` / `table-attrs` / `ext-attrs` 的子 token 结构稳定：

```text
*-attrs
  ├─ *-attr (name="class")
  │    ├─ attr-key   -> "class"
  │    └─ attr-value -> "wikitable"（布尔属性为空）
  └─ *-attr-dirty（空白）
```

提取规则：

- 只处理 `*-attrs` 直接子级中名称符合 `*-attr` 的 token。
- `name` 取 `*-attr` 的 `name` 并转小写。
- `value` 取 `attr-value` 子节点文本，做一次 HTML 实体解码；没有 `attr-value` 或为空时记为 `null`。
- `range` 取 `*-attr` 的 range；找不到时回退到所属父节点 range。
- 不在提取阶段做安全判断；清洗与白名单在 HAST 阶段完成。

### 4.5 文本与实体

- `getSourceText(document, node)` 返回 `source.slice(range[0], range[1])`；source 为归一化 LF。
- text token 的 `data` 保留原始实体；语义归一化时用 `entities` 的 `decodeHTML` 解码一次。后续阶段不再解码。
- 不在文本组件里把 `\n` 转 `<br>`；单换行折叠为空格，空行切段。
- nowiki/pre 中的实体同样解码，但不再解析其中的 wiki 标记。
- 行首空格 preformatted text 当前按普通文本处理，见[路线图](./roadmap.md)。

## 5. `retainSyntax`

- 默认关闭；`WikitextDocument.syntax` 不出现，`meta.syntaxSchemaVersion` 不出现。
- 开启时保留完整源码语法树，供 playground 语法树、节点属性查看和 oracle 使用。
- 即使不保留语法树，语义节点仍通过 `origin.range` 与 `origin.syntaxId`（可选）保存来源；`position`、`getSourceText` 与 `findNodeAtOffset` 都不读取语法树，因此该选项不能用来获得源码坐标。
- playground 始终开启 `retainSyntax`，因为语法树面板可随时切换；普通渲染路径不需要。
- 语法树不写入语义虚拟节点；段落、列表项、表格行等结构只存在于语义 AST。
- `/expand` 内部强制构建语法树以读取模板、参数与函数结构，但返回的 `original` / `document` 仍按调用方的 `parseOptions.retainSyntax` 决定是否公开语法树。

## 6. 预算

解析预算由 `WikitextParseOptions` 提供，默认值与公开语义见[文档站 parse 页面](../../website/docs/zh/api/parse.mdx)。检查点：

- `maxSourceLength`：LF 归一化后、调用 adapter 前。
- `maxSyntaxNodes`、`maxDepth`：传入 adapter 构造；adapter 返回后再次校验。
- `maxSemanticNodes`：语义 AST 构建并分配 id 后检查。

有效值按优先级合并：单次解析选项覆盖创建时 `defaults`，`defaults` 覆盖共享默认值。四项预算都必须是正整数；`0`、负数、小数与非有限值统一抛 `INVALID_CONFIG`。工厂把 `maxSyntaxNodes` 与 `maxDepth` 作为独立对象传给 `context.limits`；默认适配器转交 `buildSyntaxTree`，在计数或深度超限时停止后续构造。构造器未收到预算时使用共享默认值。工厂随后仍校验返回树的结构、range 与预算；忽略 `limits` 的自定义 adapter 继续可用，但返回超预算树仍会被拒绝。超限统一抛 `WikitextParseError("SOURCE_TOO_COMPLEX")` 或 `SOURCE_TOO_LONG`。`parser.resolveOptions()` 与快照的 `meta.limits` 暴露同一份生效值。

上游 token 解析会先同步完成，传入构造预算只能提前停止本包语法树构造，不能取消上游解析；调高预算也不表示支持任意深度。准备阶段对插件处理后的工作树再次执行固定预算（值与语义见[文档站 prepare 页面](../../website/docs/zh/api/prepare.mdx)）；恢复渲染快照使用独立的固定 HAST 预算。同步解析无法中途取消；调用方需要 Worker、缓存或降低上限。

## 7. Oracle 与回归

Node 完整版只用于测试，提供 `json()` 原生 range 和 `toHtml()`：

- range oracle 将浏览器语法树与 `Parser.parse(...).json()` 逐节点比较 type/range，并对条目样本做同样对比。
- `toHtml` oracle 只选择结构稳定的 fixture（引号、简单段落、基础链接）比较标签序列与文本；表格/列表不以 `toHtml` 为规范真值。
- oracle 不进入运行时，也不作为语义树设计的唯一真值；未知降级与占位行为由渲染规范定义。

运行时不得依赖完整版或 `toHtml()`；静态依赖测试检查解析层没有调用 Node-only API。

具体测试文件、样本维护与运行方式见[开发约定](./development.md)。

## 8. 版本升级清单

`wikiparser-node` 精确锁定 `1.48.1`；升级时逐项检查：

1. `npm pack` 检查浏览器 bundle 名称、文件是否存在、大小是否突变。
2. 检查 `package.json` 的 `sideEffects`、`browser`、深层路径是否变化。
3. 检查浏览器 bundle 提供的全局名是否仍为 `Parser`，以及 `Object.keys` 锚点是否仍能保留 IIFE。
4. 检查 `Parser.parse` 签名、默认 maxStage、config 必需字段是否变化。
5. 检查 token 类型、props 白名单、`toString()` 行为是否变化。
6. 检查 HTML/表格/扩展属性子 token 结构是否变化（`*-attr`、`attr-value`、`closing`、`image-parameter`）。
7. 检查文本归一化行为（CRLF、实体、换行）是否变化；跑 CRLF fixture。
8. 跑全部 range fixture，与 Node 版原生 range 对比。
9. 跑渲染 fixture、pipeline/unified 测试与 playground e2e；更新 HTML 配对/表格隐式行 fixture。
10. 构建生产 consumer 并运行 `pnpm test:consumer:browser`，确认 Vite/webpack 的页面与 Worker 在压缩产物中仍能解析；只检查字符串不足以证明 parser 可用。
11. 检查 Node 版 `toHtml` oracle 输出是否变化；不要用它覆盖表格语义。
12. 更新 `MEDIAWIKI_CONFIG` 快照、`PARSER_VERSION`、`NOTICE`、`THIRD_PARTY_LICENSES` 与 README 版本号。
13. 启动 playground 并运行 e2e，确认 parser 在开发态可用。
14. 运行 `pnpm bench`，在相同环境对比报告中的 parse/prepare/render/expand 变化；数值变化记录到摘要，不作为唯一升级门槛。
15. 任何一步失败都应先回退版本；差异未查清时不要升级。

运行检查时使用 `package.json` 中的脚本与 [CONTRIBUTING](../../CONTRIBUTING.md) 的提交前清单；边界由 `tests/parser/static.test.ts`、`tests/parser/entryIsolation.test.ts`、consumer 隔离脚本与生产浏览器用例覆盖。

## 9. 上游能力限制

- 浏览器包无原生 range、lint、`toHtml()`、`json()`、`querySelectorAll()`；属性 API 大多被裁剪。
- IIFE 全局变量存在多版本冲突风险；Vite 8 下 `void` 导入会被移除，必须使用运行时读取锚点。
- parser 会把 CRLF 归一化为 LF；坐标相关逻辑必须使用归一化源码。
- HTML 是扁平开/闭 token；表格有隐式表头行、caption 特殊单元格；语义归一化必须处理这些形态。
- 单元格内嵌套 wikitext 表格不会被 parser 保留为嵌套结构；归一化检测到不配对的开闭标记时降级为源码卡片。HTML `<table>` 嵌套仍可渲染。
- 一个 text token 可以跨多个段落；段落只能在语义层拆分。
- 100 KB 密集文本同步解析会长时间阻塞；需要 Worker 与节点上限。
- 上游 config 缺 `excludes`，必须适配。
- 预览由本项目实现，不使用 parser 的 `toHtml()`；保真度由渲染覆盖范围决定。

这些限制来自上游或项目边界，不会随开发推进消失；未完成能力见[路线图](./roadmap.md)。

## 10. 许可证

`wikiparser-node` 为 GPL-3.0-or-later；本项目随之为 GPL-3.0-or-later。上游通过 npm 依赖引入，不把上游代码复制进仓库，也不改写 IIFE。完整合规信息见[开发约定](./development.md)与 `THIRD_PARTY_LICENSES`。
