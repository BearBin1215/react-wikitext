# 贡献指南

本项目用 React 渲染 wikitext。库产物由 tsdown 构建到 `dist/` 并发布到 npm；`playground/` 是内部验收台，只用于开发验证，不构建、不部署、不进入 npm 包。

## 环境

推荐使用 Node 24 与 `package.json` 固定的 pnpm 版本。工具链的 Node 版本下限由各开发依赖决定，升级依赖前先确认这些要求；运行时支持范围见 `package.json` 的 `engines`。

```bash
pnpm install
```

## 快速开始

| 命令 | 用途 |
| --- | --- |
| `pnpm play` | 以 `src/` 启动 playground |
| `pnpm test` | 运行 Vitest 全量测试 |
| `pnpm build` | 构建库产物到 `dist/` |
| `pnpm docs:dev` | 本地预览 Rspress 文档站 |
| `pnpm release` | 递增版本、提交、打 tag 并推送 |

全部命令列在 `package.json` 的 `scripts` 里。构建参数、测试分工、CI 步骤与发布流程以配置文件为准；配置文件无法表达的验收与合规约定见[开发约定](.agents/docs/development.md)。

## 文档

- 面向用户的文档站在 `website/`，线上地址 <https://react-wikitext.pages.dev>。中英文内容分别在 `website/docs/zh/` 与 `website/docs/en/`，新增页面时两边一起写。改动后运行 `pnpm docs:build`。
- 内部设计与开发文档在 `.agents/docs/`，入口见[文档索引](.agents/docs/README.md)。公共接口以[文档站 API 参考](website/docs/zh/api/index.mdx)为准，实际行为以 `src/` 与 `tests/` 为准。

## 提交前检查

- `pnpm format:check`、`pnpm lint`、`pnpm typecheck` 通过。
- `pnpm test` 通过。
- 改动 playground 时运行 `pnpm test:e2e`。
- 改动 `website/` 时运行 `pnpm docs:build`，确认页面与链接可构建。
- 改动构建、导出或依赖时运行 `pnpm test:consumer` 和 `pnpm build`，检查 dist 入口、类型、CSS 与子路径隔离。
- 改动渲染产物或样式时运行 `pnpm test:consumer:browser`；无障碍相关改动运行 `pnpm test:a11y`；表格布局或预算相关改动运行 `pnpm test:budget`。
- 性能相关改动运行 `pnpm bench`，确认 `test-results/bench/report.json` 与 `summary.md` 有效并记录同环境对比。
- 文档与行为同步；未完成事项只登记在[路线图](.agents/docs/roadmap.md)。
