import type { TokenLike } from "./loadParser";

interface ResolvedRange {
  start: number;
  end: number;
  nextCursor: number;
}

function findOpeningTagClose(text: string): number {
  let quote: string | undefined;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === quote) {
        quote = undefined;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return index;
    }
  }
  return -1;
}

function anchorZeroLength(
  type: string,
  parentText: string,
  cursor: number,
  isLastChild = false,
): number {
  if (type === "heading-trail") {
    return parentText.length;
  }
  if (type === "html-attrs" || type === "ext-attrs") {
    if (parentText.endsWith("/>")) {
      return parentText.length - 2;
    }
    const close = findOpeningTagClose(parentText);
    if (close >= 0) {
      return close;
    }
  }
  if (type === "ext-inner") {
    const closingTag = parentText.lastIndexOf("</");
    if (closingTag >= 0) {
      return closingTag;
    }
    if (parentText.endsWith("/>")) {
      return parentText.length - 1;
    }
  }
  if (type === "attr-value") {
    const last = parentText[parentText.length - 1];
    return last === '"' || last === "'" ? parentText.length - 1 : parentText.length;
  }
  if (type === "text" && isLastChild) {
    return parentText.length;
  }
  return cursor;
}

interface ResolveChildRangeOptions {
  cursor: number;
  lastChild?: boolean;
}

/**
 * 在父节点文本中定位子 token 的区间。
 * 空文本子节点按零长度锚点规则处理，找不到文本时回退到游标位置。
 * @param child 子 token。
 * @param parentText 父节点文本。
 * @param parentStart 父节点在源码中的起始 offset。
 * @param options 当前游标与是否最后一个子节点。
 */
export function resolveChildRange(
  child: TokenLike,
  parentText: string,
  parentStart: number,
  { cursor, lastChild = false }: ResolveChildRangeOptions,
): ResolvedRange {
  const childText = child.toString();
  const type = child.type ?? "text";
  if (!childText) {
    const rel = anchorZeroLength(type, parentText, cursor, lastChild);
    return { start: parentStart + rel, end: parentStart + rel, nextCursor: cursor };
  }
  const found = parentText.indexOf(childText, cursor);
  if (found < 0) {
    return {
      start: parentStart + cursor,
      end: parentStart + cursor + childText.length,
      nextCursor: cursor + childText.length,
    };
  }
  return {
    start: parentStart + found,
    end: parentStart + found + childText.length,
    nextCursor: found + childText.length,
  };
}
