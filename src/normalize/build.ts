import type { WikitextDiagnostic, WikitextRoot, WikitextSyntaxRoot } from "../ast/model";
import { createNormalizeContext, nodeLocation } from "./context";
import { normalizeBlocks } from "./blocks";

interface BuildSemanticOptions {
  /** 块级嵌套深度预算；由解析器工厂根据有效 `maxDepth` 传入。 */
  readonly maxDepth?: number;
  /** 归一化阶段收集诊断的可写数组。 */
  readonly diagnostics?: WikitextDiagnostic[];
  /** 语义 origin 引用的文本源。 */
  readonly sourceId?: string;
}

/** 将普通源码语法树归一化为强类型 wiki 语义 AST。 */
export function buildSemanticTree(
  syntax: WikitextSyntaxRoot,
  source: string,
  options: BuildSemanticOptions = {},
): WikitextRoot {
  let context!: ReturnType<typeof createNormalizeContext>;
  context = createNormalizeContext(source, {
    ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
    ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics }),
    ...(options.sourceId === undefined ? {} : { sourceId: options.sourceId }),
    buildBlocks: (nodes, limit, depth) => normalizeBlocks(context, nodes, limit, depth),
  });
  const children = normalizeBlocks(context, syntax.children);
  return {
    type: "root",
    id: "",
    children,
    ...nodeLocation(context, { syntax }),
  };
}
