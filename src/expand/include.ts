import type { WikitextRange, WikitextSyntaxNode, WikitextSyntaxRoot } from "../ast/model";
import { isOpaqueNode } from "./syntax";

type IncludeTagName = "noinclude" | "includeonly" | "onlyinclude";

interface IncludeTag {
  readonly name: IncludeTagName;
  readonly kind: "open" | "close" | "self";
  readonly range: WikitextRange;
}

const TAG_PATTERN = /^<(\/?)(noinclude|includeonly|onlyinclude)(?=[\s/>])/iu;

function findTagEnd(source: string, start: number): number {
  let quote: string | undefined;
  for (let index = start; index < source.length; index++) {
    const char = source[index]!;
    if (quote) {
      if (char === quote) {
        quote = undefined;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return index + 1;
    }
  }
  return -1;
}

function collectProtected(
  node: WikitextSyntaxNode | WikitextSyntaxRoot,
  ranges: WikitextRange[],
): void {
  if (node.type !== "root" && isOpaqueNode(node)) {
    ranges.push(node.range);
    return;
  }
  for (const child of node.children) {
    collectProtected(child, ranges);
  }
}

function scanTags(source: string, protectedRanges: readonly WikitextRange[]): IncludeTag[] {
  const tags: IncludeTag[] = [];
  let index = 0;
  let protectedIndex = 0;
  while (index < source.length) {
    while (
      protectedIndex < protectedRanges.length &&
      protectedRanges[protectedIndex]![1] <= index
    ) {
      protectedIndex++;
    }
    const protectedRange = protectedRanges[protectedIndex];
    if (protectedRange && protectedRange[0] <= index) {
      index = protectedRange[1];
      continue;
    }
    const next = source.indexOf("<", index);
    if (next < 0) {
      break;
    }
    index = next;
    if (protectedRange && protectedRange[0] <= index) {
      index = protectedRange[1];
      continue;
    }
    if (source.startsWith("<!--", index)) {
      const commentEnd = source.indexOf("-->", index + 4);
      index = commentEnd < 0 ? source.length : commentEnd + 3;
      continue;
    }
    const match = TAG_PATTERN.exec(source.slice(index, index + 64));
    const end = match ? findTagEnd(source, index) : -1;
    if (!match || end < 0) {
      index++;
      continue;
    }
    const text = source.slice(index, end);
    const name = match[2]!.toLowerCase() as IncludeTagName;
    const selfClosing = text.endsWith("/>");
    if (match[1] && selfClosing) {
      // `</noinclude/>` 不是合法闭合标签，原样保留并让开标签保持未闭合。
      index = end;
      continue;
    }
    const kind: IncludeTag["kind"] = match[1] ? "close" : selfClosing ? "self" : "open";
    tags.push({ name, kind, range: [index, end] });
    index = end;
  }
  return tags;
}

function noincludeDrops(tags: readonly IncludeTag[], sourceLength: number): WikitextRange[] {
  const queue: IncludeTag[] = [];
  const drops: WikitextRange[] = [];
  for (const tag of tags) {
    if (tag.name !== "noinclude") {
      continue;
    }
    if (tag.kind === "open") {
      queue.push(tag);
    } else if (tag.kind === "self") {
      drops.push(tag.range);
    } else if (queue.length > 0) {
      const open = queue.shift()!;
      drops.push([open.range[0], tag.range[1]]);
      // 被删除区间内的开标签属于原文内容，不再参与后续配对。
      while (queue.length > 0 && queue[0]!.range[0] < tag.range[1]) {
        queue.shift();
      }
    }
  }
  for (const open of queue) {
    drops.push([open.range[0], sourceLength]);
  }
  return drops;
}

function onlyincludeSegments(tags: readonly IncludeTag[]): WikitextRange[] {
  const list = tags.filter((tag) => tag.name === "onlyinclude");
  const segments: WikitextRange[] = [];
  let index = 0;
  while (index < list.length) {
    const open = list[index]!;
    if (open.kind !== "open") {
      index++;
      continue;
    }
    let closeIndex = index + 1;
    while (closeIndex < list.length && list[closeIndex]!.kind !== "close") {
      closeIndex++;
    }
    if (closeIndex >= list.length) {
      break;
    }
    const close = list[closeIndex]!;
    segments.push([open.range[1], close.range[0]]);
    index = closeIndex + 1;
  }
  return segments;
}

function removeRanges(
  source: string,
  start: number,
  end: number,
  ranges: readonly WikitextRange[],
): string {
  const clipped = ranges
    .filter(([rangeStart, rangeEnd]) => rangeEnd > start && rangeStart < end)
    .map(([rangeStart, rangeEnd]): WikitextRange => [
      Math.max(rangeStart, start),
      Math.min(rangeEnd, end),
    ])
    // oxlint-disable-next-line unicorn/no-array-sort -- 产物 target 为 ES2022，不使用 ES2023 的 toSorted。
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged: WikitextRange[] = [];
  for (const range of clipped) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1]) {
      if (range[1] > previous[1]) {
        merged[merged.length - 1] = [previous[0], range[1]];
      }
    } else {
      merged.push(range);
    }
  }
  let output = "";
  let cursor = start;
  for (const [rangeStart, rangeEnd] of merged) {
    if (rangeStart > cursor) {
      output += source.slice(cursor, rangeStart);
    }
    cursor = Math.max(cursor, rangeEnd);
  }
  return output + source.slice(cursor, end);
}

/**
 * 按模板嵌入模式过滤 include 标签：移除 noinclude 内容、去除 includeonly 标签，
 * 存在 onlyinclude 时只保留其片段。注释与原文扩展标签内的标签文本不参与识别。
 * @param source LF 归一化后的模板源码。
 * @param syntax 原始模板源码的语法树。
 */
export function filterTransclusionSource(source: string, syntax: WikitextSyntaxRoot): string {
  const protectedRanges: WikitextRange[] = [];
  collectProtected(syntax, protectedRanges);
  const tags = scanTags(source, protectedRanges);

  const drops = [
    ...noincludeDrops(tags, source.length),
    ...tags.filter((tag) => tag.name === "includeonly").map((tag) => tag.range),
  ];
  const segments = onlyincludeSegments(tags);
  if (segments.length > 0) {
    return segments
      .map(([start, end]) => {
        // 包住整个片段的 noinclude 不应删除 onlyinclude 选中的内容。
        const effective = drops.filter(
          ([dropStart, dropEnd]) => !(dropStart <= start && dropEnd >= end),
        );
        return removeRanges(source, start, end, effective);
      })
      .join("");
  }
  return removeRanges(source, 0, source.length, drops);
}
