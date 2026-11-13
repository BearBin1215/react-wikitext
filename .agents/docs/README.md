# React Wikitext 开发文档

用 React 渲染 wikitext 的组件库，附带内部验收台。库产物构建到 `dist/` 并发布到 npm；playground 只用于内部验证，不构建、不部署、不进入 npm 包。

本目录面向维护者与 agent，不随包发布。消费方文档是根目录的 [README](../../README.md) 与[文档站](../../website/docs/zh/)，贡献者入口是 [CONTRIBUTING](../../CONTRIBUTING.md)。

## 文档职责

| 文档 | 回答的问题 | 读者 |
| --- | --- | --- |
| [文档站 API 参考](../../website/docs/zh/api/index.mdx) | 导出了什么，类型、选项、默认值与错误码是什么 | 使用者、维护者 |
| [总体架构](./architecture.md) | 系统边界、处理管线、模块依赖、安全与性能约束 | 维护者 |
| [渲染规范](./rendering-spec.md) | 语义结构如何转换为 HAST 与 DOM，各结构如何展示 | 渲染层维护者 |
| [解析器接入](./parser-integration.md) | 上游解析器如何加载，range 与属性如何重建，升级时检查什么 | 解析层维护者 |
| [开发约定](./development.md) | 配置文件无法表达的验收、测试与合规约定 | 贡献者、发布者 |
| [设计决策](./decisions.md) | 为什么这样设计，哪些方案被否决，有哪些已知风险 | 维护者 |
| [路线图](./roadmap.md) | 还有哪些未完成能力与稳定限制 | 维护者、使用者 |
| [实时预览整体改造实施方案](./plans/2026-11-12-realtime-preview-implementation.md) | 已授权改造的目标形态、实施顺序与验收条件；完成后归入规范并删除 | 改造实施者 |

文档站的中英文页面一一对应。改动公共导出时，同步更新两边的 API 页面与 `tests/api/exports.test.ts` 的导出面。

单一来源规则：

- 公共接口（导出、类型、选项、默认值、错误码）以文档站 API 参考与 `src/` 为准，内部文档不复述接口清单。
- 命令、构建参数、CI 步骤与发布流程以配置文件为准；[开发约定](./development.md)只写脚本里查不到的内容，[CONTRIBUTING](../../CONTRIBUTING.md) 只保留贡献入口与提交前清单。
- 渲染行为与 DOM 结构只写在[渲染规范](./rendering-spec.md)；架构文档只说明阶段职责。
- 未完成能力只登记在[路线图](./roadmap.md)；[设计决策](./decisions.md) 记录原因、被否方案、风险与已采纳的能力边界。
- 实际行为以 `src/` 与 `tests/` 为准，文档中的代码片段只用于说明结构。

## 推荐阅读路径

- 初次接手：[总体架构](./architecture.md) → [开发约定](./development.md) → [文档站 API 参考](../../website/docs/zh/api/index.mdx)。
- 修改显示行为：先读[渲染规范](./rendering-spec.md)，再查文档站 API 参考中的组件、resolver 与 policy。
- 修改解析或升级 `wikiparser-node`：读[解析器接入](./parser-integration.md)，按版本升级清单执行。
- 接入 unified 或自定义 HAST 处理：读文档站的 [unified](../../website/docs/zh/api/unified.mdx) 页面；最终安全阶段只能由库完成。
- 需要在渲染前展开模板或部分解析器函数：读文档站的 [expand](../../website/docs/zh/api/expand.mdx) 页面。
- 需要查看解析结果或节点详情：读文档站的 [devtools](../../website/docs/zh/api/devtools.mdx) 页面。
- 查“为什么这样做”：[设计决策](./decisions.md)；查“还不能做什么”：[路线图](./roadmap.md)。
- 实施实时预览与模板展开整体改造：先读[实施方案](./plans/2026-11-12-realtime-preview-implementation.md)，当前待实施状态由[路线图](./roadmap.md#5-实时预览与模板展开整体改造)登记。

## 文档约定

- 只写“当前怎么做”和“如何验收”。已完成的一次性方案不保留：结论写入规范与决策，过程留在提交记录。
- 不维护容易漂移的完整测试清单、固定性能数值、重复的能力表，也不复述配置文件里的步骤；测试以 `tests/` 为准，数值以 `pnpm bench` 输出为准。
- 规范文档不写 TODO；未完成事项只进[路线图](./roadmap.md)。
- 决策记录不复述代码或实施文档已经表达的现状。
