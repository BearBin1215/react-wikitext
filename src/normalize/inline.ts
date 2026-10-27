import type {
  WikitextAttribute,
  WikitextNode,
  WikitextOrigin,
  WikitextSyntaxNode,
  WikitextTemplateParameter,
} from "../ast/model";
import type { NormalizeContext } from "./context";
import { nodeLocation } from "./context";
import {
  BLOCK_EXT_TAGS,
  classifyHtmlTag,
  htmlTagName,
  isClosingHtml,
  isSelfClosingHtml,
  trackBannedTag,
} from "./html";
import {
  childOfType,
  parseFileData,
  splitTarget,
  syntaxAttributes,
  syntaxRawDecoded,
  syntaxText,
  syntaxTextDecoded,
} from "./fields";
import { needsBlockNormalization } from "./block-policy";
import { decodeText } from "./text";

/** 合成文本的来源；合成片段不带 `origin/position`。 */
export type InlineGeneratedReason = "list-join";

/**
 * 行内片段：要么来自源码语法节点（可附带从源码截取的文本），要么是归一化生成的文本。
 * 附带文本时必须给出 `start`，否则区间的起止会对不上；生成片段不允许伪造位置。
 */
export type InlinePiece =
  | {
      readonly kind: "syntax";
      readonly syntax: WikitextSyntaxNode;
      /** 从 `syntax` 的源码中截取或改写的文本。 */
      readonly text: string;
      /** `text` 在源码中的起点。 */
      readonly start: number;
    }
  | { readonly kind: "syntax"; readonly syntax: WikitextSyntaxNode }
  | { readonly kind: "generated"; readonly text: string; readonly reason: InlineGeneratedReason };

interface InlineOptions {
  /** 去掉首个文本片段的前缀，例如 `caption=`。 */
  readonly trimStart?: number;
  /** 当前容器在块级树中的深度；容器内的块级回落从这里继续递增。 */
  readonly depth?: number;
  /** 当前容器内容的源码上界。 */
  readonly limit?: number;
}

type InlineBuilder = (
  nodes: readonly WikitextSyntaxNode[],
  options?: InlineOptions,
) => WikitextNode[];

/** 读取片段文本；只有整段语法节点没有文本时返回 undefined。 */
function pieceText(piece: InlinePiece): string | undefined {
  return "text" in piece ? piece.text : undefined;
}

export function piecesFromNodes(
  nodes: readonly WikitextSyntaxNode[],
  options: { textForTextNodes?: boolean } = {},
): InlinePiece[] {
  return nodes.map((node) =>
    options.textForTextNodes && node.type === "text"
      ? { kind: "syntax", syntax: node, text: syntaxText(node), start: node.range[0] }
      : { kind: "syntax", syntax: node },
  );
}

export function mergeOrigins(nodes: readonly WikitextNode[]): WikitextOrigin | undefined {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    if (!node.origin) {
      continue;
    }
    start = Math.min(start, node.origin.range[0]);
    end = Math.max(end, node.origin.range[1]);
  }
  return start <= end ? { range: [start, end] } : undefined;
}

function generatedLocation(
  context: NormalizeContext,
  children: readonly WikitextNode[],
): { position?: WikitextNode["position"]; origin?: WikitextOrigin } {
  const origin = mergeOrigins(children);
  return origin ? nodeLocation(context, { origin }) : {};
}

function makeText(
  context: NormalizeContext,
  value: string,
  syntax: WikitextSyntaxNode,
  range?: { readonly start: number; readonly end: number },
): WikitextNode {
  if (range) {
    const origin: WikitextOrigin = { syntaxId: syntax.id, range: [range.start, range.end] };
    return {
      type: "text",
      id: "",
      value,
      ...nodeLocation(context, { origin }),
    };
  }
  return {
    type: "text",
    id: "",
    value,
    ...nodeLocation(context, { syntax }),
  };
}

function textValue(raw: string): string {
  return decodeText(raw);
}

/** 追加来自源码的文本；区间由 `start` 与原始文本长度计算。 */
function appendSourceText(
  context: NormalizeContext,
  builder: InlineState,
  raw: string,
  syntax: WikitextSyntaxNode,
  start: number,
): void {
  const value = textValue(raw);
  if (value === "") {
    return;
  }
  builder.pending.push(makeText(context, value, syntax, { start, end: start + raw.length }));
}

/** 追加归一化生成的文本；不写 `origin/position`，避免指向无关源码。 */
function appendGeneratedText(builder: InlineState, raw: string): void {
  const value = textValue(raw);
  if (value === "") {
    return;
  }
  builder.pending.push({ type: "text", id: "", value });
}

interface HtmlFrame {
  readonly tag: string;
  readonly attributes: readonly WikitextAttribute[];
  readonly children: WikitextNode[];
  readonly syntax: WikitextSyntaxNode;
}

interface InlineState {
  readonly context: NormalizeContext;
  readonly inline: InlineBuilder;
  readonly depth: number;
  readonly limit: number;
  readonly root: WikitextNode[];
  readonly frames: HtmlFrame[];
  readonly banned: string[];
  pending: WikitextNode[];
  format: { bold: boolean; italic: boolean };
}

/** 去掉源码节点列表开头的字符前缀；用于 `caption=` 一类键前缀。 */
function trimSyntaxStart(
  nodes: readonly WikitextSyntaxNode[],
  trimStart: number,
): readonly WikitextSyntaxNode[] {
  let remaining = trimStart;
  const result: WikitextSyntaxNode[] = [];
  for (const node of nodes) {
    if (remaining <= 0 || node.type !== "text") {
      result.push(node);
      continue;
    }
    const text = typeof node.props.data === "string" ? node.props.data : "";
    if (remaining >= text.length) {
      remaining -= text.length;
      continue;
    }
    result.push({
      ...node,
      range: [node.range[0] + remaining, node.range[1]],
      props: { ...node.props, data: text.slice(remaining) },
    });
    remaining = 0;
  }
  return result;
}

/**
 * 构造 inline 容器的子节点：含块级结构时回落到块级归一化，
 * 否则继续按行内规则处理。模板参数、ref 内容、文件说明共用这条路径。
 */
function containerChildren(
  context: NormalizeContext,
  state: InlineState,
  nodes: readonly WikitextSyntaxNode[],
  trimStart = 0,
): WikitextNode[] {
  if (needsBlockNormalization(nodes)) {
    const prepared = trimStart > 0 ? trimSyntaxStart(nodes, trimStart) : nodes;
    const limit = prepared[prepared.length - 1]?.range[1] ?? state.limit;
    return context.buildBlocks(prepared, limit, state.depth + 1);
  }
  return state.inline(nodes, { trimStart });
}

function currentChildren(state: InlineState): WikitextNode[] {
  return state.frames.length > 0 ? state.frames[state.frames.length - 1]!.children : state.root;
}

function flushPending(state: InlineState): void {
  if (state.pending.length === 0) {
    return;
  }
  const content = state.pending;
  state.pending = [];
  const location = generatedLocation(state.context, content);
  let wrapped: WikitextNode;
  if (state.format.bold && state.format.italic) {
    wrapped = {
      type: "emphasis",
      id: "",
      ...location,
      children: [
        {
          type: "strong",
          id: "",
          ...location,
          children: content,
        },
      ],
    };
  } else if (state.format.bold) {
    wrapped = { type: "strong", id: "", ...location, children: content };
  } else if (state.format.italic) {
    wrapped = { type: "emphasis", id: "", ...location, children: content };
  } else {
    currentChildren(state).push(...content);
    return;
  }
  currentChildren(state).push(wrapped);
}

function appendFrame(state: InlineState, frame: HtmlFrame): void {
  const node: WikitextNode = {
    type: "htmlElement",
    id: "",
    tag: frame.tag,
    attributes: frame.attributes,
    selfClosing: false,
    block: false,
    children: frame.children,
    ...nodeLocation(state.context, { syntax: frame.syntax }),
  };
  currentChildren(state).push(node);
}

function handleQuote(state: InlineState, syntax: WikitextSyntaxNode): void {
  flushPending(state);
  if (syntax.props.bold === true) {
    state.format.bold = !state.format.bold;
  }
  if (syntax.props.italic === true) {
    state.format.italic = !state.format.italic;
  }
}

function handleHtml(state: InlineState, syntax: WikitextSyntaxNode): void {
  const tag = htmlTagName(syntax);
  const kind = classifyHtmlTag(tag);
  const closing = isClosingHtml(syntax);
  const selfClosing = isSelfClosingHtml(syntax);
  if (kind === "drop") {
    return;
  }
  if (kind === "banned") {
    if (closing) {
      trackBannedTag(state.banned, tag, true, selfClosing);
      return;
    }
    if (state.banned.length === 0) {
      flushPending(state);
      currentChildren(state).push({
        type: "htmlElement",
        id: "",
        tag,
        attributes: syntaxAttributes(syntax),
        selfClosing: true,
        block: false,
        blocked: true,
        children: [],
        ...nodeLocation(state.context, { syntax }),
      });
    }
    trackBannedTag(state.banned, tag, false, selfClosing);
    return;
  }
  if (state.banned.length > 0) {
    if (kind !== "unknown" && kind !== "block") {
      trackBannedTag(state.banned, tag, closing, selfClosing);
    }
    return;
  }
  if (kind === "void" || selfClosing) {
    flushPending(state);
    state.pending.push({
      type: "htmlElement",
      id: "",
      tag,
      attributes: syntaxAttributes(syntax),
      selfClosing: true,
      block: false,
      children: [],
      ...nodeLocation(state.context, { syntax }),
    });
    return;
  }
  if (kind === "inline") {
    if (closing) {
      flushPending(state);
      const index = state.frames.map((frame) => frame.tag).lastIndexOf(tag);
      if (index < 0) {
        return;
      }
      while (state.frames.length - 1 > index) {
        appendFrame(state, state.frames.pop()!);
      }
      appendFrame(state, state.frames.pop()!);
      return;
    }
    flushPending(state);
    state.frames.push({
      tag,
      attributes: syntaxAttributes(syntax),
      children: [],
      syntax,
    });
    return;
  }
  flushPending(state);
  state.pending.push({
    type: "unknown",
    id: "",
    parserType: "html",
    value: state.context.source.slice(syntax.range[0], syntax.range[1]),
    block: false,
    ...nodeLocation(state.context, { syntax }),
  });
}

function isEmptyLabel(nodes: readonly WikitextNode[]): boolean {
  return nodes.every((node) => node.type === "text" && node.value === "");
}

/** MediaWiki 的 pipe trick：`[[Page (context)|]]` 显示 Page，命名空间不进入标签。 */
function pipeTrickLabel(target: string): string | undefined {
  if (target.includes("#")) {
    return undefined;
  }
  const text = target.startsWith(":") ? target.slice(1) : target;
  const colon = text.indexOf(":");
  const page = text.slice(colon >= 0 ? colon + 1 : 0);
  const match = /^(.*?)(?:[ \t]+\([^()]*\)|[ \t]+（[^（）]*）|,[ \t][^,]*)$/u.exec(page);
  const label = match?.[1]?.trim();
  return label ? label : undefined;
}

function linkNode(
  context: NormalizeContext,
  syntax: WikitextSyntaxNode,
  state: InlineState,
): WikitextNode {
  const targetNode = childOfType(syntax, "link-target");
  const target = syntaxTextDecoded(targetNode ?? syntax).trim();
  const textNode = childOfType(syntax, "link-text");
  const rawLabel = textNode ? state.inline(textNode.children, { trimStart: 0 }) : undefined;
  let label: WikitextNode[];
  if (rawLabel && !isEmptyLabel(rawLabel)) {
    label = rawLabel;
  } else if (textNode) {
    const fallback = pipeTrickLabel(target) ?? target.replace(/^:/u, "");
    label = fallback ? [makeText(context, fallback, targetNode ?? syntax)] : [];
  } else {
    label = [makeText(context, target, targetNode ?? syntax)];
  }
  const { page, fragment } = splitTarget(target);
  return {
    type: "link",
    id: "",
    kind: "internal",
    target,
    ...(page === undefined ? {} : { page }),
    ...(fragment === undefined ? {} : { fragment }),
    children: label,
    ...nodeLocation(context, { syntax }),
  };
}

function externalLinkNode(
  context: NormalizeContext,
  syntax: WikitextSyntaxNode,
  state: InlineState,
): WikitextNode {
  const urlNode = childOfType(syntax, "ext-link-url");
  const textNode = childOfType(syntax, "ext-link-text");
  const target = syntaxTextDecoded(urlNode ?? syntax).trim();
  return {
    type: "link",
    id: "",
    kind: "external",
    target,
    children: textNode ? state.inline(textNode.children) : [],
    ...nodeLocation(context, { syntax }),
  };
}

function freeExternalLinkNode(context: NormalizeContext, syntax: WikitextSyntaxNode): WikitextNode {
  const target = syntaxTextDecoded(syntax).trim();
  return {
    type: "link",
    id: "",
    kind: "bareExternal",
    target,
    children: [makeText(context, target, syntax)],
    ...nodeLocation(context, { syntax }),
  };
}

function templateParameters(
  context: NormalizeContext,
  syntax: WikitextSyntaxNode,
  state: InlineState,
): WikitextTemplateParameter[] {
  const parameters: WikitextTemplateParameter[] = [];
  let anonymousIndex = 0;
  for (const child of syntax.children) {
    if (child.type !== "parameter") {
      continue;
    }
    const anonymous = child.props.anon === true;
    if (anonymous) {
      anonymousIndex++;
    }
    const value = childOfType(child, "parameter-value");
    parameters.push({
      type: "templateParameter",
      id: "",
      name: typeof child.props.name === "string" ? child.props.name : "",
      anonymous,
      ...(anonymous ? { index: anonymousIndex } : {}),
      children: value ? containerChildren(context, state, value.children) : [],
      ...nodeLocation(context, { syntax: child }),
    });
  }
  return parameters;
}

function templateNode(
  context: NormalizeContext,
  syntax: WikitextSyntaxNode,
  state: InlineState,
): WikitextNode {
  const name = typeof syntax.props.name === "string" ? syntax.props.name : "";
  return {
    type: "template",
    id: "",
    name,
    displayName: name.replace(/^(?:Template|File|Image|Category|Module):/iu, ""),
    children: templateParameters(context, syntax, state),
    ...nodeLocation(context, { syntax }),
  };
}

function parserFunctionNode(
  context: NormalizeContext,
  syntax: WikitextSyntaxNode,
  state: InlineState,
): WikitextNode {
  const name = typeof syntax.props.name === "string" ? syntax.props.name : "";
  return {
    type: "parserFunction",
    id: "",
    name,
    children: templateParameters(context, syntax, state),
    ...nodeLocation(context, { syntax }),
  };
}

function argumentNode(
  context: NormalizeContext,
  syntax: WikitextSyntaxNode,
  state: InlineState,
): WikitextNode {
  const name = syntaxTextDecoded(childOfType(syntax, "arg-name")).trim();
  const defaultValue = childOfType(syntax, "arg-default");
  return {
    type: "argument",
    id: "",
    name,
    children: defaultValue ? containerChildren(context, state, defaultValue.children) : [],
    ...nodeLocation(context, { syntax }),
  };
}

function fileNode(
  context: NormalizeContext,
  syntax: WikitextSyntaxNode,
  state: InlineState,
): WikitextNode {
  const data = parseFileData(context, syntax);
  const captionNodes = containerChildren(
    context,
    state,
    data.captionNodes,
    data.captionPrefixLength,
  );
  return {
    type: "file",
    id: "",
    name: data.name,
    parameters: data.parameters,
    captionKind: data.captionKind,
    attributes: syntaxAttributes(syntax),
    children: captionNodes,
    ...nodeLocation(context, { syntax }),
  };
}

function extensionInner(context: NormalizeContext, syntax: WikitextSyntaxNode): string {
  return syntaxRawDecoded(context, childOfType(syntax, "ext-inner"));
}

function referenceNode(
  context: NormalizeContext,
  syntax: WikitextSyntaxNode,
  state: InlineState,
): WikitextNode {
  const attributes = syntaxAttributes(syntax);
  const name = attributes.find((attribute) => attribute.name === "name")?.value ?? undefined;
  const group = attributes.find((attribute) => attribute.name === "group")?.value ?? undefined;
  const inner = childOfType(syntax, "ext-inner");
  return {
    type: "reference",
    id: "",
    ...(name === undefined ? {} : { name }),
    ...(group === undefined ? {} : { group }),
    attributes,
    raw: syntaxRawDecoded(context, inner),
    children: inner ? containerChildren(context, state, inner.children) : [],
    ...nodeLocation(context, { syntax }),
  };
}

function extensionNode(context: NormalizeContext, syntax: WikitextSyntaxNode): WikitextNode {
  const name = (typeof syntax.props.name === "string" ? syntax.props.name : "").toLowerCase();
  return {
    type: "extension",
    id: "",
    name,
    attributes: syntaxAttributes(syntax),
    selfClosing: isSelfClosingHtml(syntax),
    block: BLOCK_EXT_TAGS.has(name),
    raw: extensionInner(context, syntax),
    children: [],
    ...nodeLocation(context, { syntax }),
  };
}

function unknownNode(
  context: NormalizeContext,
  syntax: WikitextSyntaxNode,
  parserType: string,
): WikitextNode {
  return {
    type: "unknown",
    id: "",
    parserType,
    value: context.source.slice(syntax.range[0], syntax.range[1]),
    block: false,
    ...nodeLocation(context, { syntax }),
  };
}

function symbolNode(
  context: NormalizeContext,
  syntax: WikitextSyntaxNode,
): WikitextNode | undefined {
  switch (syntax.type) {
    case "category": {
      const target = typeof syntax.props.name === "string" ? syntax.props.name : "";
      const sortKey = syntaxTextDecoded(childOfType(syntax, "link-text")).trim();
      return {
        type: "category",
        id: "",
        target,
        ...(sortKey ? { sortKey } : {}),
        ...nodeLocation(context, { syntax }),
      };
    }
    case "double-underscore":
      return {
        type: "behaviorSwitch",
        id: "",
        name: typeof syntax.props.name === "string" ? syntax.props.name : "",
        ...nodeLocation(context, { syntax }),
      };
    case "comment":
      return {
        type: "comment",
        id: "",
        value: syntaxText(syntax),
        ...nodeLocation(context, { syntax }),
      };
    default:
      return undefined;
  }
}

function inlineConversion(
  context: NormalizeContext,
  syntax: WikitextSyntaxNode,
  state: InlineState,
): WikitextNode | undefined {
  switch (syntax.type) {
    case "link":
      return linkNode(context, syntax, state);
    case "ext-link":
      return externalLinkNode(context, syntax, state);
    case "free-ext-link":
      return freeExternalLinkNode(context, syntax);
    case "template":
      return templateNode(context, syntax, state);
    case "magic-word":
      return parserFunctionNode(context, syntax, state);
    case "arg":
      return argumentNode(context, syntax, state);
    case "file":
      return fileNode(context, syntax, state);
    case "ext": {
      const name = (typeof syntax.props.name === "string" ? syntax.props.name : "").toLowerCase();
      if (name === "ref") {
        return referenceNode(context, syntax, state);
      }
      return extensionNode(context, syntax);
    }
    case "magic-link": {
      const value = syntaxTextDecoded(syntax);
      return value ? makeText(context, value, syntax) : undefined;
    }
    case "category":
    case "double-underscore":
    case "comment":
      return symbolNode(context, syntax);
    case "text":
      return makeText(context, decodeText(syntaxText(syntax)), syntax, {
        start: syntax.range[0],
        end: syntax.range[1],
      });
    default:
      return unknownNode(context, syntax, syntax.type);
  }
}

export function normalizeInlinePieces(
  context: NormalizeContext,
  pieces: readonly InlinePiece[],
  options: Pick<InlineOptions, "depth" | "limit"> = {},
): WikitextNode[] {
  const depth = options.depth ?? 0;
  const limit = options.limit ?? context.source.length;
  const state: InlineState = {
    context,
    inline: (nodes, inlineOptions) =>
      normalizeInlineSyntax(context, nodes, { ...inlineOptions, depth, limit }),
    depth,
    limit,
    root: [],
    frames: [],
    banned: [],
    pending: [],
    format: { bold: false, italic: false },
  };

  for (const piece of pieces) {
    if (piece.kind === "generated") {
      appendGeneratedText(state, piece.text);
      continue;
    }
    const syntax = piece.syntax;
    if (state.banned.length > 0 && syntax.type !== "html") {
      continue;
    }
    if ("text" in piece) {
      appendSourceText(context, state, piece.text, syntax, piece.start);
      continue;
    }
    if (syntax.type === "quote") {
      handleQuote(state, syntax);
      continue;
    }
    if (syntax.type === "html") {
      handleHtml(state, syntax);
      continue;
    }
    const node = inlineConversion(context, syntax, state);
    if (node) {
      state.pending.push(node);
    }
  }

  flushPending(state);
  while (state.frames.length > 0) {
    appendFrame(state, state.frames.pop()!);
  }
  return state.root;
}

/** 判断片段是否包含会进入正文的内容；非文本片段视为有内容。 */
export function hasMeaningfulPieces(pieces: readonly InlinePiece[]): boolean {
  return pieces.some((piece) => {
    const text = pieceText(piece);
    return text === undefined || text.trim() !== "";
  });
}

/**
 * 去掉行内片段的边缘空白；保留块级 HTML 两侧空格时只裁剪需要的一端。
 * 裁剪带 `start` 的片段时同步前移起点，保证区间仍指向真实源码。
 */
export function trimInlinePieces(
  pieces: readonly InlinePiece[],
  options: { readonly start?: boolean; readonly end?: boolean } = {},
): InlinePiece[] {
  const trimStart = options.start ?? true;
  const trimEnd = options.end ?? true;
  const result = pieces.slice();
  if (trimStart) {
    while (result.length > 0) {
      const first = result[0]!;
      const text = pieceText(first);
      if (text === undefined || text.trim() !== "") {
        break;
      }
      result.shift();
    }
  }
  if (trimEnd) {
    while (result.length > 0) {
      const last = result[result.length - 1]!;
      const text = pieceText(last);
      if (text === undefined || text.trim() !== "") {
        break;
      }
      result.pop();
    }
  }
  const first = result[0];
  if (trimStart && first) {
    const text = pieceText(first);
    if (text !== undefined) {
      const trimmed = text.trimStart();
      const removed = text.length - trimmed.length;
      if (removed > 0 && first.kind === "syntax" && "text" in first) {
        result[0] = { ...first, text: trimmed, start: first.start + removed };
      }
    }
  }
  const last = result[result.length - 1];
  if (trimEnd && last) {
    const text = pieceText(last);
    if (text !== undefined) {
      const trimmed = text.trimEnd();
      if (trimmed.length !== text.length && last.kind === "syntax" && "text" in last) {
        result[result.length - 1] = { ...last, text: trimmed };
      }
    }
  }
  return result;
}

function applyTrimStart(pieces: readonly InlinePiece[], trimStart: number): InlinePiece[] {
  if (!trimStart) {
    return [...pieces];
  }
  let remaining = trimStart;
  const result: InlinePiece[] = [];
  for (const piece of pieces) {
    const text = pieceText(piece);
    if (text === undefined) {
      result.push(piece);
      continue;
    }
    if (remaining <= 0) {
      result.push(piece);
      continue;
    }
    const length = text.length;
    if (remaining >= length) {
      remaining -= length;
      continue;
    }
    if (piece.kind === "syntax" && "text" in piece) {
      result.push({ ...piece, text: text.slice(remaining), start: piece.start + remaining });
    } else if (piece.kind === "generated") {
      result.push({ ...piece, text: text.slice(remaining) });
    }
    remaining = 0;
  }
  return result;
}

/** 行内语法节点入口；`depth/limit` 用于容器内的块级回落。 */
export function normalizeInlineSyntax(
  context: NormalizeContext,
  nodes: readonly WikitextSyntaxNode[],
  options: InlineOptions = {},
): WikitextNode[] {
  const pieces = applyTrimStart(
    piecesFromNodes(nodes, { textForTextNodes: true }),
    options.trimStart ?? 0,
  );
  return normalizeInlinePieces(context, pieces, options);
}
