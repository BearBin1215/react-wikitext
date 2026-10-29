/* oxlint-disable no-await-in-loop -- 求值必须按源码顺序串行，不能并行。 */
import { decodeHTML } from "entities";
import { WikitextExpandError, type WikitextExpandErrorCode } from "../ast/errors";
import type {
  WikitextDocument,
  WikitextPosition,
  WikitextRange,
  WikitextSyntaxNode,
  WikitextSyntaxRoot,
} from "../ast/model";
import type { WikitextParseOptions, WikitextParser } from "../ast/parser";
import { createPositionIndex, type PositionIndex } from "../ast/position";
import {
  evaluateExpression,
  pad,
  substring,
  tagOutput,
  titleParts,
  urlDecode,
  urlEncode,
} from "./functions";
import { filterTransclusionSource } from "./include";
import type { ResolvedExpandOptions } from "./options";
import { findChild, isCallNode, isOpaqueNode, sourceText, stripRawExtensions } from "./syntax";
import type {
  WikitextExpansionDiagnostic,
  WikitextExpansionInfo,
  WikitextExpansionKind,
  WikitextExpansionRecord,
  WikitextExpansionRecordStatus,
  WikitextExpansionStatus,
  WikitextTemplateRequest,
} from "./types";

/** 强制保留语法树的解析结果；展开阶段内部使用，避免反复断言 `syntax`。 */
export interface ParsedDocumentWithSyntax extends WikitextDocument {
  readonly syntax: WikitextSyntaxRoot;
}

/** 单次顶层调用的可变记录；展开结束后换算成公开记录。 */
interface MutableExpansionRecord {
  readonly kind: WikitextExpansionKind;
  name: string;
  readonly originalRange: WikitextRange;
  readonly syntaxId?: string;
  status: WikitextExpansionRecordStatus;
  expandedRange?: WikitextRange;
}

interface RecordMark {
  readonly record: MutableExpansionRecord;
  readonly start: number;
  readonly end: number;
}

interface ArgumentSlot {
  readonly node: WikitextSyntaxNode;
  readonly frame: Frame;
  readonly trim: boolean;
}

interface Binding {
  /** 静态参数名；动态参数名使用 `keyNode`。 */
  readonly key?: string;
  readonly keyNode?: WikitextSyntaxNode;
  readonly valueNode: WikitextSyntaxNode;
  readonly caller: Frame;
  readonly trim: boolean;
}

interface Frame {
  readonly source: string;
  readonly syntax: WikitextSyntaxRoot;
  readonly scope: Map<string, ArgumentSlot>;
  readonly bindings: readonly Binding[];
  keysResolved: boolean;
  readonly title?: string;
  readonly pageName?: string;
}

/** 求值结果；记录偏移相对于 `text`。 */
interface EvalOutput {
  readonly text: string;
  readonly records: readonly RecordMark[];
  readonly unresolved: boolean;
}

interface PendingExpansionDiagnostic {
  readonly diagnostic: WikitextExpansionDiagnostic;
  readonly record?: MutableExpansionRecord;
}

type TemplateEntry =
  | { readonly kind: "missing" }
  /** 解析或校验失败；同一标题只获取一次模板源码，每个调用点各自记录诊断。 */
  | {
      readonly kind: "failed";
      readonly code: WikitextExpandErrorCode;
      readonly message: string;
      readonly cause?: unknown;
    }
  | {
      readonly kind: "template";
      readonly effective: string;
      readonly syntax: WikitextSyntaxRoot;
    };

export class ExpansionLimitError extends Error {}

class DependencyError extends Error {}

const EMPTY_OUTPUT: EvalOutput = { text: "", records: [], unresolved: false };

/** 可在展开阶段求值的纯 wikitext 解析器函数；站点状态函数仍然保留原文。 */
const MAGIC_WORD_FUNCTIONS = new Set([
  "if",
  "ifeq",
  "switch",
  "iferror",
  "expr",
  "ifexpr",
  "len",
  "sub",
  "replace",
  "titleparts",
  "padleft",
  "padright",
  "urlencode",
  "urldecode",
  "lc",
  "uc",
  "lcfirst",
  "ucfirst",
  "trim",
  "tag",
]);

/** 参数值内部按非行首处理，保留上游对嵌套模板的隐式换行。 */
const ARGUMENT_PREVIOUS_CHAR = " ";

function abortError(signal: AbortSignal): WikitextExpandError {
  return new WikitextExpandError("ABORTED", "Template expansion was aborted.", {
    cause: signal.reason,
  });
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal);
  }
}

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(abortError(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
        return undefined;
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/gu, "");
}

function implicitNewline(text: string, previousChar: string, heading: boolean): string {
  if (!text || previousChar === "" || previousChar === "\n") {
    return text;
  }
  const visible = text.replace(/^(?:<!--[\s\S]*?-->)+/u, "");
  const structural = heading ? /^(?:\{\||[:;#*=])/u : /^(?:\{\||[:;#*])/u;
  return structural.test(visible) ? `\n${text}` : text;
}

function stringProp(node: WikitextSyntaxNode, key: string): string | undefined {
  const value = node.props[key];
  return typeof value === "string" ? value : undefined;
}

function htmlEqual(left: string, right: string): boolean {
  const a = decodeHTML(left);
  const b = decodeHTML(right);
  return a === b || (a !== "" && b !== "" && Number(a) === Number(b));
}

export function isFatalParseError(error: unknown): boolean {
  return (
    error instanceof WikitextExpandError &&
    (error.code === "INCOMPATIBLE_PARSER" || error.code === "ABORTED")
  );
}

function isErrorOutput(text: string): boolean {
  return /<(?:strong|span|p|div)\s+(?:[^\s>]+\s+)*?class="\s*(?:[^"\s>]+\s+)*?error(?:\s[^">]*)?"/u.test(
    text,
  );
}

/**
 * 用 parser 解析并强制保留语法树；缺少语法树视为 parser 不兼容。
 * @param parser 注入的解析器。
 * @param parseOptions 解析预算与其他选项。
 * @param pageName 页面上下文。
 * @param maxSourceLength 本次源码长度上限。
 * @param source 已归一化的源码。
 */
export function parseWithSyntax(
  parser: WikitextParser,
  parseOptions: Omit<WikitextParseOptions, "pageName">,
  pageName: string | undefined,
  maxSourceLength: number,
  source: string,
): ParsedDocumentWithSyntax {
  const document: WikitextDocument = parser.parse(source, {
    ...parseOptions,
    ...(pageName === undefined ? {} : { pageName }),
    maxSourceLength,
    retainSyntax: true,
  });
  const syntax = document.syntax;
  if (!syntax || syntax.type !== "root" || !Array.isArray(syntax.children)) {
    throw new WikitextExpandError(
      "INCOMPATIBLE_PARSER",
      "The parser must return a syntax tree when retainSyntax is enabled.",
    );
  }
  return { ...document, syntax };
}

/**
 * 在保留调用结构和作用域的语法树上求值模板与解析器函数。
 * 实例持有单次展开的缓存、预算、记录与诊断。
 */
export class ExpansionEngine {
  private readonly records: MutableExpansionRecord[] = [];
  private readonly pendingDiagnostics: PendingExpansionDiagnostic[] = [];

  private readonly positions: PositionIndex;
  /** 同一标题在一次展开中只解析一次，resolver 必须返回稳定源码。 */
  private readonly cache = new Map<string, TemplateEntry>();
  private readonly titleCache = new Map<string, string | undefined>();
  private readonly stack: string[] = [];
  private invocations = 0;
  private invocationExhausted = false;
  private budgetDiagnosed = false;

  constructor(
    private readonly options: ResolvedExpandOptions,
    originalSource: string,
  ) {
    this.positions = createPositionIndex(originalSource);
  }

  /** 用注入 parser 解析源码，并强制保留语法树。 */
  parseInternal(
    source: string,
    pageName: string | undefined,
    maxSourceLength: number,
  ): ParsedDocumentWithSyntax {
    return parseWithSyntax(
      this.options.parser,
      this.options.parseOptions,
      pageName,
      maxSourceLength,
      source,
    );
  }

  createRootFrame(document: ParsedDocumentWithSyntax): Frame {
    return {
      source: document.source,
      syntax: document.syntax,
      scope: new Map(),
      bindings: [],
      keysResolved: true,
      ...(this.options.pageName === undefined ? {} : { pageName: this.options.pageName }),
    };
  }

  /** 把顶层调用在展开结果中的位置写回记录。 */
  applyExpandedRanges(output: EvalOutput): void {
    for (const mark of output.records) {
      mark.record.expandedRange = [mark.start, mark.end];
    }
  }

  /** 最终源码无法解析时，把所有记录标记为保留并追加回退诊断。 */
  markFallback(message: string): void {
    for (const record of this.records) {
      record.status = "preserved";
      record.expandedRange = record.originalRange;
    }
    this.pendingDiagnostics.push({
      diagnostic: {
        code: "FINAL_PARSE_FALLBACK",
        stage: "expand",
        severity: "error",
        message,
      },
    });
  }

  /** 把展开诊断映射到指定源码的坐标；回退时使用原始源码。 */
  mapDiagnostics(source: string): WikitextExpansionDiagnostic[] {
    const positions = createPositionIndex(source);
    return this.pendingDiagnostics.map(({ diagnostic, record }) => {
      if (!record) {
        return { ...diagnostic };
      }
      const range = record.expandedRange ?? record.originalRange;
      const within = range[0] >= 0 && range[1] <= source.length && range[0] <= range[1];
      return {
        code: diagnostic.code,
        stage: "expand",
        severity: diagnostic.severity,
        message: diagnostic.message,
        ...(diagnostic.rule === undefined ? {} : { rule: diagnostic.rule }),
        ...(diagnostic.templateTitle === undefined
          ? {}
          : { templateTitle: diagnostic.templateTitle }),
        origin: { range },
        ...(within ? { position: positions.position(range) } : {}),
      };
    });
  }

  /** 是否存在保留的顶层调用。 */
  hasPreservedRecords(): boolean {
    return this.records.some((record) => record.status === "preserved");
  }

  /** 生成公开的展开信息；未保留语法树时省略无法解析的 `syntaxId`。 */
  toInfo(status: WikitextExpansionStatus): WikitextExpansionInfo {
    const records: WikitextExpansionRecord[] = this.records.map((record) => ({
      kind: record.kind,
      name: record.name,
      originalRange: record.originalRange,
      expandedRange: record.expandedRange ?? record.originalRange,
      status: record.status,
    }));
    const retainSyntax = this.options.parseOptions.retainSyntax === true;
    const diagnostics = this.pendingDiagnostics.map(({ diagnostic }) =>
      retainSyntax || !diagnostic.origin
        ? diagnostic
        : { ...diagnostic, origin: { range: diagnostic.origin.range } },
    );
    return { status, records, diagnostics };
  }

  async evaluateDocument(frame: Frame): Promise<EvalOutput> {
    return this.evaluateRange(
      frame.syntax.range[0],
      frame.syntax.range[1],
      frame.syntax.children,
      frame,
      undefined,
      0,
      "",
    );
  }

  private throwIfAborted(): void {
    throwIfAborted(this.options.signal);
  }

  private position(range: WikitextRange): WikitextPosition {
    return this.positions.position(range);
  }

  private diagnose(
    code: string,
    message: string,
    record: MutableExpansionRecord,
    templateTitle?: string,
  ): void {
    const diagnostic: WikitextExpansionDiagnostic = {
      code,
      stage: "expand",
      severity: "warning",
      message,
      origin: {
        range: record.originalRange,
        ...(record.syntaxId === undefined ? {} : { syntaxId: record.syntaxId }),
      },
      position: this.position(record.originalRange),
      ...(templateTitle === undefined ? {} : { templateTitle }),
    };
    this.pendingDiagnostics.push({ diagnostic, record });
  }

  private recover(
    code: WikitextExpandErrorCode,
    diagnosticCode: string,
    message: string,
    record: MutableExpansionRecord,
    templateTitle?: string,
    cause?: unknown,
  ): void {
    if (this.options.strict) {
      throw new WikitextExpandError(code, message, {
        cause,
        range: record.originalRange,
        ...(templateTitle === undefined ? {} : { templateTitle }),
      });
    }
    this.diagnose(diagnosticCode, message, record, templateTitle);
  }

  private createRecord(
    kind: WikitextExpansionKind,
    node: WikitextSyntaxNode,
  ): MutableExpansionRecord {
    const record: MutableExpansionRecord = {
      kind,
      name: "",
      originalRange: node.range,
      syntaxId: node.id,
      status: "expanded",
    };
    this.records.push(record);
    return record;
  }

  private preserve(
    node: WikitextSyntaxNode,
    frame: Frame,
    record: MutableExpansionRecord,
    own: boolean,
  ): EvalOutput {
    if (own) {
      record.status = "preserved";
    }
    return { text: sourceText(frame.source, node), records: [], unresolved: true };
  }

  private async evaluateRange(
    start: number,
    end: number,
    children: readonly WikitextSyntaxNode[],
    frame: Frame,
    top: MutableExpansionRecord | undefined,
    depth: number,
    previousChar: string,
  ): Promise<EvalOutput> {
    const parts: string[] = [];
    const records: RecordMark[] = [];
    let length = 0;
    let unresolved = false;
    let cursor = start;
    let previous = previousChar;

    const append = (text: string): void => {
      if (!text) {
        return;
      }
      if (length + text.length > this.options.maxExpandedLength) {
        throw new ExpansionLimitError();
      }
      parts.push(text);
      length += text.length;
      previous = text.slice(-1);
    };

    for (const child of children) {
      if (child.range[1] <= start || child.range[0] >= end) {
        continue;
      }
      if (child.range[0] > cursor) {
        append(frame.source.slice(cursor, child.range[0]));
      }
      const childStart = length;
      const childOutput = await this.evaluateNode(child, frame, top, depth, previous);
      append(childOutput.text);
      for (const mark of childOutput.records) {
        records.push({
          record: mark.record,
          start: mark.start + childStart,
          end: mark.end + childStart,
        });
      }
      unresolved ||= childOutput.unresolved;
      cursor = Math.max(cursor, child.range[1]);
    }
    if (end > cursor) {
      append(frame.source.slice(cursor, end));
    }
    return { text: parts.join(""), records, unresolved };
  }

  private async evaluateNode(
    node: WikitextSyntaxNode,
    frame: Frame,
    top: MutableExpansionRecord | undefined,
    depth: number,
    previousChar: string,
  ): Promise<EvalOutput> {
    if (isCallNode(node)) {
      return this.evaluateCall(node, frame, top, depth, previousChar);
    }
    if (isOpaqueNode(node)) {
      return { text: sourceText(frame.source, node), records: [], unresolved: false };
    }
    if (node.children.length === 0) {
      return { text: sourceText(frame.source, node), records: [], unresolved: false };
    }
    return this.evaluateRange(
      node.range[0],
      node.range[1],
      node.children,
      frame,
      top,
      depth,
      previousChar,
    );
  }

  private async evaluateCall(
    node: WikitextSyntaxNode,
    frame: Frame,
    top: MutableExpansionRecord | undefined,
    depth: number,
    previousChar: string,
  ): Promise<EvalOutput> {
    const own = top === undefined;
    const kind: WikitextExpansionKind =
      node.type === "template"
        ? "template"
        : node.type === "magic-word"
          ? "parserFunction"
          : "argument";
    const record = top ?? this.createRecord(kind, node);
    const callDepth = depth + 1;
    if (own) {
      record.name = stringProp(node, "name") ?? "";
    }

    this.throwIfAborted();

    if (callDepth > this.options.maxDepth) {
      this.recover(
        "EXPANSION_BUDGET_EXCEEDED",
        "DEPTH_BUDGET_EXCEEDED",
        `Template expansion depth exceeds the limit of ${this.options.maxDepth}.`,
        record,
        kind === "template" ? (stringProp(node, "name") ?? undefined) : undefined,
      );
      return this.finishCall(this.preserve(node, frame, record, own), own, record);
    }
    if (this.invocationExhausted) {
      return this.finishCall(this.preserve(node, frame, record, own), own, record);
    }
    if (this.invocations >= this.options.maxInvocations) {
      this.invocationExhausted = true;
      if (!this.budgetDiagnosed) {
        this.budgetDiagnosed = true;
        this.recover(
          "EXPANSION_BUDGET_EXCEEDED",
          "INVOCATION_BUDGET_EXCEEDED",
          `Template expansion reached the invocation limit of ${this.options.maxInvocations}.`,
          record,
        );
      }
      return this.finishCall(this.preserve(node, frame, record, own), own, record);
    }
    this.invocations++;

    let output: EvalOutput;
    try {
      output =
        node.type === "template"
          ? await this.evaluateTemplate(node, frame, record, own, callDepth)
          : node.type === "magic-word"
            ? await this.evaluateMagicWord(node, frame, record, own, callDepth)
            : await this.evaluateArgument(node, frame, record, own, callDepth, previousChar);
    } catch (error) {
      if (error instanceof DependencyError) {
        output = this.preserve(node, frame, record, own);
      } else if (error instanceof ExpansionLimitError) {
        this.recover(
          "EXPANSION_BUDGET_EXCEEDED",
          "LENGTH_BUDGET_EXCEEDED",
          `Template expansion exceeds the length limit of ${this.options.maxExpandedLength}.`,
          record,
        );
        output = this.preserve(node, frame, record, own);
      } else {
        throw error;
      }
    }

    const text =
      node.type === "arg"
        ? output.text
        : implicitNewline(output.text, previousChar, node.type === "template");
    return this.finishCall({ ...output, text }, own, record);
  }

  private finishCall(output: EvalOutput, own: boolean, record: MutableExpansionRecord): EvalOutput {
    if (!own) {
      return { text: output.text, records: [], unresolved: output.unresolved };
    }
    return {
      text: output.text,
      records: [{ record, start: 0, end: output.text.length }],
      unresolved: output.unresolved,
    };
  }

  private async evaluateTemplate(
    node: WikitextSyntaxNode,
    frame: Frame,
    record: MutableExpansionRecord,
    own: boolean,
    depth: number,
  ): Promise<EvalOutput> {
    const modifier = stringProp(node, "modifier") ?? "";
    if (modifier) {
      this.recover(
        "UNSUPPORTED_CALL",
        "UNSUPPORTED_CALL",
        `Transclusion modifier "${modifier}" is not supported.`,
        record,
      );
      return this.preserve(node, frame, record, own);
    }

    const name = await this.evaluateTemplateName(node, frame, record, depth);
    if (name.unresolved) {
      this.recover(
        "UNRESOLVED_DEPENDENCY",
        "UNRESOLVED_DEPENDENCY",
        "The template name depends on a call that could not be expanded.",
        record,
      );
      return this.preserve(node, frame, record, own);
    }
    if (own) {
      record.name = name.title ?? name.text;
    }

    if (!name.title) {
      this.recover(
        "TEMPLATE_NOT_FOUND",
        "TEMPLATE_NOT_FOUND",
        `Template "${name.text}" could not be resolved to a valid title.`,
        record,
      );
      return this.preserve(node, frame, record, own);
    }
    const title = name.title;
    if (this.stack.includes(title)) {
      this.recover(
        "TEMPLATE_LOOP",
        "TEMPLATE_LOOP",
        `Template loop detected: ${title}.`,
        record,
        title,
      );
      return this.preserve(node, frame, record, own);
    }

    const entry = await this.loadTemplate(title, record, frame);
    if (entry.kind === "failed") {
      this.recover(entry.code, entry.code, entry.message, record, title, entry.cause);
      return this.preserve(node, frame, record, own);
    }
    if (entry.kind === "missing") {
      this.recover(
        "TEMPLATE_NOT_FOUND",
        "TEMPLATE_NOT_FOUND",
        `Template "${title}" was not found.`,
        record,
        title,
      );
      return this.preserve(node, frame, record, own);
    }

    const templateFrame: Frame = {
      source: entry.effective,
      syntax: entry.syntax,
      scope: new Map(),
      bindings: this.buildBindings(node, frame),
      keysResolved: false,
      title,
      pageName: title,
    };
    this.stack.push(title);
    try {
      const body = await this.evaluateRange(
        entry.syntax.range[0],
        entry.syntax.range[1],
        entry.syntax.children,
        templateFrame,
        record,
        depth,
        "",
      );
      return { text: body.text, records: [], unresolved: body.unresolved };
    } finally {
      this.stack.pop();
    }
  }

  private async evaluateTemplateName(
    node: WikitextSyntaxNode,
    frame: Frame,
    top: MutableExpansionRecord,
    depth: number,
  ): Promise<{ text: string; title?: string; unresolved: boolean }> {
    const nameNode = findChild(node, "template-name");
    if (!nameNode) {
      return { text: "", unresolved: false };
    }
    const dynamic = nameNode.children.some(isCallNode);
    if (!dynamic) {
      const text = stripComments(sourceText(frame.source, nameNode)).trim();
      const parsed = stringProp(node, "name");
      const title = parsed === undefined ? text : parsed;
      return { text, ...(title ? { title } : {}), unresolved: false };
    }
    const evaluated = await this.evaluateRange(
      nameNode.range[0],
      nameNode.range[1],
      nameNode.children,
      frame,
      top,
      depth,
      "",
    );
    if (evaluated.unresolved) {
      return { text: evaluated.text, unresolved: true };
    }
    const text = stripComments(evaluated.text).trim();
    if (!text) {
      return { text, unresolved: false };
    }
    return { text, title: this.normalizeDynamicTitle(text, frame), unresolved: false };
  }

  private normalizeDynamicTitle(text: string, frame: Frame): string | undefined {
    const pageName = frame.pageName ?? this.options.pageName;
    const cacheKey = `${pageName ?? ""}\u0000${text}`;
    if (this.titleCache.has(cacheKey)) {
      return this.titleCache.get(cacheKey);
    }
    let title: string | undefined;
    const snippet = `{{${text}}}`;
    try {
      const document = this.parseInternal(
        snippet,
        pageName,
        Math.max(this.options.sourceLimit, snippet.length),
      );
      const template = document.syntax.children.find((child) => child.type === "template");
      const parsed = template ? stringProp(template, "name") : undefined;
      title = parsed || undefined;
    } catch (error) {
      if (isFatalParseError(error)) {
        throw error;
      }
      title = undefined;
    }
    this.titleCache.set(cacheKey, title);
    return title;
  }

  private buildBindings(node: WikitextSyntaxNode, caller: Frame): Binding[] {
    const bindings: Binding[] = [];
    let anonymous = 0;
    for (const parameter of node.children) {
      if (parameter.type !== "parameter") {
        continue;
      }
      const anonymousParam = parameter.props.anon === true;
      let key: string | undefined;
      let keyNode: WikitextSyntaxNode | undefined;
      if (anonymousParam) {
        anonymous++;
        key = stringProp(parameter, "name") ?? String(anonymous);
      } else {
        keyNode = findChild(parameter, "parameter-key");
        if (!keyNode || !keyNode.children.some(isCallNode)) {
          key =
            stringProp(parameter, "name") ??
            (keyNode ? stripComments(sourceText(caller.source, keyNode)).trim() : "");
          keyNode = undefined;
        }
      }
      const valueNode = findChild(parameter, "parameter-value");
      if (!valueNode) {
        continue;
      }
      bindings.push({
        ...(key === undefined ? {} : { key }),
        ...(keyNode === undefined ? {} : { keyNode }),
        valueNode,
        caller,
        trim: !anonymousParam,
      });
    }
    return bindings;
  }

  /** 参数名在首次读取时才求值，未使用的模板参数不触发解析。 */
  private async resolveArgument(
    frame: Frame,
    name: string,
    record: MutableExpansionRecord,
    depth: number,
  ): Promise<ArgumentSlot | undefined> {
    if (!frame.keysResolved) {
      frame.keysResolved = true;
      for (const binding of frame.bindings) {
        let key = binding.key;
        if (binding.keyNode) {
          const evaluated = await this.evaluateRange(
            binding.keyNode.range[0],
            binding.keyNode.range[1],
            binding.keyNode.children,
            binding.caller,
            record,
            depth,
            "",
          );
          if (evaluated.unresolved) {
            this.recover(
              "UNRESOLVED_DEPENDENCY",
              "UNRESOLVED_DEPENDENCY",
              "A template parameter name depends on a call that could not be expanded.",
              record,
              frame.title,
            );
            continue;
          }
          key = stripComments(evaluated.text).trim();
        }
        if (key !== undefined) {
          frame.scope.set(key, {
            node: binding.valueNode,
            frame: binding.caller,
            trim: binding.trim,
          });
        }
      }
    }
    return frame.scope.get(name);
  }

  private async evaluateArgument(
    node: WikitextSyntaxNode,
    frame: Frame,
    record: MutableExpansionRecord,
    own: boolean,
    depth: number,
    previousChar: string,
  ): Promise<EvalOutput> {
    const nameNode = findChild(node, "arg-name");
    let name = "";
    if (nameNode) {
      if (nameNode.children.some(isCallNode)) {
        const evaluated = await this.evaluateRange(
          nameNode.range[0],
          nameNode.range[1],
          nameNode.children,
          frame,
          record,
          depth,
          "",
        );
        if (evaluated.unresolved) {
          this.recover(
            "UNRESOLVED_DEPENDENCY",
            "UNRESOLVED_DEPENDENCY",
            "The argument name depends on a call that could not be expanded.",
            record,
          );
          return this.preserve(node, frame, record, own);
        }
        name = stripComments(evaluated.text).trim();
      } else {
        name = stripComments(sourceText(frame.source, nameNode)).trim();
      }
    }
    if (own) {
      record.name = name;
    }

    const slot = await this.resolveArgument(frame, name, record, depth);
    if (slot) {
      const value = await this.evaluateNode(
        slot.node,
        slot.frame,
        record,
        depth,
        ARGUMENT_PREVIOUS_CHAR,
      );
      return {
        text: slot.trim ? value.text.trim() : value.text,
        records: [],
        unresolved: value.unresolved,
      };
    }

    const defaultNode = findChild(node, "arg-default");
    if (defaultNode) {
      return this.evaluateRange(
        defaultNode.range[0],
        defaultNode.range[1],
        defaultNode.children,
        frame,
        record,
        depth,
        previousChar,
      );
    }
    return this.preserve(node, frame, record, own);
  }

  private async evaluateMagicWord(
    node: WikitextSyntaxNode,
    frame: Frame,
    record: MutableExpansionRecord,
    own: boolean,
    depth: number,
  ): Promise<EvalOutput> {
    const name = (stringProp(node, "name") ?? "").toLowerCase();
    const modifier = stringProp(node, "modifier") ?? "";
    if (own) {
      record.name = name;
    }
    if (modifier) {
      this.recover(
        "UNSUPPORTED_CALL",
        "UNSUPPORTED_CALL",
        `Magic word modifier "${modifier}" is not supported.`,
        record,
      );
      return this.preserve(node, frame, record, own);
    }
    if (name === "!") {
      return { text: "|", records: [], unresolved: false };
    }
    if (name === "=") {
      return { text: "=", records: [], unresolved: false };
    }
    if (!MAGIC_WORD_FUNCTIONS.has(name)) {
      this.recover(
        "UNSUPPORTED_CALL",
        "UNSUPPORTED_CALL",
        `Parser function "${name || "unknown"}" is not supported.`,
        record,
      );
      return this.preserve(node, frame, record, own);
    }

    const params = node.children.filter((child) => child.type === "parameter");
    const values = new Map<WikitextSyntaxNode, Promise<EvalOutput>>();
    const read = (param: WikitextSyntaxNode | undefined): Promise<EvalOutput> => {
      if (!param) {
        return Promise.resolve(EMPTY_OUTPUT);
      }
      let pending = values.get(param);
      if (!pending) {
        pending = this.evaluateNode(param, frame, record, depth, "");
        values.set(param, pending);
      }
      return pending;
    };
    const readValue = async (param: WikitextSyntaxNode | undefined): Promise<EvalOutput> => {
      const output = await read(param);
      return { text: output.text.trim(), records: [], unresolved: output.unresolved };
    };
    const readText = async (param: WikitextSyntaxNode | undefined): Promise<EvalOutput> => {
      const output = await read(param);
      return {
        text: stripRawExtensions(stripComments(output.text)).trim(),
        records: [],
        unresolved: output.unresolved,
      };
    };
    const dependency = (): never => {
      this.recover(
        "UNRESOLVED_DEPENDENCY",
        "UNRESOLVED_DEPENDENCY",
        "The parser function depends on a call that could not be expanded.",
        record,
      );
      throw new DependencyError();
    };

    if (name === "if") {
      if (params.length <= 1) {
        return EMPTY_OUTPUT;
      }
      const condition = await readText(params[0]);
      if (condition.unresolved) {
        return dependency();
      }
      const branch = decodeHTML(condition.text) ? params[1] : params[2];
      const output = await readValue(branch);
      return { text: output.text, records: [], unresolved: output.unresolved };
    }

    if (name === "ifeq") {
      if (params.length < 3) {
        return EMPTY_OUTPUT;
      }
      const left = await readText(params[0]);
      if (left.unresolved) {
        return dependency();
      }
      const right = await readText(params[1]);
      if (right.unresolved) {
        return dependency();
      }
      const branch = htmlEqual(left.text, right.text) ? params[2] : params[3];
      const output = await readValue(branch);
      return { text: output.text, records: [], unresolved: output.unresolved };
    }

    if (name === "iferror") {
      const condition = await readValue(params[0]);
      if (condition.unresolved) {
        return dependency();
      }
      const detection = stripRawExtensions(stripComments(condition.text));
      if (isErrorOutput(decodeHTML(detection))) {
        const output = await readValue(params[1]);
        return { text: output.text, records: [], unresolved: output.unresolved };
      }
      if (params.length >= 3) {
        const output = await readValue(params[2]);
        return { text: output.text, records: [], unresolved: output.unresolved };
      }
      return condition;
    }

    const readArg = async (index: number): Promise<string | undefined> => {
      const output = await readText(params[index]);
      return output.unresolved ? undefined : output.text;
    };
    const readNumberArg = async (index: number, fallback = 0): Promise<number | undefined> => {
      const text = await readArg(index);
      if (text === undefined) {
        return undefined;
      }
      const value = Number.parseInt(text.trim(), 10);
      return Number.isFinite(value) ? value : fallback;
    };

    if (name === "expr") {
      const text = await readArg(0);
      if (text === undefined) {
        return dependency();
      }
      const result = evaluateExpression(decodeHTML(text));
      if (result === undefined) {
        this.recover(
          "UNSUPPORTED_CALL",
          "EXPRESSION_ERROR",
          `Expression could not be evaluated: ${text}`,
          record,
        );
        return this.preserve(node, frame, record, own);
      }
      return { text: result, records: [], unresolved: false };
    }

    if (name === "ifexpr") {
      const text = await readArg(0);
      if (text === undefined) {
        return dependency();
      }
      const result = evaluateExpression(decodeHTML(text));
      if (result === undefined) {
        this.recover(
          "UNSUPPORTED_CALL",
          "EXPRESSION_ERROR",
          `Expression could not be evaluated: ${text}`,
          record,
        );
        return this.preserve(node, frame, record, own);
      }
      const branch = Number(result) !== 0 ? params[1] : params[2];
      const output = await readValue(branch);
      return { text: output.text, records: [], unresolved: output.unresolved };
    }

    if (name === "len") {
      const text = await readArg(0);
      if (text === undefined) {
        return dependency();
      }
      return { text: String(text.length), records: [], unresolved: false };
    }

    if (name === "sub") {
      const text = await readArg(0);
      if (text === undefined) {
        return dependency();
      }
      const start = await readNumberArg(1);
      if (start === undefined) {
        return dependency();
      }
      const lengthText = await readArg(2);
      if (lengthText === undefined) {
        return dependency();
      }
      const length = lengthText ? Number.parseInt(lengthText.trim(), 10) : undefined;
      return {
        text: substring(text, start, Number.isFinite(length) ? length : undefined),
        records: [],
        unresolved: false,
      };
    }

    if (name === "replace") {
      const text = await readArg(0);
      const from = await readArg(1);
      const to = await readArg(2);
      if (text === undefined || from === undefined || to === undefined) {
        return dependency();
      }
      return {
        text: from === "" ? text : text.split(from).join(to),
        records: [],
        unresolved: false,
      };
    }

    if (name === "titleparts") {
      const text = await readArg(0);
      if (text === undefined) {
        return dependency();
      }
      const count = (await readNumberArg(1)) ?? 0;
      const first = (await readNumberArg(2)) ?? 0;
      return { text: titleParts(text, count, first), records: [], unresolved: false };
    }

    if (name === "padleft" || name === "padright") {
      const text = await readArg(0);
      if (text === undefined) {
        return dependency();
      }
      const length = (await readNumberArg(1)) ?? 0;
      const padding = (await readArg(2)) ?? "0";
      return {
        text: pad(text, length, padding, name === "padleft" ? "left" : "right"),
        records: [],
        unresolved: false,
      };
    }

    if (name === "urlencode" || name === "urldecode") {
      const text = await readArg(0);
      if (text === undefined) {
        return dependency();
      }
      return {
        text: name === "urlencode" ? urlEncode(text) : urlDecode(text),
        records: [],
        unresolved: false,
      };
    }

    if (
      name === "lc" ||
      name === "uc" ||
      name === "lcfirst" ||
      name === "ucfirst" ||
      name === "trim"
    ) {
      const text = await readArg(0);
      if (text === undefined) {
        return dependency();
      }
      const result =
        name === "lc"
          ? text.toLowerCase()
          : name === "uc"
            ? text.toUpperCase()
            : name === "lcfirst"
              ? text.charAt(0).toLowerCase() + text.slice(1)
              : name === "ucfirst"
                ? text.charAt(0).toUpperCase() + text.slice(1)
                : text.trim();
      return { text: result, records: [], unresolved: false };
    }

    if (name === "tag") {
      const tagName = await readArg(0);
      if (tagName === undefined) {
        return dependency();
      }
      const content = await readValue(params[1]);
      if (content.unresolved) {
        return dependency();
      }
      const attributes: Array<{ name: string; value: string }> = [];
      for (const param of params.slice(2)) {
        const key = stringProp(param, "name");
        if (!key) {
          continue;
        }
        const value = await readValue(findChild(param, "parameter-value"));
        if (value.unresolved) {
          return dependency();
        }
        attributes.push({ name: key, value: value.text });
      }
      const output = tagOutput(tagName.trim(), content.text, attributes);
      if (output === undefined) {
        this.recover(
          "UNSUPPORTED_CALL",
          "UNSUPPORTED_CALL",
          `#tag received an invalid tag name: ${tagName}`,
          record,
        );
        return this.preserve(node, frame, record, own);
      }
      return { text: output, records: [], unresolved: false };
    }

    return this.evaluateSwitch(params, readText, readValue, dependency);
  }

  private async evaluateSwitch(
    params: readonly WikitextSyntaxNode[],
    readText: (param: WikitextSyntaxNode | undefined) => Promise<EvalOutput>,
    readValue: (param: WikitextSyntaxNode | undefined) => Promise<EvalOutput>,
    dependency: () => EvalOutput,
  ): Promise<EvalOutput> {
    if (params.length <= 1) {
      return EMPTY_OUTPUT;
    }
    const condition = await readText(params[0]);
    if (condition.unresolved) {
      return dependency();
    }

    const readSwitchValue = async (param: WikitextSyntaxNode): Promise<EvalOutput> => {
      if (param.props.anon === true) {
        return readValue(param);
      }
      const valueNode = findChild(param, "parameter-value");
      return readValue(valueNode);
    };

    let defaultParam: WikitextSyntaxNode | undefined;
    let found: 0 | 1 | 2 | 3 = 0;
    for (let index = 1; index < params.length; index++) {
      const param = params[index]!;
      if (param.props.anon === true) {
        if (index === params.length - 1) {
          return readValue(param);
        }
        const item = await readText(param);
        if (item.unresolved) {
          found = 3;
          continue;
        }
        if (item.text === "#default" && found < 2) {
          found = 1;
          continue;
        }
        if (htmlEqual(item.text, condition.text)) {
          found = 2;
        }
        continue;
      }
      if (found === 2) {
        return readSwitchValue(param);
      }
      if (found === 3) {
        return dependency();
      }
      const keyNode = findChild(param, "parameter-key");
      const key = await readText(keyNode);
      if (key.unresolved) {
        return dependency();
      }
      if (htmlEqual(key.text, condition.text)) {
        return readSwitchValue(param);
      }
      if (found === 1 || key.text.toLowerCase() === "#default") {
        defaultParam = param;
        found = 0;
      }
    }
    if (defaultParam) {
      return readSwitchValue(defaultParam);
    }
    return EMPTY_OUTPUT;
  }

  private async loadTemplate(
    title: string,
    record: MutableExpansionRecord,
    callerFrame: Frame,
  ): Promise<TemplateEntry> {
    const cached = this.cache.get(title);
    if (cached) {
      return cached;
    }
    this.throwIfAborted();

    const request: WikitextTemplateRequest = {
      title,
      ...(this.options.pageName === undefined ? {} : { pageName: this.options.pageName }),
      ...(callerFrame.title === undefined ? {} : { callerTitle: callerFrame.title }),
      invocation: record.originalRange,
      ...(this.options.signal === undefined ? {} : { signal: this.options.signal }),
    };

    let response: string | null | undefined;
    try {
      const pending = Promise.resolve(this.options.resolveTemplate(request));
      response = await raceAbort(pending, this.options.signal);
    } catch (error) {
      this.throwIfAborted();
      return this.failTemplate(
        title,
        "TEMPLATE_RESOLVE_FAILED",
        `Template resolver failed for "${title}".`,
        error,
      );
    }
    this.throwIfAborted();

    if (response === null || response === undefined) {
      const entry: TemplateEntry = { kind: "missing" };
      this.cache.set(title, entry);
      return entry;
    }
    if (typeof response !== "string") {
      return this.failTemplate(
        title,
        "TEMPLATE_RESOLVE_FAILED",
        `Template resolver returned a non-string value for "${title}".`,
      );
    }

    const source = response.replace(/\r\n?/gu, "\n");
    if (source.length > this.options.sourceLimit) {
      return this.failTemplate(
        title,
        "TEMPLATE_PARSE_FAILED",
        `Template "${title}" exceeds the source length limit of ${this.options.sourceLimit}.`,
      );
    }

    let parsed: ParsedDocumentWithSyntax;
    try {
      parsed = this.parseInternal(source, title, this.options.sourceLimit);
    } catch (error) {
      if (isFatalParseError(error)) {
        throw error;
      }
      return this.failTemplate(
        title,
        "TEMPLATE_PARSE_FAILED",
        `Template "${title}" could not be parsed.`,
        error,
      );
    }

    const effective = filterTransclusionSource(source, parsed.syntax).replace(/\n$/u, "");
    if (effective.length > this.options.sourceLimit) {
      return this.failTemplate(
        title,
        "TEMPLATE_PARSE_FAILED",
        `Template "${title}" exceeds the source length limit of ${this.options.sourceLimit} after include filtering.`,
      );
    }

    let syntax = parsed.syntax;
    if (effective !== source) {
      try {
        syntax = this.parseInternal(effective, title, this.options.sourceLimit).syntax;
      } catch (error) {
        if (isFatalParseError(error)) {
          throw error;
        }
        return this.failTemplate(
          title,
          "TEMPLATE_PARSE_FAILED",
          `Template "${title}" could not be parsed after include filtering.`,
          error,
        );
      }
    }

    const entry: TemplateEntry = { kind: "template", effective, syntax };
    this.cache.set(title, entry);
    return entry;
  }

  /** 写入失败缓存；同一标题不再获取模板源码，每个调用点仍各自记录诊断。 */
  private failTemplate(
    title: string,
    code: WikitextExpandErrorCode,
    message: string,
    cause?: unknown,
  ): TemplateEntry {
    const entry: TemplateEntry = {
      kind: "failed",
      code,
      message,
      ...(cause === undefined ? {} : { cause }),
    };
    this.cache.set(title, entry);
    return entry;
  }
}
