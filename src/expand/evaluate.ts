import { decodeHTML } from "entities";
import { WikitextExpandError, type WikitextExpandErrorCode } from "../ast/errors";
import type {
  WikitextDiagnostic,
  WikitextDiagnosticSeverity,
  WikitextSyntaxNode,
  WikitextSyntaxRoot,
} from "../ast/model";
import {
  concatOutputs,
  EMPTY_OUTPUT,
  generatedOutput,
  literalOutput,
  outputLength,
  outputText,
  tagInvocation,
  transformOutput,
  trimOutput,
  type WikitextOutput,
} from "../ast/sourceGraph/output";
import type {
  WikitextInvocationKind,
  WikitextInvocationStatus,
  WikitextSourceId,
  WikitextSourceSpan,
  WikitextTextSource,
} from "../ast/sourceGraph/types";
import {
  codePointLength,
  errorOutput,
  evaluateExpression,
  pad,
  replaceText,
  substring,
  tagOutput,
  titleParts,
  urlDecode,
  urlEncode,
} from "./functions";
import { findChild, isCallNode, isOpaqueNode, stripRawExtensions } from "./syntax";

/** 规范化后的模板程序：有效正文、语法树与内容版本。 */
export interface TemplateProgram {
  readonly title: string;
  readonly revision: string;
  /** 有效正文文本源（include 过滤后的 LF 文本）。 */
  readonly source: WikitextTextSource;
  readonly syntax: WikitextSyntaxRoot;
}

/** 求值调用记录；装配阶段由 `WikitextInvocation.outputs` 补齐它在展开结果中的出现位置。 */
export interface InvocationDraft {
  id: string;
  kind: WikitextInvocationKind;
  name: string;
  scopeId: string;
  parentId?: string;
  sourceId: WikitextSourceId;
  start: number;
  end: number;
  status: WikitextInvocationStatus;
  templateTitle?: string;
  reason?: string;
}

/** 本轮确定需要的模板；携带实际调用位置供 provider 诊断。 */
export interface TemplateDemand {
  readonly title: string;
  readonly location: WikitextSourceSpan;
  readonly callerTitle?: string;
}

/** 求值环境；所有数据由编译器提供。`Evaluator` 的实例字段只属于本次求值，不跨编译共享。 */
export interface EvaluateContext {
  readonly pageSource: WikitextTextSource;
  readonly pageName?: string;
  /** 查找已编译模板程序；未命中时求值器记录需求并推迟本轮。 */
  readonly program: (title: string) => TemplateProgram | undefined;
  /** 查找已确认失败或缺失的模板；返回结果时不重复获取。 */
  readonly failure: (title: string) =>
    | {
        readonly code: WikitextExpandErrorCode;
        readonly message: string;
        readonly cause?: unknown;
      }
    | undefined;
  readonly demand: (demand: TemplateDemand) => void;
  /** 把动态标题文本规范化为模板标题。 */
  readonly normalizeTitle: (text: string, pageName: string | undefined) => string | undefined;
  readonly diagnostics: WikitextDiagnostic[];
  readonly maxDepth: number;
  readonly maxInvocations: number;
  readonly maxLength: number;
  readonly failureMode: "preserve" | "throw";
}

/** 一次求值的结果；`unresolved` 为真时调用方必须丢弃输出并重试。 */
export interface Evaluation {
  readonly output: WikitextOutput;
  readonly invocations: readonly InvocationDraft[];
  readonly unresolved: boolean;
}

interface Binding {
  readonly key?: string;
  readonly keyNode?: WikitextSyntaxNode;
  readonly valueNode: WikitextSyntaxNode;
  readonly caller: Frame;
  readonly trim: boolean;
}

interface ArgumentSlot {
  readonly node: WikitextSyntaxNode;
  readonly frame: Frame;
  readonly trim: boolean;
  cached?: WikitextOutput;
}

interface ArgumentScope {
  readonly bindings: readonly Binding[];
  readonly slots: Map<string, ArgumentSlot>;
  keysResolved: boolean;
}

interface Frame {
  readonly source: WikitextTextSource;
  readonly syntax: WikitextSyntaxRoot;
  readonly title?: string;
  readonly pageName?: string;
  /** 词法模板祖先路径；循环检测只看这条路径。 */
  readonly ancestors: readonly string[];
  readonly scopeId: string;
  readonly parentInvocationId?: string;
  /** 当前 frame 的调用方参数绑定；只有模板 frame 提供。 */
  readonly args?: ArgumentScope;
}

interface CallContext {
  readonly depth: number;
  readonly parentInvocationId?: string;
}

/** 参数值内部按非行首处理，保留上游对嵌套模板的隐式换行。 */
const ARGUMENT_PREVIOUS_CHAR = " ";

/** 可在展开阶段求值的纯 wikitext 解析器函数。 */
const MAGIC_WORD_FUNCTIONS: ReadonlySet<string> = new Set([
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

function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/gu, "");
}

function implicitNewline(text: string, previousChar: string, heading: boolean): boolean {
  if (!text || previousChar === "" || previousChar === "\n") {
    return false;
  }
  const visible = text.replace(/^(?:<!--[\s\S]*?-->)+/u, "");
  const structural = heading ? /^(?:\{\||[:;#*=])/u : /^(?:\{\||[:;#*])/u;
  return structural.test(visible);
}

function htmlEqual(left: string, right: string): boolean {
  const a = decodeHTML(left);
  const b = decodeHTML(right);
  return a === b || (a !== "" && b !== "" && Number(a) === Number(b));
}

/** 判断可见输出是否带站点错误标记；`#iferror` 只依据可见输出。 */
function isErrorOutput(text: string): boolean {
  return /<(?:strong|span|p|div)\s+(?:[^\s>]+\s+)*?class="\s*(?:[^"\s>]+\s+)*?error(?:\s[^">]*)?"/u.test(
    text,
  );
}

function stringProp(node: WikitextSyntaxNode, key: string): string | undefined {
  const value = node.props[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * 在不可变 frame 上求值模板与解析器函数。
 *
 * 求值是同步的：需要尚未编译的模板时记录需求并推迟本轮，由调度器统一获取后
 * 重新求值。这样任务顺序、预算分配与输出都不依赖网络返回顺序。
 */
export class Evaluator {
  private readonly invocations: InvocationDraft[] = [];
  private invocationsUsed = 0;
  private produced = 0;
  private exhausted = false;
  private unresolved = false;
  /** 是否产生了站点风格的可见错误输出；它使编译状态为 partial。 */
  private hadErrorOutput = false;
  private invocationSequence = 0;
  private budgetDiagnosed = false;

  constructor(private readonly context: EvaluateContext) {}

  /** 求值整份文档。 */
  evaluate(source: WikitextSyntaxRoot, textSource: WikitextTextSource): Evaluation {
    const frame: Frame = {
      source: textSource,
      syntax: source,
      ancestors: [],
      scopeId: "scope:root",
      ...(this.context.pageName === undefined ? {} : { pageName: this.context.pageName }),
    };
    const output = this.evaluateRange(
      frame,
      source.range[0],
      source.range[1],
      source.children,
      { depth: 0 },
      "",
    );
    return {
      output,
      invocations: this.invocations,
      unresolved: this.unresolved || this.hadErrorOutput,
    };
  }

  private span(frame: Frame, node: WikitextSyntaxNode): WikitextSourceSpan {
    return {
      sourceId: frame.source.id,
      start: node.range[0],
      end: node.range[1],
    };
  }

  private callSpan(frame: Frame, start: number, end: number): WikitextSourceSpan {
    return { sourceId: frame.source.id, start, end };
  }

  private diagnose(
    code: string,
    severity: WikitextDiagnosticSeverity,
    message: string,
    location: WikitextSourceSpan,
    extra: {
      readonly invocationId?: string;
      readonly templateTitle?: string;
      readonly related?: WikitextDiagnostic["related"];
    } = {},
  ): void {
    if (this.context.diagnostics.length >= 5_000) {
      return;
    }
    this.context.diagnostics.push({
      code,
      stage: "expand",
      severity,
      message,
      location,
      ...(extra.invocationId === undefined ? {} : { invocationId: extra.invocationId }),
      ...(extra.related === undefined ? {} : { related: extra.related }),
      ...(extra.templateTitle === undefined ? {} : { templateTitle: extra.templateTitle }),
    });
  }

  /** 可恢复失败：严格模式抛错，否则记录诊断并保留原文。 */
  private recover(
    code: WikitextExpandErrorCode,
    diagnosticCode: string,
    message: string,
    draft: InvocationDraft,
    frame: Frame,
    node: WikitextSyntaxNode,
    templateTitle?: string,
    cause?: unknown,
  ): WikitextOutput {
    const location = this.span(frame, node);
    if (this.context.failureMode === "throw") {
      throw new WikitextExpandError(code, message, {
        location,
        ...(templateTitle === undefined ? {} : { templateTitle }),
        ...(cause === undefined ? {} : { cause }),
      });
    }
    draft.status = "preserved";
    draft.reason = diagnosticCode;
    this.unresolved = true;
    this.diagnose(diagnosticCode, "warning", message, location, {
      invocationId: draft.id,
      ...(templateTitle === undefined ? {} : { templateTitle }),
    });
    return this.preserve(frame, node);
  }

  /**
   * 预算受限：严格模式抛错，否则保留原文并只在首次记录摘要诊断。
   * 每个调用点仍然各自标记状态，摘要不复制无界的位置列表。
   */
  private budgetFailure(
    diagnosticCode: string,
    message: string,
    draft: InvocationDraft,
    frame: Frame,
    node: WikitextSyntaxNode,
  ): WikitextOutput {
    draft.status = "preserved";
    draft.reason = diagnosticCode;
    this.unresolved = true;
    if (this.context.failureMode === "throw") {
      throw new WikitextExpandError("EXPANSION_BUDGET_EXCEEDED", message, {
        location: this.span(frame, node),
      });
    }
    if (!this.budgetDiagnosed) {
      this.budgetDiagnosed = true;
      this.diagnose(diagnosticCode, "warning", message, this.span(frame, node), {
        invocationId: draft.id,
      });
    }
    return tagInvocation(this.preserve(frame, node), draft.id);
  }

  private preserve(frame: Frame, node: WikitextSyntaxNode): WikitextOutput {
    return {
      ...literalOutput(
        frame.source.text.slice(node.range[0], node.range[1]),
        this.span(frame, node),
      ),
      unresolved: true,
    };
  }

  private evaluateRange(
    frame: Frame,
    start: number,
    end: number,
    children: readonly WikitextSyntaxNode[],
    context: CallContext,
    previousChar: string,
  ): WikitextOutput {
    const parts: WikitextOutput[] = [];
    let cursor = start;
    let previous = previousChar;
    for (const child of children) {
      if (child.range[1] <= start || child.range[0] >= end) {
        continue;
      }
      if (child.range[0] > cursor) {
        parts.push(this.literal(frame, cursor, child.range[0]));
      }
      const output = this.evaluateNode(child, frame, context, previous);
      parts.push(output);
      const last = output.pieces.at(-1);
      if (last && last.text) {
        previous = last.text.slice(-1);
      }
      cursor = Math.max(cursor, child.range[1]);
    }
    if (end > cursor) {
      parts.push(this.literal(frame, cursor, end));
    }
    return concatOutputs(parts);
  }

  private literal(frame: Frame, start: number, end: number): WikitextOutput {
    if (end <= start) {
      return EMPTY_OUTPUT;
    }
    return literalOutput(frame.source.text.slice(start, end), this.callSpan(frame, start, end));
  }

  private evaluateNode(
    node: WikitextSyntaxNode,
    frame: Frame,
    context: CallContext,
    previousChar: string,
  ): WikitextOutput {
    if (isCallNode(node)) {
      return this.evaluateCall(node, frame, context, previousChar);
    }
    if (isOpaqueNode(node) || node.children.length === 0) {
      return this.literal(frame, node.range[0], node.range[1]);
    }
    return this.evaluateRange(
      frame,
      node.range[0],
      node.range[1],
      node.children,
      context,
      previousChar,
    );
  }

  private evaluateCall(
    node: WikitextSyntaxNode,
    frame: Frame,
    context: CallContext,
    previousChar: string,
  ): WikitextOutput {
    const kind: WikitextInvocationKind =
      node.type === "template"
        ? "template"
        : node.type === "magic-word"
          ? "parserFunction"
          : "argument";
    this.invocationSequence++;
    const draft: InvocationDraft = {
      id: `call-${this.invocationSequence}`,
      kind,
      name: stringProp(node, "name") ?? "",
      scopeId: frame.scopeId,
      ...(context.parentInvocationId === undefined ? {} : { parentId: context.parentInvocationId }),
      sourceId: frame.source.id,
      start: node.range[0],
      end: node.range[1],
      status: "expanded",
    };
    this.invocations.push(draft);

    const depth = context.depth + 1;
    if (depth > this.context.maxDepth) {
      return this.budgetFailure(
        "DEPTH_BUDGET_EXCEEDED",
        `Template expansion depth exceeds the limit of ${this.context.maxDepth}.`,
        draft,
        frame,
        node,
      );
    }
    if (this.exhausted) {
      draft.status = "preserved";
      draft.reason = "INVOCATION_BUDGET_EXCEEDED";
      this.unresolved = true;
      return tagInvocation(this.preserve(frame, node), draft.id);
    }
    if (this.invocationsUsed >= this.context.maxInvocations) {
      this.exhausted = true;
      return this.budgetFailure(
        "INVOCATION_BUDGET_EXCEEDED",
        `Template expansion reached the invocation limit of ${this.context.maxInvocations}.`,
        draft,
        frame,
        node,
      );
    }
    this.invocationsUsed++;

    const inner: CallContext = { depth, parentInvocationId: draft.id };
    const raw =
      node.type === "template"
        ? this.evaluateTemplate(node, frame, draft, inner)
        : node.type === "magic-word"
          ? this.evaluateMagicWord(node, frame, draft, inner)
          : this.evaluateArgument(node, frame, draft, inner, previousChar);

    const text = outputText(raw);
    let output = raw;
    if (node.type !== "arg" && implicitNewline(text, previousChar, node.type === "template")) {
      const newline = generatedOutput("\n", this.span(frame, node));
      output = concatOutputs([newline, raw]);
    }
    const length = outputLength(output);
    this.produced += length;
    if (this.produced > this.context.maxLength) {
      // 单次结果超限是可恢复失败：保留调用原文并记录诊断。
      // 整次输出仍然超过硬上限时由编译器统一失败。
      return this.budgetFailure(
        "LENGTH_BUDGET_EXCEEDED",
        `Template expansion exceeds the length limit of ${this.context.maxLength}.`,
        draft,
        frame,
        node,
      );
    }

    const tagged = tagInvocation(output, draft.id);
    return {
      ...tagged,
      marks: [{ invocationId: draft.id, start: 0, end: length }, ...tagged.marks],
    };
  }

  private evaluateTemplate(
    node: WikitextSyntaxNode,
    frame: Frame,
    draft: InvocationDraft,
    context: CallContext,
  ): WikitextOutput {
    const modifier = stringProp(node, "modifier") ?? "";
    if (modifier) {
      return this.recover(
        "UNSUPPORTED_CALL",
        "UNSUPPORTED_CALL",
        `Transclusion modifier "${modifier}" is not supported.`,
        draft,
        frame,
        node,
      );
    }

    const name = this.resolveTemplateName(node, frame, draft, context);
    if (!name) {
      return this.preserve(frame, node);
    }
    draft.name = name.title ?? name.text;
    if (!name.title) {
      return this.recover(
        "TEMPLATE_NOT_FOUND",
        "TEMPLATE_NOT_FOUND",
        `Template "${name.text}" could not be resolved to a valid title.`,
        draft,
        frame,
        node,
      );
    }
    const title = name.title;
    draft.templateTitle = title;
    if (frame.ancestors.includes(title)) {
      return this.recover(
        "TEMPLATE_LOOP",
        "TEMPLATE_LOOP",
        `Template loop detected: ${title}.`,
        draft,
        frame,
        node,
        title,
      );
    }

    const program = this.context.program(title);
    if (!program) {
      const failure = this.context.failure(title);
      if (failure) {
        return this.recover(
          failure.code,
          failure.code,
          failure.message,
          draft,
          frame,
          node,
          title,
          failure.cause,
        );
      }
      this.context.demand({
        title,
        location: this.span(frame, node),
        ...(frame.title === undefined ? {} : { callerTitle: frame.title }),
      });
      this.unresolved = true;
      return EMPTY_OUTPUT;
    }

    const args: ArgumentScope = {
      bindings: this.buildBindings(node, frame),
      slots: new Map(),
      keysResolved: false,
    };
    const templateFrame: Frame = {
      source: program.source,
      syntax: program.syntax,
      title: program.title,
      pageName: program.title,
      ancestors: [...frame.ancestors, title],
      scopeId: `scope:${draft.id}`,
      parentInvocationId: draft.id,
      args,
    };
    const body = this.evaluateRange(
      templateFrame,
      program.syntax.range[0],
      program.syntax.range[1],
      program.syntax.children,
      { depth: context.depth, parentInvocationId: draft.id },
      "",
    );
    return body;
  }

  private resolveTemplateName(
    node: WikitextSyntaxNode,
    frame: Frame,
    draft: InvocationDraft,
    context: CallContext,
  ): { text: string; title?: string } | undefined {
    const nameNode = findChild(node, "template-name");
    if (!nameNode) {
      return { text: "" };
    }
    const dynamic = nameNode.children.some(isCallNode);
    if (!dynamic) {
      const text = stripComments(
        frame.source.text.slice(nameNode.range[0], nameNode.range[1]),
      ).trim();
      const parsed = stringProp(node, "name");
      const title = parsed === undefined ? text : parsed;
      return { text, ...(title ? { title } : {}) };
    }
    const evaluated = this.evaluateRange(
      frame,
      nameNode.range[0],
      nameNode.range[1],
      nameNode.children,
      context,
      "",
    );
    if (evaluated.unresolved) {
      this.recover(
        "UNRESOLVED_DEPENDENCY",
        "UNRESOLVED_DEPENDENCY",
        "The template name depends on a call that could not be expanded.",
        draft,
        frame,
        node,
      );
      return undefined;
    }
    const text = stripComments(outputText(evaluated)).trim();
    if (!text) {
      return { text };
    }
    const title = this.context.normalizeTitle(text, frame.pageName ?? this.context.pageName);
    return { text, ...(title ? { title } : {}) };
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
            (keyNode
              ? stripComments(caller.source.text.slice(keyNode.range[0], keyNode.range[1])).trim()
              : "");
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
  private resolveArgument(
    frame: Frame,
    name: string,
    draft: InvocationDraft,
    context: CallContext,
  ): ArgumentSlot | undefined {
    const args = frame.args;
    if (!args) {
      return undefined;
    }
    if (!args.keysResolved) {
      args.keysResolved = true;
      for (const binding of args.bindings) {
        let key = binding.key;
        if (binding.keyNode) {
          const evaluated = this.evaluateRange(
            binding.caller,
            binding.keyNode.range[0],
            binding.keyNode.range[1],
            binding.keyNode.children,
            context,
            "",
          );
          if (evaluated.unresolved) {
            this.diagnose(
              "UNRESOLVED_DEPENDENCY",
              "warning",
              "A template parameter name depends on a call that could not be expanded.",
              this.callSpan(binding.caller, binding.keyNode.range[0], binding.keyNode.range[1]),
              { invocationId: draft.id },
            );
            this.unresolved = true;
            continue;
          }
          key = stripComments(outputText(evaluated)).trim();
        }
        if (key !== undefined) {
          // 与站点一致：后出现的同名参数覆盖先前的，包括具名覆盖匿名。
          args.slots.set(key, {
            node: binding.valueNode,
            frame: binding.caller,
            trim: binding.trim,
          });
        }
      }
    }
    return args.slots.get(name);
  }

  private evaluateArgument(
    node: WikitextSyntaxNode,
    frame: Frame,
    draft: InvocationDraft,
    context: CallContext,
    previousChar: string,
  ): WikitextOutput {
    const nameNode = findChild(node, "arg-name");
    let name = "";
    if (nameNode) {
      if (nameNode.children.some(isCallNode)) {
        const evaluated = this.evaluateRange(
          frame,
          nameNode.range[0],
          nameNode.range[1],
          nameNode.children,
          context,
          "",
        );
        if (evaluated.unresolved) {
          return this.recover(
            "UNRESOLVED_DEPENDENCY",
            "UNRESOLVED_DEPENDENCY",
            "The argument name depends on a call that could not be expanded.",
            draft,
            frame,
            node,
          );
        }
        name = stripComments(outputText(evaluated)).trim();
      } else {
        name = stripComments(frame.source.text.slice(nameNode.range[0], nameNode.range[1])).trim();
      }
    }
    draft.name = name;

    const slot = this.resolveArgument(frame, name, draft, context);
    if (slot) {
      if (slot.cached === undefined) {
        slot.cached = this.evaluateNode(
          slot.node,
          slot.frame,
          {
            depth: context.depth,
            ...(context.parentInvocationId === undefined
              ? {}
              : { parentInvocationId: context.parentInvocationId }),
          },
          ARGUMENT_PREVIOUS_CHAR,
        );
      }
      return slot.trim ? trimOutput(slot.cached) : slot.cached;
    }

    const defaultNode = findChild(node, "arg-default");
    if (defaultNode) {
      return this.evaluateRange(
        frame,
        defaultNode.range[0],
        defaultNode.range[1],
        defaultNode.children,
        context,
        previousChar,
      );
    }
    // 既没有实参也没有默认值：原文保留，整次编译标记为 partial。
    draft.status = "preserved";
    draft.reason = "UNRESOLVED_DEPENDENCY";
    this.unresolved = true;
    return { ...this.preserve(frame, node), unresolved: true };
  }

  private evaluateMagicWord(
    node: WikitextSyntaxNode,
    frame: Frame,
    draft: InvocationDraft,
    context: CallContext,
  ): WikitextOutput {
    const name = (stringProp(node, "name") ?? "").toLowerCase();
    const modifier = stringProp(node, "modifier") ?? "";
    draft.name = name;
    if (modifier) {
      return this.recover(
        "UNSUPPORTED_CALL",
        "UNSUPPORTED_CALL",
        `Magic word modifier "${modifier}" is not supported.`,
        draft,
        frame,
        node,
      );
    }
    if (name === "!") {
      return generatedOutput("|", this.span(frame, node));
    }
    if (name === "=") {
      return generatedOutput("=", this.span(frame, node));
    }
    if (!MAGIC_WORD_FUNCTIONS.has(name)) {
      return this.recover(
        "UNSUPPORTED_CALL",
        "UNSUPPORTED_CALL",
        `Parser function "${name || "unknown"}" is not supported.`,
        draft,
        frame,
        node,
      );
    }

    const anchor = this.span(frame, node);
    const params = node.children.filter((child) => child.type === "parameter");
    const values = new Map<WikitextSyntaxNode, WikitextOutput>();
    const read = (param: WikitextSyntaxNode | undefined): WikitextOutput => {
      if (!param) {
        return EMPTY_OUTPUT;
      }
      const cached = values.get(param);
      if (cached) {
        return cached;
      }
      const output = this.evaluateNode(param, frame, context, "");
      values.set(param, output);
      return output;
    };
    const readValue = (param: WikitextSyntaxNode | undefined): WikitextOutput =>
      trimOutput(read(param));
    const readText = (param: WikitextSyntaxNode | undefined): WikitextOutput => {
      const output = read(param);
      const text = stripRawExtensions(stripComments(outputText(output))).trim();
      return transformOutput(text, anchor, output.unresolved);
    };
    const readArg = (index: number): string | undefined => {
      const output = readText(params[index]);
      return output.unresolved ? undefined : outputText(output);
    };
    const readNumberArg = (index: number, fallback = 0): number | undefined => {
      const text = readArg(index);
      if (text === undefined) {
        return undefined;
      }
      const value = Number.parseInt(text.trim(), 10);
      return Number.isFinite(value) ? value : fallback;
    };
    const dependency = (): WikitextOutput =>
      this.recover(
        "UNRESOLVED_DEPENDENCY",
        "UNRESOLVED_DEPENDENCY",
        "The parser function depends on a call that could not be expanded.",
        draft,
        frame,
        node,
      );
    const result = (text: string, unresolved = false): WikitextOutput =>
      transformOutput(text, anchor, unresolved);

    if (name === "if") {
      if (params.length <= 1) {
        return EMPTY_OUTPUT;
      }
      const condition = readText(params[0]);
      if (condition.unresolved) {
        return dependency();
      }
      const branch = decodeHTML(outputText(condition)) ? params[1] : params[2];
      return readValue(branch);
    }

    if (name === "ifeq") {
      if (params.length < 3) {
        return EMPTY_OUTPUT;
      }
      const left = readText(params[0]);
      if (left.unresolved) {
        return dependency();
      }
      const right = readText(params[1]);
      if (right.unresolved) {
        return dependency();
      }
      const branch = htmlEqual(outputText(left), outputText(right)) ? params[2] : params[3];
      return readValue(branch);
    }

    if (name === "iferror") {
      const condition = readValue(params[0]);
      if (condition.unresolved) {
        return dependency();
      }
      const text = outputText(condition);
      const detection = stripRawExtensions(stripComments(text));
      if (isErrorOutput(decodeHTML(detection))) {
        return readValue(params[1]);
      }
      if (params.length >= 3) {
        return readValue(params[2]);
      }
      return condition;
    }

    if (name === "expr") {
      const text = readArg(0);
      if (text === undefined) {
        return dependency();
      }
      const value = evaluateExpression(decodeHTML(text));
      if (value === undefined) {
        this.hadErrorOutput = true;
        this.diagnose(
          "EXPRESSION_ERROR",
          "warning",
          `Expression could not be evaluated: ${text}`,
          anchor,
          { invocationId: draft.id },
        );
        return result(errorOutput(`Expression error: ${text}`));
      }
      return result(value);
    }

    if (name === "ifexpr") {
      const text = readArg(0);
      if (text === undefined) {
        return dependency();
      }
      const value = evaluateExpression(decodeHTML(text));
      if (value === undefined) {
        this.hadErrorOutput = true;
        this.diagnose(
          "EXPRESSION_ERROR",
          "warning",
          `Expression could not be evaluated: ${text}`,
          anchor,
          { invocationId: draft.id },
        );
        return result(errorOutput(`Expression error: ${text}`));
      }
      const branch = Number(value) !== 0 ? params[1] : params[2];
      return readValue(branch);
    }

    if (name === "len") {
      const text = readArg(0);
      if (text === undefined) {
        return dependency();
      }
      return result(String(codePointLength(text)));
    }

    if (name === "sub") {
      const text = readArg(0);
      if (text === undefined) {
        return dependency();
      }
      const start = readNumberArg(1);
      if (start === undefined) {
        return dependency();
      }
      const lengthText = readArg(2);
      if (lengthText === undefined) {
        return dependency();
      }
      const length = lengthText ? Number.parseInt(lengthText.trim(), 10) : undefined;
      return result(
        substring(
          text,
          start,
          length !== undefined && Number.isFinite(length) ? length : undefined,
        ),
      );
    }

    if (name === "replace") {
      const text = readArg(0);
      const from = readArg(1);
      const to = readArg(2);
      if (text === undefined || from === undefined || to === undefined) {
        return dependency();
      }
      const limitText = readArg(3);
      const limit = limitText ? Number.parseInt(limitText.trim(), 10) : -1;
      return result(replaceText(text, from, to, Number.isFinite(limit) ? limit : -1));
    }

    if (name === "titleparts") {
      const text = readArg(0);
      if (text === undefined) {
        return dependency();
      }
      const count = readNumberArg(1) ?? 0;
      const first = readNumberArg(2) ?? 0;
      return result(titleParts(text, count, first));
    }

    if (name === "padleft" || name === "padright") {
      const text = readArg(0);
      if (text === undefined) {
        return dependency();
      }
      const length = readNumberArg(1) ?? 0;
      const padding = readArg(2) ?? "0";
      return result(pad(text, length, padding, name === "padleft" ? "left" : "right"));
    }

    if (name === "urlencode" || name === "urldecode") {
      const text = readArg(0);
      if (text === undefined) {
        return dependency();
      }
      return result(name === "urlencode" ? urlEncode(text) : urlDecode(text));
    }

    if (
      name === "lc" ||
      name === "uc" ||
      name === "lcfirst" ||
      name === "ucfirst" ||
      name === "trim"
    ) {
      const text = readArg(0);
      if (text === undefined) {
        return dependency();
      }
      const characters = Array.from(text);
      const first = characters[0] ?? "";
      const rest = characters.slice(1).join("");
      const value =
        name === "lc"
          ? text.toLowerCase()
          : name === "uc"
            ? text.toUpperCase()
            : name === "lcfirst"
              ? first.toLowerCase() + rest
              : name === "ucfirst"
                ? first.toUpperCase() + rest
                : text.trim();
      return result(value);
    }

    if (name === "tag") {
      const tagName = readArg(0);
      if (tagName === undefined) {
        return dependency();
      }
      const content = readValue(params[1]);
      if (content.unresolved) {
        return dependency();
      }
      const attributes: Array<{ name: string; value: string }> = [];
      for (const param of params.slice(2)) {
        const key = stringProp(param, "name");
        if (!key) {
          continue;
        }
        const value = readValue(findChild(param, "parameter-value"));
        if (value.unresolved) {
          return dependency();
        }
        attributes.push({ name: key, value: outputText(value) });
      }
      const output = tagOutput(tagName.trim(), outputText(content), attributes);
      if (output === undefined) {
        return this.recover(
          "UNSUPPORTED_CALL",
          "UNSUPPORTED_CALL",
          `#tag received an invalid tag name: ${tagName}`,
          draft,
          frame,
          node,
        );
      }
      return result(output);
    }

    return this.evaluateSwitch(params, readText, readValue, dependency);
  }

  private evaluateSwitch(
    params: readonly WikitextSyntaxNode[],
    readText: (param: WikitextSyntaxNode | undefined) => WikitextOutput,
    readValue: (param: WikitextSyntaxNode | undefined) => WikitextOutput,
    dependency: () => WikitextOutput,
  ): WikitextOutput {
    if (params.length <= 1) {
      return EMPTY_OUTPUT;
    }
    const condition = readText(params[0]);
    if (condition.unresolved) {
      return dependency();
    }
    const value = outputText(condition);

    const readSwitchValue = (param: WikitextSyntaxNode): WikitextOutput =>
      param.props.anon === true ? readValue(param) : readValue(findChild(param, "parameter-value"));

    let defaultParam: WikitextSyntaxNode | undefined;
    let found: 0 | 1 | 2 | 3 = 0;
    for (let index = 1; index < params.length; index++) {
      const param = params[index]!;
      if (param.props.anon === true) {
        if (index === params.length - 1) {
          return readValue(param);
        }
        const item = readText(param);
        if (item.unresolved) {
          found = 3;
          continue;
        }
        const text = outputText(item);
        if (text === "#default" && found < 2) {
          found = 1;
          continue;
        }
        if (htmlEqual(text, value)) {
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
      const key = readText(findChild(param, "parameter-key"));
      if (key.unresolved) {
        return dependency();
      }
      const text = outputText(key);
      if (htmlEqual(text, value)) {
        return readSwitchValue(param);
      }
      if (found === 1 || text.toLowerCase() === "#default") {
        defaultParam = param;
        found = 0;
      }
    }
    if (defaultParam) {
      return readSwitchValue(defaultParam);
    }
    return EMPTY_OUTPUT;
  }
}
