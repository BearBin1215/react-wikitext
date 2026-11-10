# react-wikitext

English | [简体中文](https://github.com/BearBin1215/react-wikitext/blob/main/README.zh.md) | [Document](https://react-wikitext.pages.dev/)

React components for rendering wikitext.

```text
parser → source syntax tree (optional) → typed wiki AST → HAST → React
```

## Features

- **Typed all the way**: parse snapshots, semantic normalization, HAST, and React views live on separate entry points. Every stage can be used, replaced, or serialized on its own.
- **Safe by default**: output is React elements only, never `dangerouslySetInnerHTML`. Final sanitization always runs after plugins.
- **No external services**: no dependency on Wikimedia, font CDNs, or any external API at runtime.
- **Pluggable parser**: uses `wikiparser-node` by default; inject your own implementation with `createWikitextParser` from `react-wikitext/ast`.
- **Optional template expansion**: expand supported templates and pure wikitext functions with a host `templates` table or `resolveTemplate` callback before parsing.
- **Debug panels**: inspect parse or render snapshots with `AstTree` and `NodeInspector` from the optional `/devtools` entry.
- **Load only what you need**: ESM and CJS builds, type declarations, and subpath entry points.

## Installation

```bash
pnpm add react-wikitext
```

React is a peer dependency, `>=18.2 <20`. Import the stylesheet once:

```ts
import "react-wikitext/styles.css";
```

## Quick start

The `Wikitext` component from the root entry handles parsing, preparation, and rendering with the default parser and configuration:

```tsx
import { Wikitext } from "react-wikitext";
import "react-wikitext/styles.css";

export function Article() {
  return <Wikitext source={source} parseOptions={{ pageName: "Example" }} lang="zh-CN" />;
}
```

Internal links are non-navigable text by default; pass `resolveLink` to connect your router. Templates and files render as placeholders until resolvers are provided. See [Quick Start](https://react-wikitext.pages.dev/guide/quick-start) and [Syntax support](https://react-wikitext.pages.dev/guide/syntax-support) for the default output of each construct.

## Explicit pipeline

For server-side preparation, worker parsing, caching, or custom plugins, use the explicit parse → prepare → view pipeline:

```tsx
import { createWikiparser } from "react-wikitext/parse";
import { prepareWikitext } from "react-wikitext/hast";
import { WikitextView } from "react-wikitext/view";
import "react-wikitext/styles.css";

const parser = createWikiparser();
const parsed = parser.parse(source, { pageName: "Example" });
const prepared = prepareWikitext(parsed);

export function Article() {
  return <WikitextView document={prepared} lang="zh-CN" />;
}
```

The prepared document is serializable, so preparation can run on the server or in a worker. See [How it works](https://react-wikitext.pages.dev/guide/concepts) and [Server rendering](https://react-wikitext.pages.dev/guide/server-rendering).

## Template expansion

`expandWikitext` (`react-wikitext/expand`) expands supported templates, template arguments, and common parser functions before parsing. Template source comes from a host-provided `templates` table or a `resolveTemplate` fetch callback; table entries win. Without it, templates and parser functions render as placeholders. See [Template expansion](https://react-wikitext.pages.dev/guide/templates).

## Entry points

| Entry point                   | Purpose                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `react-wikitext`              | Source component `Wikitext` and view component `WikitextView`                |
| `react-wikitext/view`         | Render a prepared document without loading a parser                          |
| `react-wikitext/parse`        | Parsers and parse options                                                    |
| `react-wikitext/ast`          | Semantic model, queries, serialization, and custom parsers                   |
| `react-wikitext/hast`         | `prepareWikitext`, plugins, resolvers, policies, and labels                  |
| `react-wikitext/expand`       | Template expansion                                                           |
| `react-wikitext/unified`      | Fixed-order unified processor with the final sanitize stage owned by the library |
| `react-wikitext/configs`      | Site configuration snapshot and override builder                             |
| `react-wikitext/devtools`     | AST tree, node inspector, and selection restore helpers                      |
| `react-wikitext/styles.css`   | Page rendering styles                                                        |
| `react-wikitext/tokens.css`   | Theme variables only                                                         |
| `react-wikitext/devtools.css` | Debug component styles                                                       |

The root entry is the main entry. Hosts that prepare documents on the server, parse in a worker, or only render should use `react-wikitext/view`, which does not load the default parser. See [Entry points](https://react-wikitext.pages.dev/api/) for the public types and exports of each subpath.

## Security

- HTML and scripts inside wikitext are never executed; external content is treated as untrusted source.
- Host-provided plugins and resolvers cannot bypass the final sanitization stage.
- The library makes no network requests; images load only from addresses returned by a host resolver and validated by the library.

See the [security model](https://react-wikitext.pages.dev/guide/security) for the full rules.

## Documentation

- [Documentation site](https://react-wikitext.pages.dev/) covers the pipeline, supported syntax, server rendering, customization, and troubleshooting.
- [中文文档](https://react-wikitext.pages.dev/zh/)
- Documentation source lives in `website/`; preview locally with `pnpm docs:dev`.
- Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md).

## Working with AI

The docs site publishes plain-text files for LLMs on every build:

- [llms.txt](https://react-wikitext.pages.dev/llms.txt): an index file with descriptions and links for every page
- [llms-full.txt](https://react-wikitext.pages.dev/llms-full.txt): the whole site content merged into a single file

When citing a single page, appending `.md` to its URL gives the plain-Markdown version of that page. The Chinese site publishes the same files at `/zh/llms.txt` and `/zh/llms-full.txt`.

## License

Distributed under GPL-3.0-or-later. Third-party attributions and license texts are in `NOTICE` and `THIRD_PARTY_LICENSES` at the repository root.
