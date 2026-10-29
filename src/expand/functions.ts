/**
 * `/expand` 使用的纯函数工具：表达式求值、字符串处理与 `#tag` 输出构造。
 * 这里不做解析、不访问站点状态，也不产生诊断；调用方负责把失败转成诊断。
 */

class ExpressionError extends Error {}

interface Token {
  readonly kind: "number" | "identifier" | "operator" | "paren";
  readonly value: string;
}

const OPERATORS = ["<>", "!=", "<=", ">=", "=", "<", ">", "+", "-", "*", "/", "^", "(", ")", ","];
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)/u;

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const rest = input.slice(index);
    const whitespace = /^\s+/u.exec(rest);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }
    const number = NUMBER.exec(rest);
    if (number) {
      tokens.push({ kind: "number", value: number[0] });
      index += number[0].length;
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(rest);
    if (identifier) {
      tokens.push({ kind: "identifier", value: identifier[0].toLowerCase() });
      index += identifier[0].length;
      continue;
    }
    const operator = OPERATORS.find((candidate) => rest.startsWith(candidate));
    if (operator) {
      tokens.push({
        kind: operator === "(" || operator === ")" ? "paren" : "operator",
        value: operator,
      });
      index += operator.length;
      continue;
    }
    throw new ExpressionError(`Unexpected character "${rest[0] ?? ""}" in expression.`);
  }
  return tokens;
}

type TokenReader = { peek: () => Token | undefined; next: () => Token | undefined };

function reader(tokens: readonly Token[]): TokenReader {
  let index = 0;
  return {
    peek: () => tokens[index],
    next: () => tokens[index++],
  };
}

function expectParen(source: TokenReader, value: string): void {
  const token = source.next();
  if (!token || token.value !== value) {
    throw new ExpressionError(`Expected "${value}".`);
  }
}

function binary(
  source: TokenReader,
  operators: readonly string[],
  operand: (source: TokenReader) => number,
): number {
  let left = operand(source);
  for (;;) {
    const token = source.peek();
    if (!token || (token.kind !== "identifier" && token.kind !== "operator")) {
      return left;
    }
    if (!operators.includes(token.value)) {
      return left;
    }
    source.next();
    const right = operand(source);
    switch (token.value) {
      case "+":
        left += right;
        break;
      case "-":
        left -= right;
        break;
      case "*":
        left *= right;
        break;
      case "/":
        if (right === 0) {
          throw new ExpressionError("Division by zero.");
        }
        left /= right;
        break;
      case "^":
        left **= right;
        break;
      case "mod":
      case "%":
        if (right === 0) {
          throw new ExpressionError("Division by zero.");
        }
        left %= right;
        break;
      case "div":
        if (right === 0) {
          throw new ExpressionError("Division by zero.");
        }
        left = Math.trunc(left / right);
        break;
      case "round": {
        const factor = 10 ** Math.max(0, Math.trunc(right));
        left = Math.round(left * factor) / factor;
        break;
      }
      case "=":
        left = Number(left === right);
        break;
      case "<>":
      case "!=":
        left = Number(left !== right);
        break;
      case "<":
        left = Number(left < right);
        break;
      case ">":
        left = Number(left > right);
        break;
      case "<=":
        left = Number(left <= right);
        break;
      case ">=":
        left = Number(left >= right);
        break;
      case "and":
        left = Number(left !== 0 && right !== 0);
        break;
      case "or":
        left = Number(left !== 0 || right !== 0);
        break;
      default:
        throw new ExpressionError(`Unsupported operator "${token.value}".`);
    }
  }
}

const UNARY_FUNCTIONS: Readonly<Record<string, (value: number) => number>> = {
  abs: Math.abs,
  ceil: Math.ceil,
  floor: Math.floor,
  ln: Math.log,
  exp: Math.exp,
  sqrt: Math.sqrt,
  trunc: Math.trunc,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
};

function primary(source: TokenReader): number {
  const token = source.next();
  if (!token) {
    throw new ExpressionError("Unexpected end of expression.");
  }
  if (token.kind === "number") {
    return Number(token.value);
  }
  if (token.value === "(") {
    const value = orExpression(source);
    expectParen(source, ")");
    return value;
  }
  if (token.value === "-") {
    return -primary(source);
  }
  if (token.value === "+") {
    return primary(source);
  }
  if (token.kind === "identifier") {
    if (token.value === "pi") {
      return Math.PI;
    }
    if (token.value === "e") {
      return Math.E;
    }
    if (token.value === "not") {
      return Number(primary(source) === 0);
    }
    const fn = UNARY_FUNCTIONS[token.value];
    if (fn) {
      expectParen(source, "(");
      const value = fn(orExpression(source));
      expectParen(source, ")");
      return value;
    }
  }
  throw new ExpressionError(`Unexpected token "${token.value}".`);
}

function powerExpression(source: TokenReader): number {
  const left = primary(source);
  const token = source.peek();
  if (token?.value === "^") {
    source.next();
    return left ** powerExpression(source);
  }
  return left;
}

function productExpression(source: TokenReader): number {
  return binary(source, ["*", "/", "mod", "div", "%", "round"], powerExpression);
}

function sumExpression(source: TokenReader): number {
  return binary(source, ["+", "-"], productExpression);
}

function comparisonExpression(source: TokenReader): number {
  return binary(source, ["=", "<>", "!=", "<", ">", "<=", ">="], sumExpression);
}

function andExpression(source: TokenReader): number {
  return binary(source, ["and"], comparisonExpression);
}

function orExpression(source: TokenReader): number {
  return binary(source, ["or"], andExpression);
}

/** 把结果格式化为紧凑的十进制字符串。 */
export function formatExpressionNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new ExpressionError("The result is not a finite number.");
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Number(value.toPrecision(14)));
}

/** 求值 `#expr` 表达式；语法或数学错误返回 undefined。 */
export function evaluateExpression(input: string): string | undefined {
  try {
    const source = reader(tokenize(input));
    const value = orExpression(source);
    if (source.peek()) {
      throw new ExpressionError("Unexpected trailing tokens.");
    }
    return formatExpressionNumber(value);
  } catch (error) {
    if (error instanceof ExpressionError) {
      return undefined;
    }
    return undefined;
  }
}

/** `#titleparts`：按 `/` 切分并取指定区段；`first` 为 1 基，负数从末尾计数。 */
export function titleParts(input: string, count: number, first: number): string {
  const parts = input.split("/");
  const start = first < 0 ? Math.max(0, parts.length + first) : Math.max(0, first - 1);
  if (count === 0) {
    return parts.slice(start).join("/");
  }
  const end = count < 0 ? Math.max(start, parts.length + count) : start + count;
  return parts.slice(start, end).join("/");
}

/** `#sub`：按 UTF-16 下标截取；长度省略时取到结尾。 */
export function substring(input: string, start: number, length?: number): string {
  const from = start < 0 ? Math.max(0, input.length + start) : start;
  return length === undefined ? input.slice(from) : input.slice(from, from + length);
}

/** `#padleft` / `#padright`：用指定填充字符补到目标长度。 */
export function pad(
  input: string,
  length: number,
  padding: string,
  side: "left" | "right",
): string {
  if (input.length >= length || !padding) {
    return input;
  }
  const paddingValue = padding
    .repeat(Math.ceil((length - input.length) / padding.length))
    .slice(0, length - input.length);
  return side === "left" ? `${paddingValue}${input}` : `${input}${paddingValue}`;
}

/** `#urlencode`：使用与浏览器一致的标准百分号编码。 */
export function urlEncode(input: string): string {
  return encodeURIComponent(input);
}

/** `#urldecode`：非法序列保留原文。 */
export function urlDecode(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

const TAG_NAME = /^[A-Za-z][A-Za-z0-9]*$/u;
const TAG_ATTRIBUTE = /^[A-Za-z][A-Za-z0-9-]*$/u;

/**
 * 构造 `#tag` 的 wikitext 输出；标签名非法时返回 undefined。
 * 内容与属性值都按 wikitext 处理，之后仍会经过正常解析与清洗。
 */
export function tagOutput(
  name: string,
  content: string,
  attributes: ReadonlyArray<{ readonly name: string; readonly value: string }>,
): string | undefined {
  const tag = name.trim();
  if (!TAG_NAME.test(tag)) {
    return undefined;
  }
  const rendered = attributes
    .map((attribute) => ({ name: attribute.name.trim(), value: attribute.value }))
    .filter((attribute) => TAG_ATTRIBUTE.test(attribute.name))
    .map((attribute) => ` ${attribute.name}="${attribute.value.replace(/"/gu, "&quot;")}"`);
  return `<${tag}${rendered.join("")}>${content}</${tag}>`;
}
