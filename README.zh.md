# react-wikitext

[English](https://github.com/BearBin1215/react-wikitext/blob/main/README.md) | 简体中文 | [在线文档](https://react-wikitext.pages.dev/zh/)

用于渲染 wikitext 的 React 组件。

```text
parser → 源码语法树（可选）→ 强类型 wiki 语义 AST → HAST → React
```

## 特性

- **全流程强类型**：解析快照、语义归一化、HAST 与 React 视图分属独立入口，各阶段都可以单独使用、替换或序列化。
- **默认安全**：只输出 React 元素，不使用 `dangerouslySetInnerHTML`，最终清洗始终在插件之后执行。
- **不依赖外部服务**：运行时不依赖 Wikimedia、字体 CDN 或任何外部 API。
- **可注入解析器**：默认使用 `wikiparser-node`，也可以通过 `react-wikitext/ast` 的 `createWikitextParser` 注入自己的解析器实现。
- **可选模板展开**：解析前用宿主提供的模板表或获取回调展开受支持的模板与纯 wikitext 函数。
- **调试面板**：可选 `/devtools` 入口提供 `AstTree` 与 `NodeInspector`，用于检查解析快照或渲染快照。
- **按需加载**：库同时提供 ESM 与 CJS 产物、类型声明与子路径入口，宿主可以只加载需要的部分。

## 安装

```bash
pnpm add react-wikitext
```

React 是 peer dependency，要求 `>=18.2 <20`。页面样式需要显式引入一次：

```ts
import "react-wikitext/styles.css";
```

## 快速开始

根入口的 `Wikitext` 组件自行完成解析、准备与渲染，缺省使用默认解析器与默认配置：

```tsx
import { Wikitext } from "react-wikitext";
import "react-wikitext/styles.css";

export function Article() {
  return <Wikitext source={source} parseOptions={{ pageName: "Example" }} lang="zh-CN" />;
}
```

内部链接默认渲染为不可导航的文本，传入 `resolveLink` 即可接入路由。模板与文件在提供 resolver 之前按占位渲染。各语法的默认输出见文档[快速开始](https://react-wikitext.pages.dev/zh/guide/quick-start)与[语法支持](https://react-wikitext.pages.dev/zh/guide/syntax-support)。

## 显式管线

需要服务端预准备、Worker 解析、缓存或自定义插件时，改用显式管线：解析 → 准备 → 视图。

```tsx
import { createWikiparser } from "react-wikitext/parse";
import { prepareWikitext } from "react-wikitext/hast";
import { WikitextView } from "react-wikitext/view";
import "react-wikitext/styles.css";

const parser = createWikiparser();
const parsed = parser.parse(source, { pageName: "Example" });
const prepared = prepareWikitext(parsed);

export function Article() {
  return <WikitextView snapshot={prepared} lang="zh-CN" />;
}
```

准备好的文档可以序列化，因此准备阶段可以放在服务端或 Worker 中执行。见文档[工作原理](https://react-wikitext.pages.dev/zh/guide/concepts)与[服务端渲染](https://react-wikitext.pages.dev/zh/guide/server-rendering)。

## 模板展开

`createWikitextCompiler`（`react-wikitext/expand`）在解析前展开受支持的模板、模板参数与常用解析器函数。模板源码由 provider 提供：离线场景用 `createTemplateTableProvider`，远程场景实现自己的 `provider.open()` 批量获取。不调用它时，模板与解析器函数按占位渲染。见文档[模板展开](https://react-wikitext.pages.dev/zh/guide/templates)。

## 入口

| 子路径                        | 用途                                            |
| ----------------------------- | ----------------------------------------------- |
| `react-wikitext`              | 源码组件 `Wikitext` 与视图组件 `WikitextView`   |
| `react-wikitext/view`         | 只渲染已准备好的快照（不加载解析器）            |
| `react-wikitext/parse`        | 解析器与解析选项                                |
| `react-wikitext/ast`          | 语义模型、查询、序列化与自定义解析器            |
| `react-wikitext/hast`         | `prepareWikitext`、插件、resolver、策略与文案   |
| `react-wikitext/expand`       | 编译器、模板 provider 与展开类型                |
| `react-wikitext/preview`      | 基于宿主 executor 的防抖预览调度                |
| `react-wikitext/worker`       | 编译并准备的 worker handler                     |
| `react-wikitext/unified`      | 固定顺序的 unified 处理器，收尾清洗由库内部追加 |
| `react-wikitext/configs`      | 站点配置快照与覆盖构造器                        |
| `react-wikitext/devtools`     | AST 树、节点检查器与选择恢复辅助函数            |
| `react-wikitext/styles.css`   | 页面渲染样式                                    |
| `react-wikitext/tokens.css`   | 仅主题变量                                      |
| `react-wikitext/devtools.css` | 调试组件样式                                    |

根入口是主入口。服务端预准备、Worker 解析或只做渲染的宿主应当使用 `react-wikitext/view`，这个入口不会加载默认解析器。各子路径的公共类型与导出见文档[入口](https://react-wikitext.pages.dev/zh/api/)。

## 安全

- 不执行 wikitext 中的 HTML 与脚本，外部内容一律按不可信源码处理。
- 宿主提供的插件与 resolver 不能绕过最终的清洗阶段。
- 库自身不发起网络请求；图片只有在宿主 resolver 返回并通过校验的地址才会加载。

完整规则见文档[安全模型](https://react-wikitext.pages.dev/zh/guide/security)。

## 文档

- [在线文档](https://react-wikitext.pages.dev/zh/)覆盖工作原理、支持范围、服务端渲染、自定义与故障排查。
- [English documentation](https://react-wikitext.pages.dev/)
- 文档源码位于 `website/`，本地预览使用 `pnpm docs:dev`。
- 贡献指南见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 与 AI 协作

文档站随每次构建发布面向 LLM 的纯文本文件：

- [llms.txt](https://react-wikitext.pages.dev/zh/llms.txt)：索引文件，包含站内各页面的说明与链接
- [llms-full.txt](https://react-wikitext.pages.dev/zh/llms-full.txt)：合并了全部内容

引用单页时，在页面地址后追加 `.md` 即可获得该页的纯 Markdown 版本。英文站在 `/llms.txt` 与 `/llms-full.txt` 提供同样的文件。

## 许可证

本项目按 GPL-3.0-or-later 分发，第三方依赖的署名与许可文本见根目录的 `NOTICE` 与 `THIRD_PARTY_LICENSES`。
