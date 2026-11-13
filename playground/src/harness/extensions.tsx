import { getSourceText, type WikitextNode } from "react-wikitext/ast";
import type { WikitextImageResolver, WikitextLinkResolver } from "react-wikitext/hast";
import type {
  WikitextExtensionComponentProps,
  WikitextFileComponentProps,
  WikitextHtmlComponentProps,
  WikitextHtmlComponents,
  WikitextLinkComponentProps,
  WikitextReferenceComponentProps,
  WikitextSemanticComponents,
  WikitextTemplateComponentProps,
  WikitextUnknownComponentProps,
} from "react-wikitext/view";
import type { ReactNode } from "react";

function sourceOf(snapshot: WikitextTemplateComponentProps["snapshot"], node: WikitextNode) {
  const source = getSourceText(snapshot, node);
  return source.length > 120 ? `${source.slice(0, 120)}…` : source;
}

function DemoShell({
  kind,
  name,
  children,
  block = false,
}: {
  kind: string;
  name: string;
  children: ReactNode;
  block?: boolean;
}) {
  return (
    <span
      className={block ? "pg-ext pg-ext--block" : "pg-ext pg-ext--inline"}
      data-pg-component={kind}
    >
      <span className="pg-ext__label">自定义 {kind}</span>
      <span className="pg-ext__name">{name}</span>
      <span className="pg-ext__source">{children}</span>
    </span>
  );
}

function DemoTemplate({ snapshot, node, displayName }: WikitextTemplateComponentProps) {
  return (
    <DemoShell kind="Template" name={displayName} block>
      {sourceOf(snapshot, node)}
    </DemoShell>
  );
}

function DemoParserFunction({ snapshot, node, displayName }: WikitextTemplateComponentProps) {
  return (
    <DemoShell kind="ParserFunction" name={displayName}>
      {sourceOf(snapshot, node)}
    </DemoShell>
  );
}

function DemoFile({ snapshot, node, name }: WikitextFileComponentProps) {
  return (
    <DemoShell kind="File" name={name} block>
      {sourceOf(snapshot, node)}
    </DemoShell>
  );
}

function DemoReference({ snapshot, node, number }: WikitextReferenceComponentProps) {
  return (
    <DemoShell kind="Reference" name={`${node.name ?? node.type} #${number}`}>
      {sourceOf(snapshot, node)}
    </DemoShell>
  );
}

function DemoUnknown({ snapshot, node, parsedType, block }: WikitextUnknownComponentProps) {
  return (
    <DemoShell kind="Unknown" name={parsedType} block={block}>
      {sourceOf(snapshot, node)}
    </DemoShell>
  );
}

function DemoLink({ target, href, children }: WikitextLinkComponentProps) {
  return (
    <DemoShell kind="Link" name={target}>
      <a href={href}>{children}</a>
    </DemoShell>
  );
}

function DemoExtension({ snapshot, node, name, block }: WikitextExtensionComponentProps) {
  return (
    <DemoShell kind="Extension" name={name} block={block}>
      {sourceOf(snapshot, node)}
    </DemoShell>
  );
}

export const DEMO_SEMANTIC_COMPONENTS: WikitextSemanticComponents = {
  template: DemoTemplate,
  parserFunction: DemoParserFunction,
  file: DemoFile,
  reference: DemoReference,
  unknown: DemoUnknown,
  link: DemoLink,
  extension: DemoExtension,
};

function DemoImage({ src, alt }: WikitextHtmlComponentProps) {
  return (
    <span className="pg-ext pg-ext--inline" data-pg-component="Image">
      <span className="pg-ext__label">自定义 Image</span>
      <img src={src} alt={alt} />
    </span>
  );
}

export const DEMO_HTML_COMPONENTS: WikitextHtmlComponents = {
  img: DemoImage,
};

function ThrowingTemplate(_props: WikitextTemplateComponentProps): never {
  throw new Error("Playground：Template 自定义组件故意抛出异常，用于验证块级 Error Boundary。");
}

export const THROWING_SEMANTIC_COMPONENTS: WikitextSemanticComponents = {
  template: ThrowingTemplate,
};

export const DEMO_LINK_RESOLVER: WikitextLinkResolver = (request) => {
  if (request.kind !== "internal") {
    return undefined;
  }
  const target = (request.page ?? request.target).trim();
  if (!target) {
    return undefined;
  }
  return { href: `/wiki/${encodeURIComponent(target)}` };
};

export const DEMO_IMAGE_RESOLVER: WikitextImageResolver = (request) => ({
  src: new URL("/sample-image.svg", location.origin).href,
  alt: `本地示例图片：${request.name}`,
  width: request.width ?? 240,
  height: request.height ?? 144,
});
