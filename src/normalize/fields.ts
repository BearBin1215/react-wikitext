import type {
  WikitextAttribute,
  WikitextFileCaptionKind,
  WikitextFileParameter,
  WikitextSyntaxNode,
} from "../ast/model";
import { decodeRawText, decodeText } from "./text";
import { FILE_KEY_VALUE_KEYS } from "../ast/file-options";
import { nodeLocation, type NormalizeContext } from "./context";

export function syntaxAttributes(node: WikitextSyntaxNode): readonly WikitextAttribute[] {
  return node.attributes.map(({ name, value }) => ({ name, value }));
}

/** 拼接 token 子树中纯文本节点的 data；其他标记子节点忽略。 */
export function syntaxText(node: WikitextSyntaxNode | undefined): string {
  if (!node) {
    return "";
  }
  if (node.type === "text") {
    return typeof node.props.data === "string" ? node.props.data : "";
  }
  return node.children.map((child) => syntaxText(child)).join("");
}

function syntaxRaw(context: NormalizeContext, node: WikitextSyntaxNode | undefined): string {
  return node ? context.source.slice(node.range[0], node.range[1]) : "";
}

/** 读取 token 的纯文本内容并做一次实体解码。 */
export function syntaxTextDecoded(node: WikitextSyntaxNode | undefined): string {
  return decodeText(syntaxText(node));
}

export function syntaxRawDecoded(
  context: NormalizeContext,
  node: WikitextSyntaxNode | undefined,
): string {
  return decodeRawText(syntaxRaw(context, node));
}

export function splitTarget(target: string): { page?: string; fragment?: string } {
  const hash = target.indexOf("#");
  if (hash < 0) {
    return target ? { page: target } : {};
  }
  const page = target.slice(0, hash);
  const fragment = target.slice(hash + 1);
  return {
    ...(page ? { page } : {}),
    ...(fragment ? { fragment } : {}),
  };
}

export function childOfType(
  node: WikitextSyntaxNode | undefined,
  type: string,
): WikitextSyntaxNode | undefined {
  return node?.children.find((child) => child.type === type);
}

/** 允许键两侧出现空白；键必须来自文件参数词表。 */
const KEY_VALUE = /^[ \t]*([A-Za-z][\w-]*)[ \t]*=[ \t]*(.*)$/su;

interface ParsedFileParameter {
  readonly name: string;
  readonly value: string;
  readonly explicit: boolean;
  readonly syntax: WikitextSyntaxNode;
  /** 正文作为说明文字时的内容节点与需要剥掉的键前缀长度。 */
  readonly caption?: { readonly prefixLength: number };
}

interface ParsedFileData {
  readonly name: string;
  readonly parameters: readonly WikitextFileParameter[];
  readonly captionKind: WikitextFileCaptionKind;
  readonly captionNodes: readonly WikitextSyntaxNode[];
  readonly captionPrefixLength: number;
}

function parseFileParameter(
  context: NormalizeContext,
  parameter: WikitextSyntaxNode,
): ParsedFileParameter {
  const parserName = typeof parameter.props.name === "string" ? parameter.props.name : "";
  const raw = syntaxRaw(context, parameter);
  if (parserName === "caption") {
    const match = KEY_VALUE.exec(raw);
    const key = match?.[1]?.toLowerCase();
    if (match && key && FILE_KEY_VALUE_KEYS.has(key)) {
      return {
        name: key,
        value: decodeRawText(match[2] ?? "").trim(),
        explicit: true,
        syntax: parameter,
        ...(key === "caption"
          ? { caption: { prefixLength: match[0].length - (match[2]?.length ?? 0) } }
          : {}),
      };
    }
    return {
      name: "caption",
      value: decodeRawText(raw).trim(),
      explicit: false,
      syntax: parameter,
    };
  }
  const equals = raw.indexOf("=");
  return {
    name: parserName,
    value: decodeRawText(equals >= 0 ? raw.slice(equals + 1) : raw).trim(),
    explicit: equals >= 0,
    syntax: parameter,
  };
}

export function parseFileData(context: NormalizeContext, file: WikitextSyntaxNode): ParsedFileData {
  const parsed: ParsedFileParameter[] = [];
  for (const child of file.children) {
    if (child.type === "image-parameter") {
      parsed.push(parseFileParameter(context, child));
    }
  }

  const captions = parsed.filter((parameter) => parameter.name === "caption");
  const explicitCaptions = captions.filter((parameter) => parameter.explicit);
  const unnamedCaptions = captions.filter((parameter) => !parameter.explicit);
  const caption = explicitCaptions.at(-1) ?? unnamedCaptions.at(-1);

  const parameters = parsed
    .filter((parameter) => parameter.name !== "caption")
    // oxlint-disable-next-line oxc/no-map-spread -- copy-on-write parameter records
    .map((parameter) => ({
      name: parameter.name,
      value: parameter.value,
      explicit: parameter.explicit,
      ...(parameter.syntax ? nodeLocation(context, { syntax: parameter.syntax }) : {}),
    }));

  const name = (typeof file.props.name === "string" ? file.props.name : "").replace(
    /^(?:File|Image):/iu,
    "",
  );

  if (!caption) {
    return { name, parameters, captionKind: "none", captionNodes: [], captionPrefixLength: 0 };
  }
  return {
    name,
    parameters,
    captionKind: caption.explicit ? "explicit" : "unnamed",
    captionNodes: caption.syntax.children,
    captionPrefixLength: caption.caption?.prefixLength ?? 0,
  };
}
