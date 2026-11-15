import { decodeHTML } from "entities";
import type { WikitextSyntaxNode } from "../ast/model";
import { EMPTY_OUTPUT, outputText, type WikitextOutput } from "../ast/sourceGraph/output";
import { findChild } from "./syntax";

/**
 * 比较两个输出文本；实体解码后再比较，纯数字按数值比较。
 * @param left 左侧文本。
 * @param right 右侧文本。
 */
export function htmlEqual(left: string, right: string): boolean {
  const a = decodeHTML(left);
  const b = decodeHTML(right);
  return a === b || (a !== "" && b !== "" && Number(a) === Number(b));
}

/**
 * `#switch` 的分支选择。
 *
 * 参数按 MediaWiki 规则顺序匹配：匿名参数是候选值，命名参数的键是候选值；
 * `#default` 在匹配失败后生效。任一候选值未解析时返回 `dependency()`。
 * @param params 调用参数（不含函数名）。
 * @param readText 读取并裁剪参数文本。
 * @param readValue 读取参数原文。
 * @param dependency 存在未解析依赖时生成保留输出。
 */
export function switchBranch(
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
