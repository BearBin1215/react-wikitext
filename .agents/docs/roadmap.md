# 路线图

文档类型：规划（Informative）

用途：记录尚未实现、未验证或仍待决策的事项，以及不会随开发推进消失的稳定限制；细节见对应文档。

## 1. 无障碍人工验收

- 自动检查已经接入：生产 consumer 宿主中的 axe（WCAG 2.1 A/AA）与键盘用例覆盖普通阅读、引用/目录、多实例、错误/占位以及显式深色主题。
- **WCAG 2.2 目标尺寸**：当前基线仍是 WCAG 2.1 A/AA，AST 树行高与 `+`/`−` 折叠控件约 16.8px，不满足 2.2 的 2.5.8（24×24）。迁移到 2.2 AA 时统一提高行高、折叠控件与缩进列宽度，并扩展 axe tags；选中状态已按 1.4.11 增加左侧强调条，不受该迁移影响。
- **屏幕阅读器抽查**：仍未执行。需要在同一宿主中记录工具、步骤与实际结果，重点核对引用结构、目录跳转和回链的可读名称；未记录前不能把默认视图无障碍验收写成全部通过。

## 2. 稳定限制

以下条目描述当前限制；CRLF 与展开来源、缓存等条目已在[整体改造](#5-实时预览与模板展开整体改造)中按实际能力更新。其余条目来自 parser 能力或项目边界，细节见对应文档。

| 限制 | 说明 | 详见 |
| --- | --- | --- |
| parser 精确锁定单一版本 | 不提供兼容区间，不支持多版本并存；升级即整体替换 | [解析器接入](./parser-integration.md#8-版本升级清单) |
| 浏览器包能力受限 | 无原生 range、lint、`toHtml()`、`json()`、`querySelectorAll()`；range 由适配器重建 | [解析器接入](./parser-integration.md#1-运行时事实) |
| 扁平 HTML token | HTML 以开/闭 token 表示；表格存在隐式表头行与 caption 特殊单元格 | [解析器接入](./parser-integration.md#42-关键-token-事实) |
| 一个 text token 跨多个段落 | 段落只能在语义层拆分 | [解析器接入](./parser-integration.md#42-关键-token-事实) |
| wikitext 嵌套表格不支持 | 整表降级为源码卡片；HTML `<table>` 嵌套可渲染 | [渲染规范](./rendering-spec.md#9-表格细节) |
| 100 KB 密集文本同步解析阻塞 | 需降低上限或放入 Worker | [总体架构](./architecture.md#8-性能与规模) |
| 同步准备不接受异步插件 | 需要异步时使用 `prepareWikitextAsync` | [文档站 prepare 页面](../../website/docs/zh/api/prepare.mdx) |
| 固定 HAST 预算 | prepare 与 restore 共用 50,000 节点 / 1,000 深度；语义表格超限时省略行末尾空补位格，HTML 表格的补位格不省略，仍可能整页失败 | [设计决策](./decisions.md#18-补位格预算降级) |
| 默认管线只占位 | 模板、解析器函数、文件与 Lua 不执行；`/expand` 编译器只执行已支持的纯 wikitext 子集 | [渲染规范](./rendering-spec.md#71-模板) |
| 模板来源版本固定 | 一次编译固定使用一个 provider 快照；同一快照对同一标题必须返回稳定内容，内容变化必须更换 `revision` | [文档站 expand 页面](../../website/docs/zh/api/expand.mdx) |
| 引用与目录能力有限 | 命名引用按 `(group, name)` 复用同一条目，`<references/>` 只控制对应分组的位置；引用内容不执行模板、Lua 或站点数据；目录不做滚动联动 | [引用](./rendering-spec.md#74-引用)、[目录](./rendering-spec.md#75-目录) |
| 行首空格按普通文本处理 | 不提供 preformatted 语义 | [设计决策](./decisions.md#12-渲染范围与非目标) |
| 不提供编辑器 SDK | CodeMirror 与 Worker 仅用于 playground | [设计决策](./decisions.md#12-渲染范围与非目标) |
| 不提供大文档虚拟列表 | 依赖解析/准备预算、宿主 Worker 与减少装饰/占位 DOM | [设计决策](./decisions.md#12-渲染范围与非目标) |
| playground 不交付 | 只用于内部验证，不构建、不部署、不发布 | [总体架构](./architecture.md#9-运行时与交付边界) |
| 渲染输入仍分散在快照与视图属性 | `labels` 写入快照，`idPrefix` 只在视图；服务端与客户端必须提供同一份渲染输入才能保证 hydration 一致 | [设计决策](./decisions.md#19-公共-api-收敛2026-11-审阅) |

## 3. API 审阅留下的方向

以下事项在 2026-11 审阅中被认为方向合理，但涉及产品边界或迁移面过大，本轮未实施：

- **入口网格**：按「是否加载解析器 × 是否加载 React」收敛成根入口、`/view`、`/core`、`/server` 四格；现有 `/ast`、`/hast`、`/parse`、`/expand`、`/configs` 继续保留。
- **`labels` 出快照**：改为 HAST 只记录文案键、视图按 `labelsFor()` 在渲染期解析；需要同时解决服务端与客户端的文案一致性。
- **默认异步 `<Wikitext>`**：`source` 接受 `Promise<string>` 需要 React 19 的 `use()` 与 Suspense 路径，当前 React 下限仍是 18.2。
- **导出清单生成**：由单一测试夹具生成 API 页与 README 的符号表，当前仍由 `tests/api/exports.test.ts` 手工固定主要运行时导出。

## 4. 调试组件改进

- **AST 搜索性能**：每次输入扫描整棵树，超大文档可能出现输入延迟。可评估防抖、增量匹配或结果数量提示；虚拟列表仍按稳定限制中的“不提供大文档虚拟列表”处理。

## 5. 实时预览与模板展开整体改造

状态：已实施（2026-11-12，收尾 2026-11-13）。来源图、编译快照、编译器与批量调度、视图来源属性、`/preview` 与 `/worker` 已落地；旧 `expandWikitext`、顶层-only 记录与 `document` 属性已移除。consumer 产物、生产浏览器、e2e、无障碍、预算与基准报告均已通过，基准已按编译与准备阶段拆分计时。playground 保留自有调度与 worker 协议，避免内部工具反向影响库本体。

本方案已替代 CRLF 无原文映射、仅顶层展开来源与单次调用缓存等限制，并新增公共预览调度与 Worker executor。实施方案保留在 `plans/` 以便复核，收尾检查通过后删除，规则并入架构、解析器接入、渲染规范与开发约定。
