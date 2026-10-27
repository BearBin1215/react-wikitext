import type {
  WikitextFile,
  WikitextFileParameter,
  WikitextNode,
  WikitextParserFunction,
  WikitextTemplate,
  WikitextTemplateParameter,
} from "./model";
import { toPlainText } from "./query";
import {
  FILE_ALIGNMENT_NAMES,
  FILE_FLAG_NAMES,
  FILE_FORMAT_NAMES,
  FILE_VERTICAL_ALIGNMENT_NAMES,
} from "./file-options";

/** 模板参数在渲染时使用的信息。 */
export interface WikitextParameter {
  /** 对应的语义参数节点。 */
  readonly node: WikitextTemplateParameter;
  /** 参数名；匿名参数为上游给出的名称（通常为空）。 */
  readonly name: string;
  /** 是否为匿名参数。 */
  readonly anonymous: boolean;
  /** 同名匿名参数中的序号（从 1 开始）。 */
  readonly index?: number;
}

/** 读取模板或解析器函数的全部参数；返回真实的可遍历子节点。 */
export function getTemplateParameters(
  node: WikitextTemplate | WikitextParserFunction,
): readonly WikitextParameter[] {
  const parameters: WikitextParameter[] = [];
  for (const child of node.children) {
    if (child.type !== "templateParameter") {
      continue;
    }
    parameters.push({
      node: child,
      name: child.name,
      anonymous: child.anonymous,
      ...(child.index === undefined ? {} : { index: child.index }),
    });
  }
  return parameters;
}

const WIDTH_VALUE = /^(\d+)(?:x(\d+))?(?:px)?$/iu;

/** 文件节点派生出的渲染信息。 */
export interface WikitextFileInfo {
  /** 对应的语义节点。 */
  readonly node: WikitextFile;
  /** 去掉命名空间前缀的文件名。 */
  readonly name: string;
  /** 原始参数列表。 */
  readonly parameters: readonly WikitextFileParameter[];
  /** 说明文字的纯文本。 */
  readonly caption?: string;
  /** 说明文字对应的语义节点。 */
  readonly captionNodes: readonly WikitextNode[];
  readonly alt?: string;
  readonly link?: string;
  readonly lang?: string;
  readonly page?: string;
  readonly className?: string;
  /** upright 参数换算出的缩放倍数。 */
  readonly upright?: number;
  /** 宽度（像素）。 */
  readonly width?: number;
  /** 高度（像素）。 */
  readonly height?: number;
  /** 显示格式，例如 thumbnail、framed。 */
  readonly format?: string;
  /** 水平对齐方式。 */
  readonly alignment?: string;
  /** 垂直对齐方式。 */
  readonly verticalAlignment?: string;
  /** 是否带边框。 */
  readonly border: boolean;
}

/** 从语义 file 节点派生渲染信息，不重复保存说明文字子树。 */
export function getFileParameters(file: WikitextFile): WikitextFileInfo {
  const parameters = file.parameters;
  const find = (name: string): WikitextFileParameter | undefined => {
    for (let index = parameters.length - 1; index >= 0; index--) {
      if (parameters[index]!.name === name) {
        return parameters[index];
      }
    }
    return undefined;
  };
  const names = parameters.map((parameter) => parameter.name);
  // 与具名参数一致：后写的同义关键字覆盖先写的。
  const lastMatch = (candidates: ReadonlySet<string>): string | undefined => {
    for (let index = names.length - 1; index >= 0; index--) {
      const name = names[index]!;
      if (candidates.has(name)) {
        return name;
      }
    }
    return undefined;
  };

  const widthParameter = find("width");
  const widthMatch = widthParameter ? WIDTH_VALUE.exec(widthParameter.value.trim()) : null;
  const width = widthMatch?.[1] ? Number(widthMatch[1]) : undefined;
  const height = widthMatch?.[2] ? Number(widthMatch[2]) : undefined;
  const uprightValue = find("upright")?.value ?? "";
  const upright = uprightValue ? Number.parseFloat(uprightValue) : undefined;
  const alt = find("alt");
  const link = find("link");
  const lang = find("lang");
  const page = find("page");
  const className = find("class");
  const format = lastMatch(FILE_FORMAT_NAMES);
  const alignment = lastMatch(FILE_ALIGNMENT_NAMES);
  const verticalAlignment = lastMatch(FILE_VERTICAL_ALIGNMENT_NAMES);
  const caption =
    file.captionKind === "none"
      ? undefined
      : file.children.map((child) => toPlainText(child)).join("");

  return {
    node: file,
    name: file.name,
    parameters,
    ...(caption === undefined ? {} : { caption }),
    captionNodes: file.children,
    ...(alt ? { alt: alt.value } : {}),
    ...(link ? { link: link.value } : {}),
    ...(lang ? { lang: lang.value } : {}),
    ...(page ? { page: page.value } : {}),
    ...(className ? { className: className.value } : {}),
    ...(upright !== undefined && Number.isFinite(upright) ? { upright } : {}),
    ...(width !== undefined && Number.isFinite(width) ? { width } : {}),
    ...(height !== undefined && Number.isFinite(height) ? { height } : {}),
    ...(format ? { format } : {}),
    ...(alignment ? { alignment } : {}),
    ...(verticalAlignment ? { verticalAlignment } : {}),
    border: names.some((name) => FILE_FLAG_NAMES.has(name)),
  };
}
