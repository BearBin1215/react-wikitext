# AI 协作文档

用 React 渲染 wikitext 的组件库，附带内部验收台。默认处理链为 parser → 源码语法树（可选）→ 强类型 wiki 语义 AST → HAST → React；另有可选的异步 `/expand` 前置阶段，在解析语义树前用宿主提供的模板表或获取回调展开受支持的模板与纯 wikitext 函数。库产物发布到 npm；playground 是内部验证工具，不构建、不部署、不进入产物。

## 文档索引

- 贡献入口与提交前检查：[`CONTRIBUTING.md`](CONTRIBUTING.md)
- 面向用户的 Rspress 文档站：`website/`，线上地址 <https://react-wikitext.pages.dev>；公共接口以 [`website/docs/zh/api/index.mdx`](website/docs/zh/api/index.mdx) 为准，中英文页面同步
- 内部文档入口、职责划分与阅读路径：[`.agents/docs/README.md`](.agents/docs/README.md)
- 系统边界、处理管线、模块依赖、数据模型、诊断、安全与性能：[`.agents/docs/architecture.md`](.agents/docs/architecture.md)
- 默认适配器、IIFE、配置快照、语法树/range/属性、预算与 oracle：[`.agents/docs/parser-integration.md`](.agents/docs/parser-integration.md)
- 语义归一化、HAST、链接/文件/引用/目录、表格、HTML 与清洗：[`.agents/docs/rendering-spec.md`](.agents/docs/rendering-spec.md)
- 配置文件无法表达的测试、验收与合规约定：[`.agents/docs/development.md`](.agents/docs/development.md)
- 设计选择、理由、被否方案与风险：[`.agents/docs/decisions.md`](.agents/docs/decisions.md)
- 未完成能力、开放问题与稳定限制索引：[`.agents/docs/roadmap.md`](.agents/docs/roadmap.md)

## 行为准则

- 修改代码时将目标上下文作为整体修改，不要只做局部修补；综合考虑全局，不要为了少改动而拒绝更优方案。
- 除非有明确要求，否则不要把既有实现视为绝对正确；发现更优方案时让用户决定，实践中发现错误时应当修改并告知用户。
- 发现修复成本较高、但发生概率极低的极端场景漏洞时，告知危害、产生条件和修复代价，不要擅自处理。
- 不确定的实施细节、使用场景规划，实施成本过高的非核心需求不要自行判断，让用户决定。
