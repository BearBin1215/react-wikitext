import type { Element, ElementContent, Text } from "hast";
import type { WikitextExtension, WikitextFile } from "../ast/model";
import { REFERENCE_GROUP_PROPERTY, REFERENCE_PLACEHOLDER_CLASS } from "./references";
import { sanitizeImageUrl } from "./sanitize";
import {
  element,
  mark,
  reportDegrade,
  sourceOf,
  textNode,
  unknownElement,
  type BuildContext,
} from "./primitives";

/**
 * 扩展标签的默认渲染。
 *
 * 每个标签都有明确的降级路径：不认识的标签输出源码卡片并记录
 * `EXTENSION_UNSUPPORTED`，不会把原始 HTML 直接交给浏览器。
 * @param context 转换上下文。
 * @param node 扩展标签节点。
 */
export function extensionElement(
  context: BuildContext,
  node: WikitextExtension,
): Element | Text | null {
  const raw = node.raw ?? "";
  switch (node.name) {
    case "references": {
      const group =
        node.attributes.find((attribute) => attribute.name === "group")?.value?.trim() ?? "";
      return element(
        "section",
        {
          className: [REFERENCE_PLACEHOLDER_CLASS],
          [REFERENCE_GROUP_PROPERTY]: group,
        },
        [],
        node,
      );
    }
    case "nowiki":
      // MediaWiki 1.43 的 nowiki 只输出纯文本，不生成包裹元素。
      return textNode(raw);
    case "pre":
      return element(
        "pre",
        { className: ["wikitext-ext-pre"], dataNodeId: node.id },
        [textNode(raw)],
        node,
      );
    case "syntaxhighlight": {
      const language =
        node.attributes.find((attribute) => attribute.name === "lang")?.value?.trim() ?? "";
      const safeLanguage = /^[A-Za-z0-9_-]+$/u.test(language) ? language.toLowerCase() : "";
      const classes = ["wikitext-ext-code", ...(safeLanguage ? [`language-${safeLanguage}`] : [])];
      return element(
        "pre",
        { className: classes, dataNodeId: node.id },
        [
          element("code", safeLanguage ? { className: [`language-${safeLanguage}`] } : {}, [
            textNode(raw),
          ]),
        ],
        node,
      );
    }
    case "poem": {
      const stanzas = raw
        .split(/\n[ \t]*\n/u)
        .map((stanza) => stanza.trim())
        .filter(Boolean);
      return element(
        "div",
        { className: ["wikitext-poem"], dataNodeId: node.id },
        stanzas.map((stanza) => {
          const children: ElementContent[] = [];
          for (const [index, line] of stanza.split("\n").entries()) {
            if (index > 0) {
              children.push(element("br", {}, []));
            }
            children.push(textNode(line));
          }
          return element("p", { className: ["wikitext-poem__stanza"] }, children);
        }),
        node,
      );
    }
    case "math":
      return element(
        "code",
        { className: ["wikitext-math"], dataNodeId: node.id, title: context.labels.unknownNode },
        [textNode(raw)],
        node,
      );
    case "gallery": {
      const lines = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      return element(
        "div",
        { className: ["wikitext-gallery"], dataNodeId: node.id },
        lines.map((line) => {
          const [file = "", ...rest] = line.split("|");
          const name = file.replace(/^(?:File|Image):/iu, "").trim();
          const caption = rest.join("|").trim();
          // gallery 行不是独立的 file 节点；给 resolver 一个等价的最小文件节点。
          const fileNode: WikitextFile = {
            type: "file",
            id: node.id,
            name,
            parameters: [],
            captionKind: "none",
            attributes: [],
            children: [],
            ...(node.origin ? { origin: node.origin } : {}),
          };
          const resolved = context.resolveImage?.(
            { name, parameters: [], caption },
            { document: context.document, ast: context.ast, node: fileNode },
          );
          const src = resolved?.src
            ? sanitizeImageUrl(resolved.src, { allowRelative: context.policy.allowRelativeImages })
            : null;
          if (src) {
            context.authorizedImages.add(src);
          }
          let media: ElementContent;
          if (src) {
            const image = element(
              "img",
              {
                className: ["wikitext-gallery__image"],
                src,
                alt: resolved?.alt ?? (caption || name),
              },
              [],
            );
            image.data = { wikitext: { ...mark(node).wikitext, imageSource: "resolver" } };
            media = image;
          } else {
            media = element("span", { className: ["wikitext-gallery__label"] }, [textNode(name)]);
          }
          return element(
            "figure",
            {
              className: [
                "wikitext-gallery__item",
                src ? "wikitext-gallery__item--media" : "wikitext-gallery__item--placeholder",
              ],
            },
            [
              media,
              ...(caption
                ? [
                    element("figcaption", { className: ["wikitext-gallery__caption"] }, [
                      textNode(caption),
                    ]),
                  ]
                : []),
            ],
          );
        }),
        node,
      );
    }
    default:
      reportDegrade(
        context,
        node,
        "EXTENSION_UNSUPPORTED",
        `Extension tag "${node.name}" has no default renderer and is shown as a source card.`,
      );
      return unknownElement(context, node, "ext", sourceOf(context, node), node.block);
  }
}
