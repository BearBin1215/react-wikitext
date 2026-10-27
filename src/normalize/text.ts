import { decodeHTML } from "entities";

const PARAGRAPH_BREAK = /\n[ \t]*\n(?:[ \t]*\n)*/u;

/** 按空行切分 text token；单个换行折叠为空格。 */
export function splitParagraphText(text: string): string[] {
  return text.split(PARAGRAPH_BREAK);
}

export function normalizeInlineText(text: string): string {
  return text.replace(/\n/gu, " ");
}

/** 语义文本只在这里解码一次实体；后续 HAST 与 React 阶段不再解码。 */
export function decodeText(text: string): string {
  return decodeHTML(normalizeInlineText(text));
}

export function decodeRawText(text: string): string {
  return decodeHTML(text);
}
