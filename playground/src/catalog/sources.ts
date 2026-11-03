import sampleManifest from "../../../tests/fixtures/samples/manifest.json";

export type SourceGroup = "corpus" | "dev" | "boundary";

export interface SourceDefinition {
  readonly id: string;
  readonly group: SourceGroup;
  readonly title: string;
  readonly description: string;
  readonly source: string | (() => string);
  readonly transformSource?: (source: string) => string;
}

export const SOURCE_GROUPS: Record<SourceGroup, string> = {
  corpus: "测试语料",
  dev: "内置样例",
  boundary: "边界与性能",
};

interface SampleManifestEntry {
  readonly file: string;
  readonly title: string;
  readonly notes: string;
}

const sampleEntries = sampleManifest as readonly SampleManifestEntry[];

const sampleFiles = import.meta.glob("../../../tests/fixtures/samples/*.wikitext", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function sampleId(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.wikitext$/u, "");
}

const samples = new Map<string, string>();
for (const [path, source] of Object.entries(sampleFiles)) {
  samples.set(sampleId(path), source);
}

const corpusSources: SourceDefinition[] = sampleEntries.flatMap(({ file, title, notes }) => {
  const id = file.replace(/\.wikitext$/u, "");
  const source = samples.get(id);
  return source === undefined
    ? []
    : [{ id, group: "corpus" as const, title, description: notes, source }];
});

for (const [id, source] of samples) {
  if (!corpusSources.some((item) => item.id === id)) {
    corpusSources.push({
      id,
      group: "corpus",
      title: id,
      description: "未登记 manifest 的测试语料",
      source,
    });
  }
}

const BASIC_SOURCE = `== 示例条目 ==
'''React Wikitext''' 把 wikitext 解析成 AST，再逐节点渲染为 React 元素。

这段包含[[内部链接|链接文字]]、[https://example.com 安全外链]、''斜体'' 与 '''粗体'''。

* 列表项
* 第二项

{{Infobox|name=示例|type=demo}}
[[File:Example.png|thumb|300px|说明文字]]
<ref name="note">引用内容。</ref>
第二处引用<ref>按出现顺序编号，并汇总到文末引用区。</ref>
<references/>
`;

const HTML_SOURCE = `<div class="notice" title="白名单属性" id="dropped-id" style="color: red" onclick="alert(1)">
  <p>块级 HTML 内的 <b>加粗</b> 与 <span lang="zh" dir="ltr">行内标签</span>。</p>
  <br>
  <blockquote>引用块</blockquote>
</div>

<p>自闭合标签：<br /> 与未知标签 <custom-tag data-x="1">内容</custom-tag>。</p>

<dl>
  <dt>术语</dt>
  <dd>定义</dd>
</dl>
`;

const RESOLVERS_SOURCE = `== Resolver 示例 ==
内部链接默认是带 title 的普通文本，只有提供 resolveLink 后才会变成 <a>：
[[首页]]、[[帮助:目录|帮助页面]]。

图片默认占位，只有提供 resolveImage 后才会产生 <img loading="lazy">：
[[File:Local.png|thumb|本地示例图片]]

普通外链不受 resolver 影响：
[https://example.com 安全外链]
`;

/** `<tt>` 故意不闭合，只产生一个 unknown token，用于 Unknown 组件覆盖演示。 */
const COMPONENTS_SOURCE = `{{Infobox|name=示例|type=demo}}
{{#if:1|是|否}}
[[File:Example.png|thumb|300px|文件组件]]
<ref name="note">引用组件</ref>
<templatestyles src="x" />
ISBN 978-7-111-54286-8
<tt>未知标签
`;

const TEMPLATE_SOURCE = `== 模板展开 ==
开启“展开模板（示例模板表）”，比较展开前后的差异。

{{Demo/Box|name=示例}}
{{Demo/List|甲|乙}}
{{#if:1|条件为真|条件为假}}
{{Demo/Echo|带 {{!}} 分隔符}}
{{Demo/Missing|参数}}
{{Demo/Loop}}

前缀{{Demo/Broken}}后缀
`;

const RENDER_ERROR_SOURCE = `这段文字正常渲染。

{{Boom|reason=故意抛出异常}}

后续段落仍然渲染，说明块级 Error Boundary 只替换出错块。
`;

const SECURITY_SOURCE = `[https://example.com 安全外链] 与 [ftp://example.com 被拒绝的 FTP 链接]。

[//example.com 协议相对] 与 [mailto:test@example.com 邮件链接]。

<div id="clobber" style="color:red;position:fixed;background-image:url(https://example.com/pixel.png)" onclick="alert(1)" class="safe" title="保留 class/title">属性过滤</div>

<span lang="zh" dir="rtl" id="also-dropped">保留 lang/dir，丢弃 id。</span>
`;

const CRLF_SOURCE = `== CRLF 归一化 ==

这段源码在送入解析器前被转换成 CRLF。库会先归一化为 LF，因此 range、AST 树和编辑器选区仍然对齐。

第二个段落确认预览正常。
`;

const LIMITS_SOURCE = () =>
  `本场景默认把“源码上限”设为 800，触发 SOURCE_TOO_LONG；调整该值可观察恢复。\n\n${"超限内容 ".repeat(400)}`;

const LARGE_SOURCE = () =>
  `== 大文档 ==\n\n${"这是一段用于观察解析耗时的合成文本。\n\n".repeat(2_500)}`;

const DEV_SOURCES: readonly SourceDefinition[] = [
  {
    id: "basic",
    group: "dev",
    title: "基础样例",
    description: "标题、段落、行内、列表、模板、文件与引用的短样例。",
    source: BASIC_SOURCE,
  },
  {
    id: "html",
    group: "dev",
    title: "HTML 白名单",
    description: "行内与块级 HTML、属性白名单、危险属性丢弃与未知标签降级。",
    source: HTML_SOURCE,
  },
  {
    id: "resolvers",
    group: "dev",
    title: "Resolver 样例",
    description: "开启链接/图片 resolver 后，观察内部链接和图片从占位变成真实元素。",
    source: RESOLVERS_SOURCE,
  },
  {
    id: "components",
    group: "dev",
    title: "自定义组件样例",
    description:
      "场景默认使用演示组件，观察 Template、ParserFunction、File、Reference、Extension 与 Unknown 覆盖；切回“无”可查看默认占位。",
    source: COMPONENTS_SOURCE,
  },
  {
    id: "templates",
    group: "dev",
    title: "模板展开",
    description:
      "场景默认开启“展开模板（示例模板表）”，观察模板、函数与参数；再开启“模拟最终解析失败”观察整体回退。",
    source: TEMPLATE_SOURCE,
  },
  {
    id: "render-error",
    group: "dev",
    title: "渲染错误边界",
    description: "场景默认使用抛错组件，验证块级错误边界与源码卡片；切回“无”可恢复默认占位。",
    source: RENDER_ERROR_SOURCE,
  },
  {
    id: "freeform",
    group: "dev",
    title: "空白编辑器",
    description: "从空源码开始，适合粘贴外部 wikitext 做临时复现。",
    source: "",
  },
];

const BOUNDARY_SOURCES: readonly SourceDefinition[] = [
  {
    id: "security",
    group: "boundary",
    title: "安全拦截",
    description:
      "被拒绝的 FTP 外链、协议相对链接归一化，style 白名单保留，以及危险声明、事件属性与 id 的过滤。",
    source: SECURITY_SOURCE,
  },
  {
    id: "crlf",
    group: "boundary",
    title: "CRLF 归一化",
    description: "解析前把 LF 源码转换成 CRLF，验证库的归一化、range 与选区对齐。",
    source: CRLF_SOURCE,
    transformSource: (text) => text.replace(/\n/gu, "\r\n"),
  },
  {
    id: "limits",
    group: "boundary",
    title: "解析上限",
    description: "源码约 2 KB；场景默认把“源码上限”设为 800，触发 SOURCE_TOO_LONG。",
    source: LIMITS_SOURCE,
  },
  {
    id: "large",
    group: "boundary",
    title: "大文档",
    description: "约 50 KB 合成文本，用于观察 Worker 解析耗时与编辑响应。",
    source: LARGE_SOURCE,
  },
];

export const SOURCES: readonly SourceDefinition[] = [
  ...corpusSources,
  ...DEV_SOURCES,
  ...BOUNDARY_SOURCES,
];

export const DEFAULT_SOURCE_ID = "basic";

/** 读取输入源的初始文本；函数形式用于生成大文档。 */
export function sourceText(source: SourceDefinition): string {
  return typeof source.source === "function" ? source.source() : source.source;
}
