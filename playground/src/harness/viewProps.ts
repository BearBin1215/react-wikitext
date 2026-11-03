import type { WikitextPrepareOptions } from "react-wikitext/hast";
import type { WikitextViewProps } from "react-wikitext/view";
import type { AstTreeLabels, NodeInspectorLabels } from "@pg/devtools";
import type { PlaygroundOptions } from "@pg/state/options";
import { inspectorLabels, treeLabels, viewLabels } from "@pg/ui/labels";
import {
  DEMO_HTML_COMPONENTS,
  DEMO_IMAGE_RESOLVER,
  DEMO_LINK_RESOLVER,
  DEMO_SEMANTIC_COMPONENTS,
  THROWING_SEMANTIC_COMPONENTS,
} from "./extensions";

type ViewProps = Omit<WikitextViewProps, "document">;

export function buildPrepareOptions(options: PlaygroundOptions): WikitextPrepareOptions {
  const labels = viewLabels(options.labelLanguage);
  return {
    ...(options.linkResolver ? { resolveLink: DEMO_LINK_RESOLVER } : {}),
    ...(options.imageResolver ? { resolveImage: DEMO_IMAGE_RESOLVER } : {}),
    ...(labels ? { labels } : {}),
    policy: { externalLinkTarget: options.externalLinkTarget },
    headingIdStrategy: options.headingIdStrategy,
  };
}

export function buildViewProps(options: PlaygroundOptions): ViewProps {
  const semanticComponents =
    options.componentsMode === "demo"
      ? DEMO_SEMANTIC_COMPONENTS
      : options.componentsMode === "throwing"
        ? THROWING_SEMANTIC_COMPONENTS
        : undefined;
  return {
    ...(semanticComponents ? { semanticComponents } : {}),
    ...(options.componentsMode === "demo" ? { components: DEMO_HTML_COMPONENTS } : {}),
    ...(options.lang === "none" ? {} : { lang: options.lang }),
    ...(options.dir === "none" ? {} : { dir: options.dir }),
    ...(options.headingIdStrategy === "instance" ? { idPrefix: options.headingIdPrefix } : {}),
  };
}

export function buildDevtoolsLabels(options: PlaygroundOptions): {
  tree?: Partial<AstTreeLabels>;
  inspector?: Partial<NodeInspectorLabels>;
} {
  return {
    tree: treeLabels(options.labelLanguage),
    inspector: inspectorLabels(options.labelLanguage),
  };
}
