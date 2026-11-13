import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { flattenNodes, getTemplateParameters, isNodeType } from "@/ast";
import { WikitextFragment, WikitextView, useWikitextContext } from "@/view";
import type { WikitextTemplateComponentProps } from "@/view";
import { parse, prepare } from "../helpers/parse";

function TemplatePreview({ node }: WikitextTemplateComponentProps) {
  const { snapshot } = useWikitextContext();
  const [first] = getTemplateParameters(node);
  return (
    <span data-label={snapshot.meta.labels.templateNotExpanded}>
      <WikitextFragment nodes={first?.node.children ?? []} />
    </span>
  );
}

function WrappedPreview({ node }: WikitextTemplateComponentProps) {
  return <WikitextFragment nodes={node.children} className="custom-fragment" />;
}

function BlockPreview({ node }: WikitextTemplateComponentProps) {
  return <WikitextFragment nodes={node.children} mode="block" className="custom-block" />;
}

describe("WikitextFragment", () => {
  it("renders parameter nodes inside a custom component", () => {
    const html = renderToStaticMarkup(
      <WikitextView
        snapshot={prepare("{{T|[[A|nested]]}}")}
        semanticComponents={{ template: TemplatePreview }}
      />,
    );
    expect(html).toContain('data-label="Template not expanded"');
    expect(html).toContain('class="wikitext-link"');
    expect(html).toContain("nested");
  });

  it("requires a WikitextView context", () => {
    expect(() =>
      renderToStaticMarkup(<WikitextFragment nodes={parse("text").ast.children} />),
    ).toThrow(/WikitextView/u);
  });

  it("rejects nodes from another document", () => {
    const foreign = prepare("{{T|[[A]]}}");
    const foreignTemplate = flattenNodes(foreign.ast).find((node) => isNodeType(node, "template"));
    if (!foreignTemplate) {
      throw new Error("Expected the foreign document to contain a template.");
    }
    const templateNode = foreignTemplate;
    function CrossDocument() {
      return <WikitextFragment nodes={templateNode.children} />;
    }
    expect(() =>
      renderToStaticMarkup(
        <WikitextView
          snapshot={prepare("{{T|x}}")}
          semanticComponents={{ template: CrossDocument }}
        />,
      ),
    ).toThrow(/belong to the rendered document/u);
  });

  it("wraps inline content only when className is provided", () => {
    const html = renderToStaticMarkup(
      <WikitextView
        snapshot={prepare("{{T|x}}")}
        semanticComponents={{ template: WrappedPreview }}
      />,
    );
    expect(html).toContain('<span class="custom-fragment">');
  });

  it("wraps block fragments in the fragment container", () => {
    const html = renderToStaticMarkup(
      <WikitextView
        snapshot={prepare("{{T|x}}")}
        semanticComponents={{ template: BlockPreview }}
      />,
    );
    expect(html).toContain('<div class="wikitext-fragment custom-block">');
  });
});
