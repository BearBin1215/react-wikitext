import { decodeHTML } from "entities";
import { WikitextParseError } from "../ast/errors";
import { DEFAULT_MAX_DEPTH, DEFAULT_MAX_SYNTAX_NODES } from "../ast/limits";
import {
  type WikitextPrimitive,
  type WikitextRange,
  type WikitextSyntaxNode,
  type WikitextSyntaxRoot,
} from "../ast/model";
import { createPositionIndex, type PositionIndex } from "../ast/position";
import { extractAttributes, toSyntaxAttributes } from "./attributes";
import { type TokenLike } from "./loadParser";
import { resolveChildRange } from "./ranges";

const PROP_KEYS = [
  "name",
  "data",
  "level",
  "bold",
  "italic",
  "anon",
  "modifier",
  "closed",
  "closing",
  "selfClosing",
  "subtype",
  "extension",
] as const;

/** 构造源码语法树时使用的预算；缺省值用于直接调用构造器的场景。 */
interface BuildSyntaxLimits {
  /** 语法树节点数上限。 */
  readonly maxSyntaxNodes?: number;
  /** 语法树嵌套深度上限。 */
  readonly maxDepth?: number;
}

function isPrimitive(value: unknown): value is WikitextPrimitive {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function extractProps(token: TokenLike): Readonly<Record<string, WikitextPrimitive>> {
  const props: Record<string, WikitextPrimitive> = {};
  for (const key of PROP_KEYS) {
    const value = token[key];
    if (isPrimitive(value)) {
      props[key] = value;
    }
  }
  return props;
}

/**
 * 把上游 token 树转换为本包定义的源码语法树。
 * 浏览器 bundle 没有原生区间，需要按父节点文本顺序重建。
 * @param rootToken 上游解析器返回的根 token。
 * @param source 归一化后的源码。
 * @param limits 构造预算；缺省时使用共享默认值。
 */
export function buildSyntaxTree(
  rootToken: TokenLike,
  source: string,
  limits: BuildSyntaxLimits = {},
): WikitextSyntaxRoot {
  const maxSyntaxNodes = limits.maxSyntaxNodes ?? DEFAULT_MAX_SYNTAX_NODES;
  const maxDepth = limits.maxDepth ?? DEFAULT_MAX_DEPTH;
  const tokenRanges = new WeakMap<TokenLike, WikitextRange>();
  const positions: PositionIndex = createPositionIndex(source);
  let count = 0;

  const build = (
    token: TokenLike,
    parentStart: number,
    parentText: string,
    path: string,
    depth: number,
  ): WikitextSyntaxNode => {
    count++;
    if (count > maxSyntaxNodes) {
      throw new WikitextParseError(
        "SOURCE_TOO_COMPLEX",
        `Syntax node count exceeds the limit of ${maxSyntaxNodes}.`,
      );
    }
    if (depth > maxDepth) {
      throw new WikitextParseError(
        "SOURCE_TOO_COMPLEX",
        `Syntax nesting depth exceeds the limit of ${maxDepth}.`,
      );
    }

    const rawText = token.toString();
    const ownText = depth === 0 ? source : rawText;
    const range: WikitextRange = [parentStart, parentStart + ownText.length];
    tokenRanges.set(token, range);
    const position = positions.position(range);

    const children: WikitextSyntaxNode[] = [];
    let cursor = 0;
    const childTokens = token.childNodes ?? [];
    for (const [index, child] of childTokens.entries()) {
      const childPath = `${path}.${index}`;
      let searchCursor = cursor;
      const childText = child.toString();
      // `image-parameter` 的名称与值分属不同 token，且不带 `=`；
      // 参数以 `=` 开头时，子 token 的文本要从等号之后开始搜索。
      if (token.type === "image-parameter" && childText && cursor === 0) {
        const equals = parentText.indexOf("=");
        if (equals >= 0 && childText !== parentText) {
          searchCursor = equals + 1;
        }
      }
      const resolved = resolveChildRange(child, parentText, parentStart, {
        cursor: searchCursor,
        lastChild: index === childTokens.length - 1,
      });
      const startOffset = resolved.start - parentStart;
      const endOffset = resolved.end - parentStart;
      const childSource = ownText.slice(startOffset, endOffset);
      children.push(build(child, resolved.start, childSource, childPath, depth + 1));
      cursor = resolved.nextCursor;
    }

    const rawAttributes = extractAttributes(token, decodeHTML);
    const node: WikitextSyntaxNode = {
      id: path,
      type: token.type ?? "text",
      range,
      position,
      props: extractProps(token),
      attributes: toSyntaxAttributes(rawAttributes, tokenRanges, range),
      children,
    };
    return node;
  };

  const root = build(rootToken, 0, source, "0", 0) as WikitextSyntaxRoot;
  return root;
}
