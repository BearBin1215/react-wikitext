# 总体架构

文档类型：实现说明（Informative）

适用范围：库与 playground 的职责边界、处理管线、模块依赖、数据模型、诊断、安全与性能。

公共接口见[文档站 API 参考](../../website/docs/zh/api/index.mdx)；渲染行为见[渲染规范](./rendering-spec.md)；上游解析器细节见[解析器接入](./parser-integration.md)。

## 1. 目标与职责

目标是提供 React 优先的 wikitext 渲染器：解析事实、wiki 语义与 HTML 展示分层，普通调用与 unified 集成都复用同一套转换实现。

库负责：

- 把源码解析为不可变、可序列化的 `WikitextParsedSnapshot`，包含语义 AST 和可选的源码语法树。
- 把解析结果准备为 `WikitextRenderSnapshot`，包含插件处理后的语义树、HAST、逻辑标题锚点、policy 与 labels。
- 把准备结果渲染为 React 元素，或提供给其他 HAST consumer。
- 通过子路径隔离 parser、React 与 HAST/unified 工具。

playground 负责：

- 源码编辑、语义/语法树切换、节点检查、预览、API 探查、诊断与复现导出。
- AST 树与节点检查器来自公开的 `/devtools`，playground 只负责布局与会话状态。
- 输入源与解析/准备/视图选项解耦；Worker 解析、防抖与过期结果丢弃。
- 源码、树、预览之间的定位与选中；URL 状态与 localStorage 草稿。

明确不做：

- 内建 Lua 运行时、站点扩展、远程模板抓取、站点状态相关函数，以及模板重定向与完整标题规范化。
- 与 MediaWiki 像素级一致；内建远程图片抓取、文件仓库、分类数据服务或 wiki 页面跳转。
- 内建的 SSR/RSC 数据流、登录、存储、协作、编辑器 SDK。
- 大文档虚拟列表；大文档通过解析/准备预算与宿主 Worker 控制规模。
- 单元格内嵌套 wikitext 表格，以及行首空格 preformatted 的完整语义。
- 自定义展开函数 hook、嵌套来源映射、展开组合快照序列化与独立构建期展开后端。

模板与部分解析器函数可以在渲染前展开，但展开只使用宿主注入的源码，属于[可选前置阶段](#32-可选展开与编译器)，不改变默认处理链。未完成能力统一登记在[路线图](./roadmap.md)。

## 2. 系统上下文

```text
source
  │
  ▼
┌──────────────────────────── 库 ────────────────────────────┐
│ /expand: 模板来源 + 语法树求值 ──▶ 展开源码（可选）         │
│ /parse: parser adapter ──▶ 源码语法树 ──▶ wiki 语义 AST     │
│ /hast:  clone + plugins + resolver ──▶ HAST ──▶ sanitize    │
│ /view:  组件映射 + 实例 id + 错误边界 ──▶ React             │
└─────────────────────────────────────────────────────────────┘
  ▲                    ▲                         ▲
  │ /unified 插件       │ playground              │ 其他 HAST consumer
  │ (注入 parser)       │ (语义/语法树检查)        │
  │                    │                         │
playground (React + Vite + Worker, 内部验收台)
```

Worker 只属于 playground 调度层；库的解析与准备 API 保持同步，另提供异步准备接口。调用方负责 Worker、缓存、取消与过期结果丢弃。

## 3. 处理管线

### 3.1 阶段与职责

| 阶段 | 入口 | 输入 → 输出 | 负责 | 不负责 |
| --- | --- | --- | --- | --- |
| 可选展开 | `/expand` | 输入 → `WikitextCompilation` | 按调用结构展开模板与受支持的解析器函数，产出带来源图的解析快照 | 求值 Lua、站点状态函数、远程抓取 |
| 实时预览 | `/preview` | 输入 + executor → 渲染快照 | 防抖、请求版本、旧结果展示、取消 | 解析、编译、渲染期启动工作 |
| Worker | `/worker` | 编译请求 → 序列化渲染快照 | 复用编译器执行 compile 与 prepare | 创建 Worker、鉴权、同步硬中断 |
| 解析 | `/parse` | 源码 → `WikitextParsedSnapshot` | LF 归一化、预算、语法树校验、语义归一化、诊断 | 显示结构、HTML 清洗 |
| 准备 | `/hast`、`/unified` | `WikitextParsedSnapshot` → `WikitextRenderSnapshot` | 插件、resolver、HAST 转换、清洗、最终整理 | 解析源码、React 渲染 |
| 视图 | `/view`、根入口 | `WikitextRenderSnapshot` → React | 组件映射、实例 id、错误隔离 | 解析、运行插件或 resolver |
| 调试 | `/devtools` | `WikitextParsedSnapshot` 或 `WikitextRenderSnapshot` → React 调试面板 | AST 树、节点详情与选择恢复 | 解析、准备、正式渲染 |

固定处理链为 parser → 可选的源码语法树 → 强类型 wiki 语义 AST → HAST → React。结构归一化在语义阶段完成；HAST 只表达 HTML 结构；React 只做组件映射与实例化。

### 3.2 可选展开与编译器

`/expand` 位于固定处理链之前，独立于 `/parse`、`/hast` 与 `/view`：

```text
页面原文 + 版本
  └─ CRLF 归一化（登记变换片段）─────────▶ 归一化文本源
  └─ 页面语法编译（只编译调用结构）
  └─ 按需任务图求值 ── demand ──▶ provider 批量获取
  └─ 模板预处理（include 过滤 + 语法程序缓存）
  └─ 装配展开源码（片段关系 + 调用出现位置）──▶ 来源图
  └─ 最终语法编译与语义构建 ─────────────▶ WikitextParsedSnapshot
```

- 展开在源码语法树上按不可变 frame、参数 thunk 与确定顺序的需求轮次求值；不使用语义 AST 作为输入。最终结果重新解析，因此展开产生的表格、标题、链接等仍由后续语义阶段形成。
- 每次编译通过 `provider.open` 固定一个模板来源快照；模板表 helper 在构造时复制并校验。库不发起网络请求，也不内建 Lua、站点扩展或依赖站点状态的函数。返回的模板源码按不可信 wikitext 处理，最终仍经过同一清洗流程。
- 默认对可恢复失败保留对应调用并记录 `expand` 阶段诊断；最终源码解析失败退回原始 LF 快照并保留 `attemptedSourceId`，`failureMode: "throw"` 改为整次抛错。原始解析失败、硬资源上限、取消与不兼容 parser 始终失败。
- 诊断使用带来源的主 `location`：模板体失败指向模板有效正文，页面调用位置作为相关来源；调用记录、片段关系与语义节点 origin 共用同一来源图。嵌套调用各自登记作用域、父调用与全部输出出现位置。
- 求值分轮进行：纯计算先推进，未编译模板记录需求并推迟本轮；调度器按 provider 快照去重、按 `getMany` 或 `get` 批量获取，再按固定任务地址提交并重新求值。输出、调用状态与诊断不依赖网络返回顺序。
- 缓存分三层：模板获取结果按 provider 版本与标题；模板语法程序按 parser 身份、预算、页面上下文与归一化内容；页面语法编译按输入内容与预算。容量同时受条目与字节约束。
- 支持范围、预算、缓存与错误语义见[文档站 expand 页面](../../website/docs/zh/api/expand.mdx)。

### 3.3 解析与语义归一化

`createWikitextParser(adapter)` 统一执行源码归一化、预算合并、语法树校验、语义转换与诊断整理；它只负责串联各阶段，不加载默认上游解析器。`createWikiparser` 才组合默认适配器并加载 `wikiparser-node` 浏览器 bundle。

默认适配器把上游 token 树转换为本包定义的 `WikitextSyntaxRoot`：保留真实 token 类型、标量 props、属性及 `[start, end)` 区间，并按父文本顺序重建 range 与 unist position。解析器工厂按优先级合并预算：单次选项覆盖创建时默认值，创建时默认值覆盖共享默认值；并把 `maxSyntaxNodes` 与 `maxDepth` 传给适配器。工厂在适配器返回后仍校验结构、range 与预算，`resolveOptions()` 与快照的 `meta.limits` 暴露同一份生效值。

`buildSemanticTree` 把源码语法树转换为判别联合的 wiki 语义 AST：

- 在阶段内完成段落切分、流式引号状态机、HTML 配对、列表分组与表格归一化；React 层不再扫描源码识别结构。
- 文本实体只在此阶段解码一次；后续转换与 React 渲染不得再次把语义文本当作 HTML 实体解码。
- 模板参数、文件参数、链接目标、扩展标签内容结构化读取，后续阶段不再用 `source.slice()` 推断字段。
- 语义节点保存 `origin`；生成节点不伪造位置。

源码语法树属于解析器适配层，`retainSyntax` 默认关闭，只有 playground、oracle 与显式调试需要时才进入公共快照；语义节点的 `origin` 与查询函数不依赖它，`/expand` 通过 `parser.compile` 构建语法，`retainSyntax` 在那里只控制是否公开。

### 3.4 准备、HAST 与最终整理

`prepareWikitext(document, options)` 的固定顺序：

1. 补全 labels、policy、resolver、handlers 与标题策略。
2. 校验输入 schema 版本，克隆语义树作为工作树。
3. 执行 `wikitextPlugins`；VFile 消息按 `wikitext` 阶段收集。
4. 校验语义工作树的结构、节点数量与嵌套深度，重新分配快照内唯一 id，并清除该 root 的查询缓存。
5. 调用 resolver，把语义 AST 转换为 HAST；同时收集引用、分类与目录占位。
6. 执行 `rehypePlugins`，再按 `rehype` 阶段收集 VFile 消息。
7. 使用 `hast-util-sanitize` 与 wiki schema 做最终清洗。
8. 由库执行最终整理：安全链接/图片属性、图片授权校验、引用 id、逻辑标题锚点与目录。

`prepareWikitextAsync` 使用同一流程，仅允许异步插件；同步路径遇到异步插件抛出 `ASYNC_PLUGIN_IN_SYNC_PATH`，不静默降级。原始解析快照不会被插件修改；插件查询同一工作树后插入节点时，缓存会在重新编号后失效，后续查询返回当前结构和 id。

`/unified` 的 `createWikitextProcessor` 复用相同的设置补全、工作树校验、转换、清洗整理与快照装配。处理器在内部按「解析 → 语义插件 → 转 HAST → HAST 插件 → 清洗与最终整理」拼装 unified，`useWikitext` / `useHast` 只把插件追加到对应阶段，最终阶段由库追加，宿主插件无法排在清洗之后。每次 `run` / `runSync` 创建新的 VFile，运行之间不共享状态。

HAST 使用标准 `element`、`text`、`root` 节点。语义关联记录在可序列化的 `data.wikitext` 中；需要源码定位的元素同时输出 `data-node-id` 属性。转换阶段生成引用区、分类底栏与 `__TOC__` 占位；最终整理统一决定链接/图片属性、引用 id、标题锚点与目录生成。两者都只使用受清洗白名单约束的元素和属性。最终整理只由库控制，调用方不能把内容插到安全阶段之后。

### 3.5 React

`WikitextView` 只消费 `WikitextRenderSnapshot`：渲染期间不解析、不运行插件或 resolver。`WikitextFragment` 在同一 Context 内渲染准备结果中的节点；跨文档节点会抛错。HTML 标签与 wiki 语义组件分层覆盖；实例 id 只在视图层映射。

## 4. 模块划分与依赖

```text
src/
  ast/          model、labels、errors、limits、position、query、helpers、file-options、
                serialize、ids、sourceGraph/（源目录、片段关系、调用记录、映射、定位与
                序列化）；无 React、DOM，也不加载默认 parser
  normalize/    build、blocks、block-policy、inline、lists、tables、html、html-block、text、
                fields、context（含单一源码行索引与块级深度预算）；
                只依赖 ast 的普通数据与查询
  parser/       解析编排与自定义 adapter 工厂（组合 normalize/build，纯数据）；
                不加载默认 parser
  parse/        loadParser（IIFE）、默认 adapter、buildSyntax、ranges、attributes、index；
                仅此层加载默认 parser
  expand/       编译器：compiler、provider、cache、scheduler、evaluate、functions、include、
                syntax、types、index；依赖 parse 与 ast，不依赖 React、HAST、view
  hast/         types、toHast、prepare、stages、settings、workingAst、budget、finalize、toc、
                references、rel、sanitize、tableLayout、serialize、vfile、index；
                无 React、parser、normalize
  preview/      useWikitextPreview、executor 协议与 worker transport；
                只依赖 React 与 hast 的恢复函数
  worker/       消息协议、handler 与 attach；依赖 expand、hast，不依赖 React
  unified/      createWikitextProcessor 与 VFile data 读取 helper；
                无 React、parser
  view/         WikitextView、WikitextFragment、context、bridge、render、错误边界、类型
  devtools/     AstTree、NodeInspector、tree、selection、展开/搜索 hooks 与文案；
                只依赖 ast 的普通数据、查询与 React
  configs/      默认配置与配置类型；无 React、parser
  shared/       HTML 标签表、HAST 与 URL 谓词；无解析、清洗或 React 依赖
  styles/       view.css、devtools.css、tokens.css；页面渲染与调试组件样式、主题 token；
                源码使用原生嵌套，构建时展开
  types/        上游深层导入与 VFile 的 ambient 声明
  instrumentation.ts  阶段计时 sink 类型；通过 `profile` 选项按实例传入，默认关闭
  Wikitext.tsx  根入口的源码组件；依赖 parse、hast、view
  index.ts      根入口：view + Wikitext + 精选语义类型
```

playground 的结构：

```text
playground/src/
  editor/       CodeMirror 编辑器与 range 装饰
  catalog/      输入源与场景配置合并后的唯一清单（sources / scenes / index）
  parse/        protocol（DTO）、runParse（纯执行与解析选项）、useParseScheduler（防抖、
                Worker/主线程回退、过期结果）；不持有输入源身份
  session/      唯一状态来源：reducer、usePlaygroundSession、selectors、persistence（URL 与草稿）
  harness/      示例 resolver/组件、复现生成、选项到 props 映射、剪贴板
  ui/           场景菜单与参数栏、顶栏、状态栏、诊断、API、复现面板与文案
  state/        PlaygroundOptions 类型与 URL 编解码、系统主题
```

依赖方向：

- `ast/model` 及其纯数据/工具模块是基础层；`parser/` 是唯一组合 `normalize/build` 的模块，`/ast` 与 `/parse` 都从它导出工厂。`normalize` 只依赖 ast 的普通数据与查询，不依赖 React、DOM 或 parser。
- `parser` 只依赖 `ast` 与 `normalize`；`parse` 可以依赖 `ast`、`configs` 与 `parser`；只有 `parse/loadParser.ts` 加载 IIFE。
- `expand` 依赖 `ast` 与 `parse`，可以加载 parser；不依赖 React、`hast`、`unified` 或 `view`。
- `hast` 依赖 `ast`、`shared` 与打包的 unified/hast 工具；不依赖 parser、`normalize`、React 或 `/ast` 桶。
- `unified` 依赖 `hast` 的共享阶段模块与 `ast`，不隐式创建默认 parser。
- `view` 依赖 `ast`、`shared`、React 与打包的 `hast-util-to-jsx-runtime`（`@types/hast` 只用于类型），不 import `parse`、`configs` 或 `loadParser`，也不通过值导入获取清洗实现。
- `devtools` 依赖 `ast` 的普通数据与查询以及 React，不依赖 parser、`normalize`、`hast`、`unified` 或 `view`；playground 通过公共入口复用这些组件。
- 根入口的 `Wikitext` 组件依赖 `parse`、`hast`、`view`，会加载 parser；`/view` 入口只依赖 `view`、`ast` 与 React，不加载 parser。
- `src/` 不依赖 CodeMirror 或 playground；核心解析/准备不依赖 DOM。
- playground 只通过 `@pg/*` 引用自身、通过 package 公共入口引用库；禁止 `@/` 或更深层导入。
- `/devtools` 是公开调试入口，不进入正式渲染链；根入口、`/view` 与 `/hast` 都不依赖它。
- 库样式只使用 `.wikitext-*`；MediaWiki 兼容 class 是受控例外，见[渲染规范](./rendering-spec.md#14-样式)。

`tests/parser/static.test.ts`、`tests/parser/entryIsolation.test.ts`、`tests/playground/imports.test.ts` 与 consumer 隔离脚本持续检查这些边界。

## 5. 数据模型与源码映射

完整类型以[文档站 ast 页面](../../website/docs/zh/api/ast.mdx)为准，这里只说明职责。

- 解析快照 `WikitextParsedSnapshot`：`kind: "parsed"`、快照 id、活动 source id、来源图、活动源码、语义 AST、可选源码语法树、meta 与诊断。它是原始事实，准备阶段不会修改。
- 渲染快照 `WikitextRenderSnapshot`：`kind: "render"`，继承同一来源图与活动源码，另含插件处理后的语义工作树、最终 HAST、逻辑标题锚点、meta（含已解析 policy、labels 与 `authorizedImages`）与合并诊断。
- 编译结果 `WikitextCompilation`：状态、输入/实际输出/失败尝试的 source id、解析快照、依赖清单与统计；诊断与来源图只保存在其 `snapshot`。
- 序列化只输出普通对象；恢复函数校验 schema、`meta` 形状与固定 HAST 预算，渲染快照恢复后重新执行清洗与最终整理。快照内的 `policy`、`labels` 与 `authorizedImages` 属于可信边界：重新清洗只用于重建派生结构，不能把第三方 HAST 变成可信内容。序列化不是安全证明，只应接收本库产生的可信数据。

源码映射与标识：

- 所有 span 是带 `sourceId` 的 UTF-16 `[start, end)`；line/column 由 `getSourcePosition` 从所属文本源按需计算，节点与诊断不另存一份 position。
- 语义节点带 `origin`（`sourceId` + `start`/`end`，可选 `syntaxId`），生成节点省略；HAST 节点通过 `data.wikitext.origin` 关联语义来源。
- 来源图登记输入原文、LF 文本、模板原文、有效正文与展开结果，以及片段关系与调用记录；关系通过 id 引用，索引与查询方法不进入序列化数据。
- 片段关系区分 `copy`、`normalize`、`delete`、`generated`、`invocation` 与 `value`；`precision` 为 `exact` 或 `enclosing-invocation`，多阶段组合不提升精度。
- `mapSourceSpan` 返回多段匹配、未映射子范围与覆盖率；`locateRenderedNode` / `findRenderedNodes` 与 `getSourcePosition` 共享同一来源图实现。
- `id` 是快照内唯一的路径式标识，不承诺跨编辑稳定。准备阶段插件复制/插入节点后会重新分配 id，并使该工作树的节点列表与 id 索引缓存失效；插件已持有的旧数组或 Map 不会实时更新。
- `getSourceText(snapshot, node)` 读取来源源码；`toPlainText(node)` 读取转换后的语义内容。
- HAST 的 `data.wikitext.id` 指向渲染快照中的语义节点；`sourceAttributes` 启用时额外输出 `data-wikitext-{snapshot,node,source,start,end}`。视图用该 id 建立语义索引与 HAST 索引，源码 HTML 无法注入这些保留属性。
- 标题逻辑锚点在准备阶段生成；`headingIdStrategy` 为 `instance` 时视图追加实例前缀，`mediawiki` 保留裸锚点，`none` 不写 id。
- 调用记录保存自身文本源、作用域身份、父调用、状态与全部输出出现位置；同一模板的范围可以对应多个展开位置。

## 6. 诊断与错误

诊断统一使用 `WikitextDiagnostic`，按阶段归属：

| 阶段 | 主要来源 |
| --- | --- |
| `parse` | 语义归一化中的嵌套表格降级与未知语法节点 |
| `expand` | 展开过程中的可恢复失败；同时写入 `expansion.diagnostics` |
| `wikitext` | wiki 插件通过 VFile 报告的消息 |
| `hast` | 扩展标签降级、未知语义节点、图片占位、禁止 HTML、样式声明丢弃、引用错误与行为开关 |
| `rehype` | rehype 插件消息 |
| `sanitize` | 插件写入的非法内联样式 |
| `finalize` | 未授权图片移除（`UNAUTHORIZED_IMAGE`） |

- 诊断码的固定词表是 `KnownWikitextDiagnosticCode`；`WikitextDiagnosticCode` 还允许插件传入自定义字符串。
- 解析阶段的降级诊断写入 `WikitextParsedSnapshot.diagnostics`，准备阶段合并进渲染快照诊断。
- 展开诊断保留带来源的 `location`，并合并进 `snapshot.diagnostics`；调用记录与输出位置在 `snapshot.graph` 上。
- `/unified` 处理器在进入 HAST 阶段时收集 wiki 消息，在最终阶段只收集此后的 rehype 消息，避免同一消息按错误阶段重复出现。
- 没有 handler 的语义节点产生 `UNKNOWN_NODE`，并降级为安全卡片。

`WikitextError` 是基类；`WikitextParseError`、`WikitextExpandError` 与 `WikitextPrepareError` 分别覆盖解析、展开与准备阶段。单节点渲染失败由内部块级错误边界隔离，展示该节点源码，并通过 `onRenderError` 回调；转换/插件错误属于准备阶段，不能交给 React 错误边界恢复。错误码与触发条件见[文档站错误页面](../../website/docs/zh/api/errors.mdx)。

## 7. 安全模型

- 不使用 `dangerouslySetInnerHTML`；库不执行 wikitext 中的 HTML 或脚本。
- 展开阶段的模板源码同样按不可信 wikitext 处理：只做文本拼接与重新解析，不使用 `eval`，不内建 Lua，不跳过后续语义归一化与清洗。
- resolver 只能返回 wikitext 字符串或普通数据；模板源码和展开结果都不能绕过 HAST 清洗、URL 校验或图片授权。
- 归一化阶段按 `void`/`inline`/`block`/`banned`/`drop`/`unknown` 分类 HTML 标签；禁止标签整对丢弃并显示可读占位，未知标签降级为卡片。
- 源码 HTML 属性按固定白名单过滤，丢弃事件属性与 `id`；`style` 只保留安全排版子集，非法声明产生诊断；表格标签允许安全 `data-*`，但拒绝库保留属性。完整列表见[渲染规范](./rendering-spec.md#10-html-白名单配对与禁止内容)。
- rehype 插件之后统一调用 `hast-util-sanitize`：固定标签集合、属性白名单、协议白名单、`stripTags` 与受控 class 模式；不允许无条件关闭清洗。
- 外链只允许 `http:`、`https:`、`mailto:`；图片只允许 `http:`/`https:`；解析 URL 前先做实体解码、控制字符清理与协议相对补全。
- 绝对 HTTP(S)/mailto 链接默认只带 `rel="nofollow"`，`_blank` 时追加 `noreferrer noopener`；相对链接在 `_blank` 时带 `noopener noreferrer`；插件写入或修改的链接在最终整理中按同一规则补齐。`target` 只允许 `_blank`/`_self`。
- 默认不启用图片；只有 resolver 返回并通过 URL 校验的 `src` 会被授权。源码 HTML `img` 由 `allowSourceImages` 控制，插件新增或替换的 `img` 由 `allowPluginImages` 控制，未授权时移除并产生诊断。
- 默认相对链接规则与 policy 默认值见[文档站 prepare 页面](../../website/docs/zh/api/prepare.mdx)。
- 自定义组件与插件属于可信程序；库保证它们收到的数据经过约定处理，但不会再次清洗任意自定义组件输出的 HTML。
- 库自身不发起网络请求、不依赖远程字体或 CDN；内联样式只来自源码 HTML、插件的白名单声明与目录折叠 checkbox 的固定 `display:none`，`url()` 一类声明会被丢弃，不会借样式加载资源；resolver 授权的图片由浏览器按普通 `<img>` 加载。

## 8. 性能与规模

目标：

- 20 KB 的常规样例在输入时不阻塞界面。
- 50 KB 的文档在 Worker 与折叠策略下可用。
- 100 KB 的文档必须有明确上限和错误提示。

措施：

- 解析预算覆盖源码长度、语法/语义节点数与深度，均可按解析选项覆盖；默认值见[文档站 parse 页面](../../website/docs/zh/api/parse.mdx)。有效语法节点与深度预算会传给默认适配器，用于在构造阶段提前停止；上游 token 解析仍会同步完成，不能保证中途取消。自定义适配器可以忽略该预算，工厂仍会校验返回的语法树。
- 展开预算覆盖求值深度、调用次数与展开长度；模板源码与 include 过滤后的有效源码都受源码长度上限约束。默认值见[文档站 expand 页面](../../website/docs/zh/api/expand.mdx)。
- 展开缓存分三层：模板获取结果按 provider 版本与标题、模板语法程序按 parser 与页面上下文、页面语法编译按输入内容与预算；容量同时受条目与字节约束。循环检测按词法 frame 路径判断。
- 准备阶段对插件处理后的工作树再次执行固定的节点数与深度预算，防止插件扩大树规模；最终 HAST 与恢复渲染快照共用同一组固定 HAST 预算，prepare 的合法产物总能被 restore 接受。最终 HAST 节点数超限时，先省略语义 wiki 表格行末的库生成空补位格并记录警告；省略后仍超限、深度超限或无法省略时失败。
- 归一化只建立一次源码行索引（与位置换算共用行起点），列表按二分定位行与节点窗口；块级深度由 `NormalizeContext.maxDepth` 统一约束，超限抛 `SOURCE_TOO_COMPLEX` 而不是静默截断或抛原生 `RangeError`。
- 公共快照不保存 `flat`、Map 或父指针；`flattenNodes` 与按 id 索引通过 `WeakMap` 惰性创建，视图的语义/HAST 索引在渲染时按 document 重新建立，跨传输后可重建。
- 准备阶段克隆语义树，保护原始快照；同一解析快照可用不同 resolver/labels/policy 多次准备。
- 同步 parser 无法中途取消；`/preview` 提供防抖、请求身份、旧结果保留与过期结果丢弃，Worker 执行器复用宿主创建的 Worker 与同一协议。
- 编译器 API 是异步的，支持 `signal`；等待 provider 时可以取消，同步 parser 执行期间不能保证立即停止。大规模展开仍应由宿主放入 Worker。
- playground 保留自有 Worker 调度（解析一次、按选项多次准备），只复用公共编译、快照与图查询。
- AST 树默认展开两层，子节点仅在展开时渲染；搜索按需遍历。
- 预览只渲染支持的节点；未知节点降级为轻量源码卡片。
- 性能数据以 `pnpm bench` 输出为准，不在文档中维护固定数值；编译器与准备管线的阶段计时通过 `profile` 选项按实例采集，默认关闭，不共享模块状态。

## 9. 运行时与交付边界

- 浏览器优先；解析、归一化与 HAST 转换均不依赖 DOM，可在 Node 测试环境执行。
- React 兼容范围 18.2–19；ESM + CJS 双产物；CI 含 React 18 运行时 job 与 Node 20/22/24 解析矩阵。
- `wikiparser-node` 与 React 保持 external，因此只有它们是运行时依赖；unified、vfile、HAST 清洗与 JSX 工具及其传递依赖打包进库产物，作为开发依赖安装。CJS 产物强制按浏览器条件解析，不残留 `node:*` 内置模块引用。打包范围与原因见 `tsdown.config.ts`。
- parser 精确锁定单一版本，不提供兼容区间；浏览器加载后 `globalThis.Parser` 是单例，多版本并存会互相覆盖，当前不支持。`loadParser` 在模块执行后立即捕获。
- 根入口的 `Wikitext`、`/parse` 与 `/expand` 会加载 parser；`/view` 加载 React；`/ast`、`/hast`、`/unified` 与 `/configs` 既不加载 parser 也不加载 React。
- CodeMirror 与 Worker 只在 playground 中使用，不进入库核心。
- 交付物是 `dist/` 库产物；playground 不构建、不部署、不发布。
- 不内建 SSR/RSC 数据流：React 入口是客户端组件（产物带 `"use client"`），服务端渲染通过 `/parse` + `/hast` 预准备快照、再用 `/view` 恢复实现。
- npm 包由 `dist/` 与许可证文件组成；发布流程见 `.github/workflows/publish.yml`，合规要求见[开发约定](./development.md)。
