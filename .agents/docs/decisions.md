# 设计决策

文档类型：决策记录（Informative）

用途：记录会影响未来改动的选择、理由、被否方案与风险。公共接口以[文档站 API 参考](../../website/docs/zh/api/index.mdx)为准，渲染行为以[渲染规范](./rendering-spec.md)为准，系统职责与边界见[总体架构](./architecture.md)；未完成事项见[路线图](./roadmap.md)。

## 1. 产品与运行时边界

**决策**：React 组件库，浏览器优先，ESM/CJS 双产物；不引入 UI 框架、CSS-in-JS、远程字体或后端。

**理由**：组件要嵌入宿主页面，样式、CSP 与运行时必须可控；纯前端可离线运行，不依赖 Wikimedia、CDN 或图片域名；ESM/CJS 同时覆盖现代打包器与 Node 使用方。

**约束**：不内建 SSR/RSC 数据流；React 入口以客户端组件形式发布（产物带 `"use client"`），服务端渲染由 `/parse` + `/hast` 预准备快照实现。库不主动请求远程资源，图片与内部链接导航由宿主 resolver 决定；分发遵循 GPL-3.0-or-later。

**被否方案**：Parsoid（需要服务端运行时）、`wtf_wikipedia`（抽取器而非忠实 AST）、自研 parser（成本不可接受）。

## 2. 语法树、语义 AST 与 HAST 分离

**决策**：采用 `parser → 源码语法树 → wiki 语义 AST → HAST → React`。源码语法树可选保留；语义 AST 是公共显示模型；HAST 是框架无关的 HTML 中间层。

**理由**：上游 token 形态与公共语义 API 解耦；段落、列表项、表格行与 HTML 配对在语义阶段形成，React 层不再扫描源码；HAST 能复用 rehype、`hast-util-sanitize` 与 JSX runtime，同时保持准备结果可序列化、可进入 Worker、可交给其他消费方；`/ast`、`/hast`、`/unified` 不依赖 React 与 parser，可分别测试与缓存。

**约束**：语义转换必须保留 `position` / `origin`，生成节点不伪造位置；实体只在语义转换时解码一次；不引入 mdast，也不声称任意 remark 插件可处理 wikitext。

**被否方案**：语法树直接转 HAST（显示与语义工具仍依赖上游 token）；先统一为 mdast（模板/参数/文件/扩展需要大量自定义节点，不能自然获得 remark 生态）。

## 3. 解析器与渲染入口解耦

**决策**：固定 `wikiparser-node@1.48.2` 浏览器 IIFE；默认适配器、IIFE 加载与配置快照只属于根入口的 `Wikitext`、`/parse` 与 `/expand`。只渲染已准备文档的宿主使用 `/view`，该入口不加载 parser。

**理由**：源码组件必须解析源码，放在根入口符合库的主用途；只渲染的宿主仍可通过 `/view` 避免全局 `Parser` 初始化；解析器接口与默认实现分离，自定义 adapter 可输出相同语法树而不加载 IIFE；配置在工厂创建时快照，避免每次解析隐式修改全局配置。

**约束**：精确锁定单一版本，不提供兼容区间，也不支持多版本并存或隔离加载；`loadParser` 在模块加载时捕获 `globalThis.Parser`，宿主页面已有同名全局会被覆盖，1.0 明确声明该全局污染限制；解析前统一 LF，不提供原源码 offset 映射；Node 完整版只用于 oracle；替换 parser 需要单独验证语法事实与 oracle 基线。

## 4. 强类型语义 AST 与来源

**决策**：使用判别联合与明确的节点族；`unknown` 表示除扩展标签外的未识别结构，原类型保存在 `parserType`。节点带 `id`、可选 `position` 与 `origin`；快照不保存 `flat`、Map 或父指针。

**理由**：消费方可按 `node.type` 窄化访问字段，减少断言与上游细节泄露；模板参数、文件说明作为真实子树，避免在同一内容上维护多份派生字段；惰性索引避免序列化重复整棵树，也允许 Worker/JSON 后重建；id 在插件复制/插入后重新分配，保证快照内唯一。

**约束**：id 不承诺跨编辑稳定，源码定位依赖 range/type 恢复；自定义节点需要同时扩展 `WikitextNodeMap` 与准备阶段 `handlers`；公开快照只读，运行时隔离依靠克隆工作树，而不只依靠 TypeScript `readonly`。

## 5. 分阶段 unified 插件

**决策**：`wikitextPlugins` 处理语义工作树，`rehypePlugins` 处理 HAST；同步与异步准备分开。`/unified` 只提供 `createWikitextProcessor`：它在内部按固定顺序拼装解析、语义插件、HAST 插件与最终清洗，宿主通过 `useWikitext` / `useHast` 分阶段注册插件。

**理由**：插件能读取和改写真实语义字段，同时保留原始解析快照；unified 是成熟处理流程，同步与异步返回类型不混用。单独导出 parse / rehype / finalize 插件时，运行时无法阻止插件排在最终清洗之后：后续插件返回新树会让快照与实际输出分叉，原地修改会把未清洗内容带进已完成的快照。把最终阶段收进处理器后，顺序由构造方式保证，而不是靠文档约定。

**约束**：同步准备遇到异步插件抛 `ASYNC_PLUGIN_IN_SYNC_PATH`，不静默忽略；插件后的语义树重新检查节点数与深度并重分配 id，查询缓存随之失效；`/unified` 不再导出 raw 插件，宿主无法把插件排在清洗之后；`toc` 只在准备设置中出现一次；处理器每次运行创建新的 VFile，运行之间不共享状态。

**被否方案**：保留三个公开 raw 插件并依赖调用方排序；在 finalize 上增加运行时标记来事后检测乱序（无法检测原地修改）；任意命名生命周期、隐藏全局插件或 middleware 注册表。

## 6. resolver 只返回数据

**决策**：链接 resolver 返回 `{ href?, label?, target? } | null | undefined`；图片 resolver 返回 `{ src, alt?, width?, height? } | null | undefined`。resolver 不返回 ReactNode。

**理由**：HAST 转换不依赖 React，准备结果可序列化、可进入 Worker、可交给其他渲染器；富 React label 通过 `semanticComponents.link` 覆盖，转换层只接收普通数据；三个 resolver 共用同一条空值规则：`undefined` 表示没有意见、交给默认行为，`null` 表示明确不处理（链接不生成导航，图片保持占位），对象表示自定义数据，避免依赖真假值推断。图片 resolver 接受 `undefined`，与链接 resolver 保持对称。

**约束**：`context.document` 是原始解析快照，`context.ast` 与 `context.node` 是本次工作树；resolver 返回的 URL 与插件写入的 URL 都经过最终验证；只有 resolver 返回并通过校验的图片 `src` 被授权，默认不启用插件图片。

## 7. 最终统一清洗与受控 policy

**决策**：在 rehype 插件之后统一使用 `hast-util-sanitize` + wiki schema；默认策略保持严格，允许通过 `policy` 扩展相对链接、相对图片、插件图片、额外标签、剥离标签与 class 模式。

**理由**：插件可能写入危险属性或资源，安全阶段必须在所有内容转换之后；不能直接用 GitHub 默认 schema，标签整对降级、URL 规范化、HTML 属性来源、占位语义与外链属性需要明确实现；policy 提供有意义的选项，但不提供无条件关闭清洗的开关。

**约束**：源码 HTML 的 `id`、`style`、事件属性不会原样输出；绝对 HTTP(S)/mailto 链接固定安全 `rel`，相对链接在 `_blank` 时补安全 token，`target` 只允许 `_blank`/`_self`；未授权图片被移除并产生诊断；自定义组件与插件属于可信程序，库不保证其输出的 HTML 仍符合白名单。

## 8. 标题实例隔离

**决策**：准备阶段生成逻辑标题锚点；视图在默认 `instance` 策略下追加实例前缀，`mediawiki` 保留裸锚点，`none` 不写 id。

**理由**：同一份准备结果可以安全用于多个视图，默认不会产生 DOM id 冲突；实例映射只处理受控 id、`#fragment` 链接与 `headers`，不运行插件或源码扫描；与 MediaWiki 裸锚点兼容作为显式选择保留。

**约束**：`mediawiki` 可能与其他实例或宿主冲突，需要调用方自行协调；切换 labels 或策略需要重新准备，但不需要重新解析。

## 9. 转换后预算与同步边界

**决策**：在解析预算之外，准备阶段对插件处理后的语义树再次执行固定节点数与深度上限；解析与准备保持同步，另提供异步准备。

**理由**：插件可能复制或生成大量节点，解析时的预算不能覆盖插件后的规模；React 渲染前必须完成转换，把异步调度留给调用方更可控。

**约束**：同步 parser 无法中途取消，Worker、防抖与过期结果丢弃由调用方/playground 实现；解析预算按选项合并后传给 adapter 构造，默认适配器据此提前停止，工厂仍校验返回树；上游 token 解析同步完成，预算不提供中途取消保证；准备预算与恢复渲染快照的 HAST 预算分别固定。

## 10. 工程与交付

**决策**：单仓“库 + playground”；tsdown 多入口构建；playground 内部使用，不交付。ESM-only unified/HAST 工具连同传递依赖打包进库产物，React 与 parser 保持 external。

**理由**：当前规模不需要 monorepo，playground 与库共享 fixtures、类型和测试工具；tsdown 能直接产出多入口 ESM/CJS 与声明文件，样式文件由构建复制；CJS 使用方不应在同步路径直接 `require()` ESM-only 包。

**约束**：playground 只通过 package 公共入口消费库，导入边界由静态测试与 consumer 隔离脚本检查；新增打包依赖必须同步 `inlinedDependencies` 与 `THIRD_PARTY_LICENSES`；库产物是唯一交付物。

## 11. 模板展开作为可选前置阶段

**决策**：提供独立的异步 `/expand` 阶段；模板源码由宿主的 `templates` 模板表或 `resolveTemplate` 获取回调提供，模板表优先。库在内部保留的语法树上求值，再把展开后的源码重新解析为 `WikitextDocument`。默认不启用；可恢复失败保留调用并记录诊断，最终解析失败退回原始快照，`strict` 模式整次抛错。

**理由**：展开结果仍然是 wikitext，只有重新解析，参数和函数生成的表格、标题、列表与链接才能进入正常语义阶段，避免在展开器里复制结构解析；默认不启用可以让不需要模板的宿主保持零成本；模板来源、站点配置和外部函数属于宿主环境，由宿主注入模板表或回调比库内抓取更可控；离线内容与预加载的模板集合直接传数据，省去查表回调与辅助函数，指南也不必把远程请求当作基本用法；每次调用复制模板表，使一次展开的结果不受调用期间修改影响，模板表优先让静态覆盖与按需获取可以混用；原始快照与展开快照分开保存，记录和诊断分别使用原始页面坐标与展开源码坐标，回退时可以完整恢复。

**约束**：只支持无站点依赖的纯 wikitext 子集；`#invoke`、站点状态函数、模板重定向与完整标题规范化不在库内实现；`templates` 按请求标题精确匹配，不匹配短标题、别名或省略 `Template:` 前缀的键，也不提供 `normalize` 选项，键由宿主整理；不增加跨调用缓存；循环检测使用模板调用栈，同一标题嵌套视为循环；嵌套调用复用所属顶层记录，不提供模板内部精确来源映射；不提供自定义函数 hook、展开组合快照序列化或独立 Node/构建期后端；同步 parser 执行期间不能保证立即取消；展开只在宿主的数据加载流程中完成，不提供 React 状态 API（`useExpandedWikitext`）或 `<Wikitext templates>`，`<WikitextView>` 仍只渲染准备好的快照——展开必须读取源码并重新解析，从快照取回源码重新运行会丢弃已有 AST、HAST 与准备结果。

**被否方案**：把展开放进 `/hast` 或 `/view` 隐式执行；在 View 上加载模板来源；公共 `createTemplateResolver` 工厂与标题 `normalize` 选项，把模板来源适配留在展开入口内部；用语义 AST 作为求值输入；在浏览器内打包上游 Node 版 `wikiparser-node` 的完整展开；内建 Lua、站点扩展或远程抓取；只提供 Node/构建期展开。

## 12. 渲染范围与非目标

**决策**：

- TOC 只做简单目录：`__TOC__` / `__NOTOC__` / `__FORCETOC__` 与基础层级展示，支持阈值、多列与关闭；不做目录定位或滚动联动。
- 引用按分组登记命名定义并在文末生成引用区；支持 `<references/>` 位置控制、组引用与注释回链。
- 分类在正文底部展示为列表。
- 复杂 `rowspan` / `colspan` 做版面计算，不只传递数值。
- 魔术链接只输出纯文本：`ISBN` / `RFC` / `PMID` 生成 `text` 节点，不生成外链；需要外链时由宿主在解析前预处理源码。
- 列表项只支持同行块级 HTML（`div`、`pre`、`table` 等），不支持多行块内容或 wikitext 表格。
- wikitext 嵌套表格降级为源码卡片。
- 扩展标签统一使用 `extension` 语义节点，包括没有专门默认展示的标签；未专门支持的标签保留名称、属性与内部原文，按块级或行内源码卡片展示。
- 默认输出的 DOM 结构尽量贴近 MediaWiki 1.43 的结构与 class，包括表格布局属性、引用编号、文件尺寸与位置、重定向结构与 HTML 标题锚点；具体 DOM 由[渲染规范](./rendering-spec.md)定义。源码 `id` 与事件属性丢弃；`style` 只保留安全子集的排版声明，非法声明产生诊断。
- 以下能力明确为非目标：行首空格 preformatted 语义、自定义展开函数 hook、嵌套来源映射、展开组合快照序列化、独立 Node/构建期展开后端、编辑器 SDK、大文档虚拟列表。

**理由**：优先覆盖常见阅读路径；目录交互、引用分组、嵌套表格解析和复杂表格布局的成本明显高于当前收益。扩展标签共用同一种节点形状，宿主可以用现成的语义组件按名称接管站点扩展标签，也避免同一类标签同时出现在 `extension` 与 `unknown` 中。

**约束**：没有 `<references/>` 时引用区位于正文末尾，分类列表位于引用区之后；表格版面计算需要独立的布局实现，不能只依赖 CSS；未专门支持的扩展标签不递归渲染内部节点，不承诺完整语义。

## 12.1 兼容基线与技术决定

- **预算超限**：维持整页失败（`SOURCE_TOO_COMPLEX`），不提供截断节点；宿主应使用 Worker 与明确的长度上限。理由是截断会伪造结构与来源，难以保证 1.x 的兼容性。
- **运行时基线**：产物 target 为 ES2022，依赖 `structuredClone`；Node 侧要求 `>=20.19`（下限来自 `wikiparser-node` 及其传递依赖，启用 `engine-strict` 时需 `>=22.13`），浏览器侧按现代常青浏览器作为基线。暂不提供 `structuredClone` fallback，因为快照格式要求保留 `undefined` 与普通对象语义。
- **parser 全局**：保留单一 IIFE 与 `globalThis.Parser` 捕获；不支持多版本并存或隔离加载，1.0 明确声明该限制。
- **`style`**：采用安全子集而非整体丢弃；非法声明逐条丢弃并产生诊断。

## 13. 已知风险

| 风险 | 缓解 |
| --- | --- |
| IIFE 被 tree-shake | 运行时读取锚点 + 浏览器 e2e + Vite consumer |
| parser 升级改变 token/API | 升级清单 + oracle + range/attr fixture + 默认配置同步测试 |
| CRLF/range 偏移 | 解析前归一化；语法树与 Node `json()` oracle 对比 |
| HTML/表格/列表 token 形态特殊 | 语义归一化 + 独立 fixture；嵌套表格明确降级 |
| 插件绕过安全阶段 | `createWikitextProcessor` 内部固定最终阶段 + 最终统一清洗 + 插件/图片授权测试 |
| 插件扩大树规模 | 转换后节点/深度预算 |
| 大文档阻塞输入 | 源码/节点上限 + playground Worker + 只展开可见树 |
| 多版本 parser 覆盖全局 | 导入后立即捕获 + 文档明确不支持并存 |
| 展开源码不可信 | 重新解析 + 现有语义清洗 + 不执行 HTML、不内建 Lua |
| 展开递归或结果膨胀 | 循环检测 + 深度、调用次数与长度预算 + Worker |
| 展开结果坐标错位 | `original` / `document` 双快照 + 记录范围 + 诊断映射 |
| ESM-only 工具在 CJS 失败 | 强制打包 + `isolate-ast/hast/unified.cjs` + 类型 consumer |
| CJS 产物取到 `node:*` 分支 | tsdown `inputOptions.platform = "browser"` + `check-cjs-externals.mjs` |
| 恢复快照被当作不可信输入 | 明确 policy/labels/authorizedImages 属于可信边界；文档与类型注释同源 |
| GPL 合规遗漏 | LICENSE/NOTICE/THIRD_PARTY_LICENSES + 发布前检查 |

## 14. 归一化位置、最终整理与状态归属

**决策**：

- 行内片段是判别联合：来自源码的片段必须同时提供 `text` 与 `start`，裁剪时同步前移起点；列表连接空格等合成文本走 `generated` 分支，不带 `origin/position`。
- 归一化只建一次源码行索引，列表按二分定位行与节点窗口；块级深度统一由 `NormalizeContext.maxDepth` 约束，超限抛 `SOURCE_TOO_COMPLEX`，不再静默截断或抛原生 `RangeError`。
- 文件参数的具名键只在 `ast/file-options` 定义一次，语法解析与语义派生共用；同义关键字统一后写覆盖。
- 最终 HAST 只有一个整理点：`toHast` 只产出语义属性与 `__TOC__` 占位，finalize 统一应用链接/图片 policy、引用 id、标题锚点与目录阈值。
- prepare 与 restore 共用同一组固定 HAST 预算，保证库产生的合法快照总能恢复。
- playground 只有一个状态来源：`session/usePlaygroundSession` + reducer 持有源码、选项、面板、树类型与选区；派生出的 doc、prepared、facts 与复现输入不存入 state；解析调度不持有输入源身份。

**理由**：这些问题的共同原因是“同一份数据有多个生成方”或“协议依赖隐含约定”。先修行为与数据来源，再讨论按职责拆分文件；文件长度本身不是拆分依据。

**约束**：生成节点不得伪造位置；`sanitize` 与 `rel`、`toc` 与 `references`、normalize 标签分类与 `stripTags` 保持分离，不合并成单一表。

## 15. 版本、快照与兼容策略

**决策**：

- 0.x 的破坏性变化进入新的次版本系列；1.x 的破坏性变化按 SemVer 处理。判别联合新增成员需要检查消费者的穷尽匹配。
- AST、syntax 与 render schema 独立维护；parser 升级必须执行快照与 oracle 回归，但不自动递增所有 schema。
- 1.x 接受同一主版本、schema 相同、来自可信边界的官方快照；未知 schema、其他主版本与第三方自造快照保持稳定拒绝。
- 渲染快照定位为可重建的缓存；重建优先用受支持的 AST，AST 不支持时重新解析原始源码。
- 公开 DOM 与样式承诺限定为根容器、基础语义、导航关系与稳定 class 集合；外观、内部包装节点与补格数量不纳入永久承诺。
- 不建设通用快照迁移框架；预发布历史不自动纳入 1.x 承诺。

**理由**：包版本、数据 schema 与 parser 版本回答不同问题，混为一谈会让缓存、恢复和升级决策互相牵连。把渲染快照视为缓存，可以在保持安全边界的同时允许重建；把公开 DOM 承诺限制在语义与稳定入口，可以避免把内部布局误当成对外承诺。

**约束**：恢复仍把 policy、labels 与 `authorizedImages` 当作可信输入；自定义语义节点与插件私有数据由宿主负责迁移。历史 fixture 只能由真正发布的产物生成，不能用当前源码重生成后覆盖。安全修复可以改变危险输入的 DOM。

## 16. 依赖、打包与解析器边界

**决策**：

- **IIFE 方案**：保留精确版本的 `wikiparser-node` npm 依赖与当前运行时读取锚点，本轮不 vendor。生产 consumer 的页面与 Worker 用压缩产物实际执行来验证；升级后如果这些验收失败且问题无法在现有方案内解决，再评估 vendor 或其他入口。
- **打包器支持范围**：正式支持并持续验收 Vite 与 webpack 5。其他打包器“可能可用”，但不承诺配置或兼容性；只有出现真实宿主需求、可复现问题和持续测试能力时才进入支持范围。
- **解析器替换**：本轮不替换 `wikiparser-node@1.48.2`，保留精确锁定、升级清单与 oracle。只有核心语法需求被上游能力阻塞，或性能、维护、加载风险无法在现有实现中解决时才重新选型；届时必须比较语法覆盖、range、许可证、包体积与迁移成本。
- **非默认 parser 接入**：官方流程是使用现有 adapter，并从 `/ast` 导入 `createWikitextParser`，避免通过 `/parse` 初始化默认 parser。文档说明 LF、UTF-16 range、position、属性、token 类型与嵌套规则，并明确 adapter 的语法子集不等同于完整 wikitext 支持。
- **模板与站点扩展接管**：使用现有分阶段接口，不增加注册中心或隐式求值：异步前置用 `/expand`，语义/HAST 阶段用插件与 handlers，视图阶段用 `semanticComponents.template` / `parserFunction` / `extension` / `reference`。`undefined` 回退内建转换，`null` 丢弃节点；自定义组件与插件属于可信边界。
- **文档中的用法分层**：指南分别演示展开、插件/handlers 与语义组件接管，说明优先级、回退与可信边界，避免把模板接管错写成 `extension`。

**理由**：这些边界直接影响构建、加载与安全；把它们写成可重新评估的决定，比在路线图保留没有截止条件的待办更清晰。浏览器执行验收比字符串检查更能证明压缩后仍可用。

**约束**：改变支持范围、parser 版本或打包策略需要附上可复现证据；新增打包器支持不能只凭一次本地成功。

## 17. 维护性重构的按需原则

以下事项不设待办，只在触发条件出现时重新评估：

- **扩展标签能力表**：新增或调整具体扩展标签时，按 raw / block / semantic / renderer 分列记录能力；不合并各阶段标签集合。`<references>` 位置控制已实现。
- **playground 跨树 range API**：出现语法树侧源码定位需求时再提供；语义树查询与选择恢复已覆盖常见场景。
- **view dispatch 与 `as never`**：新增组件映射或分派缺陷需要改动时，再改为可检查的类型边界；不按文件长度重构。
- **fragment 容器与样式**：保留透明布局容器与 `display: contents`；block 模式产生 `div` 但不提供外层盒子。需要 padding、border 或布局的宿主使用自己的容器。
- **handler 覆盖层**：正式保留覆盖内建类型的能力；`undefined` 回退，`null` 丢弃。只有出现“禁止覆盖内建转换”的宿主需求时才增加权限或覆盖层。
- **ExpansionEngine 拆分**：出现共享模板缓存、单次调用求值或新的函数扩展需求时，按具体责任拆分；本轮不添加自定义展开函数 hook。
- **标签结束扫描重复实现**：记录为局部维护规则，触及相关模块时再统一包含引号的结束扫描语义。

**理由**：这些事项目前没有需求支持；把它们记成触发条件可以避免“清空路线图”式的无收益重构，同时保留未来决策依据。

## 18. 补位格预算降级

**决策**：保留固定的 HAST 节点预算，不提高上限。最终 HAST 节点数超限时，在最终整理阶段省略语义 wiki 表格行末由库生成、完全为空且没有 `data` / `data-node-id` 的补位单元格；每张受影响表格记录一条 `TABLE_FILLER_BUDGET_EXCEEDED` 警告。普通表格、HTML 表格、插件写入或修改过的单元格不参与；省略后仍超限或深度超限时保持整页失败。

**理由**：补位格是库为逻辑网格生成的展示结构，不是作者内容；让一个稀疏表格阻断整篇文章，比让短行少一段尾部空白更差。该规则只在已经无法完整渲染时触发，未超限文档的 DOM 完全不变；恢复快照不会重新生成补位格，因此不需要 schema 迁移。继续提高预算只会推迟问题并扩大内存与拒绝服务面。

**被否方案**：提高 50,000 节点上限（无界放大仍在）；平时就不生成补位格（改变所有表格布局）；无条件省略全部补位格（无必要地改变普通文档）；提供公开开关（把产品取舍转嫁给宿主并扩大测试矩阵）。

**约束**：省略必须发生在安全清洗与最终整理之后、预算校验之前，只删除每行末尾连续的空补位格；同步准备、异步准备与 `/unified` 处理器共用同一实现。诊断码进入公开词表，HTML 表格的限制写入文档。补格数量不是永久 DOM 承诺，但省略行为是固定预算的一部分，不能由 prepare 选项关闭。

## 19. 公共 API 收敛（2026-11 审阅）

**决策**：

- `<Wikitext>` 增加 `onPrepared`；`onError` 只接收 `WikitextError`；`fallback` 是唯一接管口，提供后不再渲染内置错误容器。默认错误文案使用 `prepareOptions.labels.renderFailed`。
- 四个错误类保持子类结构，但作为同一份定义从根入口与功能入口导出；`WikitextPrepareError.stage` 与诊断共用 `WikitextStage`；`KnownWikitextDiagnosticCode` 公开导出。`severity` 定义为内容受损程度，不代表调用失败。
- 解析快照 `meta.limits` 记录实际生效预算，`WikitextParser.resolveOptions()` 暴露同一份值；预算必须是正整数。
- `MEDIAWIKI_CONFIG` 深冻结；新增 `createMediaWikiConfig` 做深层覆盖并返回校验后的副本。
- 运行时拒绝把渲染快照交给准备阶段、把解析快照交给视图。
- 两个序列化入口共用同一套诊断校验；恢复渲染快照时必须存在 `meta.limits`。
- 包新增 `./tokens.css` 子路径；`react-dom` 声明为可选 peer。
- `WikitextHastHandlers` 按 `WikitextNodeMap` 推导内建键的节点类型。

**理由**：审阅发现的共同问题是“同一事实有多个入口或没有出口”：插件顺序靠约定、诊断只存在于快照、生效预算不可读、配置常量可被就地修改。把顺序变成构造保证、把快照变成唯一事实来源、把生效值写进快照，可以消除这些隐式约定。

**约束**：`labels` 仍写入渲染快照，换文案需要重新准备；解析快照与渲染快照仍是两个类型，未引入 `kind` 判别字段；`document` 属性名未改。其余未实施方向见[路线图](./roadmap.md#3-api-审阅留下的方向)。

**被否方案**：只做改名而不改变入口模型；把 `labels` 移出快照（服务端与客户端需要各自提供同一份文案，与当前快照自洽性冲突）；把 `<Wikitext>` 改成默认异步（需要 React 19 的 `use()`，与当前 React 18.2 下限冲突）。

## 20. 类名与 CSS 变量前缀统一为 `wikitext-`（0.2.0）

**决策**：自有类名、CSS 变量与内部 data 标记的前缀从 `wtr-` 改为 `wikitext-`，即 `.wtr-view` → `.wikitext-view`、`--wtr-text` → `--wikitext-text`、`[data-wtr-theme="dark"]` → `[data-wikitext-theme="dark"]`、默认标题锚点前缀 `wtr-heading-` → `wikitext-heading-`。内部标记 `dataWtrToc` / `dataWtrReferences` 同步改为 `dataWikitextToc` / `dataWikitextReferences`。不保留旧前缀别名。

**理由**：`wtr` 是前身名 `wikitext-ast-renderer` 的首字母缩写；仓库早期 `README.md` 与 `.agents/docs/api.md` 曾把它当作包名和导入路径，`446c2cc` 统一措辞时只改了文字，标识符未同步。`wikitext-` 与包名核心词一致，读者不需要记第二套缩写，也不绑定 React，将来非 React 视图可以复用同一份样式。`rw-` 语义过载（read-write、rewrite、row），`rwt-` 与 `wtr-` 只差字母序、迁移期最容易肉眼混淆，`wt-` 过于通用，`wx-` 在中文语境与微信 API 冲突，均被否。类名是高度重复的固定字符串，gzip 后的长度代价可忽略。

**约束**：`wikitext-` 同时覆盖类名、CSS 变量与 data 属性，宿主覆盖变量和深色主题选择器需要一并改写。class 集合仍是公开 DOM 承诺的一部分，改名属于 0.x 次版本的破坏性变更；`mw-`、`catlinks`、`reference` 等 MediaWiki 兼容类名不变。内部 data 标记与 Parsoid 的 `data-wikitext` 共享词根，但完整名称不同，清洗仍以精确名单排除源码注入。

## 21. 调试组件作为独立 `/devtools` 入口

**决策**：将 playground 的 AST 调试树与节点检查器迁入 `src/devtools`，以 `react-wikitext/devtools` 与 `react-wikitext/devtools.css` 发布。公开 `AstTree`、`NodeInspector`、`AstTreeDocument`、`AstTreeKind`、`AstTreeNode`、选择恢复辅助函数、节点区间/源码查询与文案默认值。`AstTree` 接受解析快照或渲染快照；`NodeInspector` 删除未使用的 `tree` 属性；`AstTree` 的树类型属性命名为 `kind`，受控选中用 `string | null` 表示，非受控选中按树类型分别保存并在文档更新后按类型与区间恢复。

**理由**：调试面板已有真实实现，但只存在于 playground，消费方无法使用；直接导出内部名称会把 `Devtree` 一类实现术语带进公共 API。解析快照与渲染快照的结构足够接近，统一为 `AstTreeDocument` 后，两种快照都能检查。选择与展开状态在重新解析后会失效，公开按类型与 range 恢复的辅助函数，宿主不必复制 playground 的恢复逻辑。独立入口让 `/devtools` 只加载 React 与 `/ast`，根入口、`/view` 与 `/hast` 不增加依赖。

**被否方案**：从根入口或 `/view` 直接导出（把调试代码带进正式渲染入口）；只导出组件而不导出恢复辅助函数（消费方仍需复制内部逻辑）；在组件内部忽略受控属性（无法与编辑器或 URL 状态同步）。

**约束**：`/devtools` 不依赖 parser、`normalize`、`hast`、`unified` 或 `view`；构建产物 `/devtools` 带 `"use client"`。调试组件不进入正式渲染链，不运行插件、resolver 或清洗。节点 id 只在一份快照内唯一；语义树与源码语法树都使用路径式 id，跨树同名不代表同一个节点。选择恢复只按类型与区间匹配，生成节点没有区间时无法恢复。默认文案为英文，宿主通过 `labels` 覆盖。
