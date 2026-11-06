# 开发约定

文档类型：实施约定（Normative）

适用范围：配置文件无法表达的开发、验收与合规约定。

命令、构建参数、CI 步骤与发布流程以配置文件为准：

- 命令、运行时范围与包入口：`package.json` 的 `scripts`、`engines`、`exports`、`files`、`packageManager`
- 构建与开发服务器：`tsdown.config.ts`、`vite.config.ts`、`vitest.config.ts`
- 流水线与发布：`.github/workflows/ci.yml`、`.github/workflows/publish.yml`、`bump.config.ts`、`changelogithub.config.ts`
- 静态检查：`.oxlintrc.json`、`.oxfmtrc.json`、`tsconfig.json`、`tsconfig.build.json`
- 验收实现：`tests/`、`playwright.consumer.config.ts`、`vitest.bench.config.ts`

本文只写这些文件里查不到的内容：改动时要遵守什么、报告怎么解读、验收结果如何判定。系统边界与模块依赖见[总体架构](./architecture.md)，parser 加载细节见[解析器接入](./parser-integration.md)，提交前清单见 [CONTRIBUTING](../../CONTRIBUTING.md)。

## 1. 环境与依赖

- 推荐 Node 24。工具链的 Node 版本下限由各开发依赖的 `engines` 决定，升级前逐项确认，不要只按某一个包的要求判断。库的 Node 支持基线写在 `package.json` 的 `engines`；`engine-strict` 下还要满足传递依赖 `@bhsd/stylelint-util` 的引擎要求。
- `pnpm-workspace.yaml` 的 `minimumReleaseAge` 会阻止安装发布不满一天的版本。升级工具链需要等待这段时间，紧急情况才临时加入排除项。
- 构建会回写 `package.json` 的 `exports` 与 `inlinedDependencies`。提交前确认这两个字段没有未提交的改动，也不要手工维护它们。

## 2. 构建与 playground

构建完成后按以下结果检查产物，检查范围与 `tests/consumer/` 保持一致：

- 各入口的 ESM/CJS、类型声明与 sourcemap 齐全，`styles.css` 与 `tokens.css` 随包发布。
- React 与 `wikiparser-node` 保持外部导入；ESM-only 的工具已打包进 CJS 产物，产物里不出现 `require("node:*")`。
- 子路径隔离成立：只渲染的入口不加载 parser，只解析的入口不加载 React；playground 的 AST 检查器不进入产物。
- 产物不含测试文件、原始源码目录或 `.test.` 文件。

playground 的约束：

- 只通过 package 公共入口消费库，`tests/playground/imports.test.ts` 检查这条边界。
- 解析与可选模板展开在 Web Worker 中执行；首次解析立即执行，后续输入防抖并丢弃过期结果；Worker 不可用时回退主线程。
- 语义树与语法树面板可以随时切换，因此解析始终开启 `retainSyntax`。
- playground 不构建、不部署、不进入 npm 包。

## 3. 代码与样式

- 库样式只定义 `.wtr-*` 与受控的 MediaWiki 兼容 class；playground 的布局样式只定义 `.pg-*`，可以在布局选择器中引用库类，但不重定义库样式。
- oxlint 不替代类型检查，两者都要通过。

## 4. 测试分工

`pnpm test` 运行 `tests/**/*.test.{ts,tsx}`，新增测试文件不需要更新本文。各目录的职责如下：

| 目录 | 覆盖 |
| --- | --- |
| `tests/parser/` | CRLF 归一化、配置快照、IIFE 捕获、adapter 协议与预算、属性提取、静态依赖边界与入口隔离 |
| `tests/api/` | 公共导出面，以及中英文状态页与 API 页的 schema、包版本一致性 |
| `tests/ast/` | 语义节点与顺序、路径 id、来源区间、预算、查询、序列化与扩展标签节点 |
| `tests/render/` | 视图与组件、标题锚点、列表、表格、HTML、模板与文件、引用、目录、分类、安全与清洗 |
| `tests/view/` | 模板参数、文件参数与 caption 派生 |
| `tests/pipeline/` | 准备阶段插件、工作树隔离、id 重分配、缓存失效、policy、图片授权、诊断与序列化恢复 |
| `tests/unified/` | unified 插件组合、VFile 状态、树替换、诊断阶段与高层准备的等价性 |
| `tests/expand/` | 展开语义、失败与回退、预算、取消、与准备阶段的集成、上游 oracle 对比 |
| `tests/components/`、`tests/playground/` | 组件行为，以及 playground 只能通过 package 公共入口导入 |
| `tests/oracle/` | 浏览器语法树与 Node 完整版的 range、稳定 fixture 的 `toHtml` 对比 |
| `tests/samples/` | 条目样本的 range 回归与安全渲染 |
| `tests/performance/` | 分阶段性能报告与报告校验 |

### 4.1 Oracle 与样本

- 浏览器语法树与 Node 完整版的 range 逐节点比较；`toHtml` 只比较结构稳定的 fixture，表格与列表不以它为规范真值。
- oracle 只在开发期使用，不进入运行时。失败时先确认是 parser 升级，还是语义或渲染回归。
- `tests/fixtures/samples/` 保存少量条目形态的静态样本，playground 通过 `import.meta.glob` 复用，不复制第二份正文；样本不随 npm 包发布。
- 一篇样本聚焦一类语法组合；新增语法点同步 `manifest.json` 并运行 `pnpm test tests/samples`。

### 4.2 Consumer 与浏览器验收

- 类型解析、Vite 与 webpack 生产构建、view-only 入口、压缩产物在页面与 Worker 中的实际执行分别验收。只检查构建产物里的字符串不足以证明 parser 可用。
- 浏览器用例会记录未捕获异常、console error 与资源加载失败，任一出现即失败；失败时保留 trace、截图与错误上下文。
- Node 矩阵只验证 dist 的 parse 与 expand 冒烟测试，不要求旧 Node 安装开发依赖。

### 4.3 性能报告

- `pnpm bench` 生成 `test-results/bench/report.json` 与 `summary.md`，随后校验报告。运行错误、缺少必测阶段或空报告直接失败。
- 耗时变化只进入摘要，不设固定门槛。共享 CI 只适合同环境相对比较；更换机器或依赖后应重新建立基线。
- 性能目标与规模策略见[总体架构](./architecture.md#8-性能与规模)。

## 5. CI 与发布约定

流水线步骤与 job 范围以 `.github/workflows/ci.yml` 和 `publish.yml` 为准。下面几条是这些文件里查不到的要求：

- oracle、e2e 与 consumer/a11y 的执行验收不能省略。
- playground 只运行开发态 e2e。

## 6. 合规

- 项目代码按 GPL-3.0-or-later 分发；`wikiparser-node` 通过 npm 依赖引入，不把上游代码复制进仓库，也不修改它。
- 打包进产物的第三方依赖及其许可证文本登记在 `NOTICE` 与 `THIRD_PARTY_LICENSES`。引入新的第三方代码或改变打包范围时，同步更新这两个文件。
