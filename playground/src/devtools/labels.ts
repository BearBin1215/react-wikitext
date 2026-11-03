/** 语法树面板的文案。 */
export interface AstTreeLabels {
  /** 展开节点的按钮文案。 */
  expand: string;
  /** 折叠节点的按钮文案。 */
  collapse: string;
  expandAll: string;
  collapseAll: string;
  /** 搜索框的标签。 */
  searchLabel: string;
  /** 搜索框的占位提示。 */
  searchPlaceholder: string;
  /** 没有匹配结果时的提示。 */
  noResults: string;
  /** 树的整体标签。 */
  treeLabel: string;
  /** 源码语法树的名称。 */
  syntaxTree: string;
  /** 文档没有保留源码语法树时的提示。 */
  noSyntax: string;
  /** 单个节点没有源码区间时的占位说明。 */
  noRange: string;
}

const DEFAULT_AST_TREE_LABELS: AstTreeLabels = {
  expand: "Expand",
  collapse: "Collapse",
  expandAll: "Expand all",
  collapseAll: "Collapse all",
  searchLabel: "Search nodes",
  searchPlaceholder: "Search nodes",
  noResults: "No matching nodes",
  treeLabel: "AST",
  syntaxTree: "Syntax tree",
  noSyntax: "Syntax tree was not retained for this document",
  noRange: "No source range",
};

/** 用传入的文案覆盖默认值。 */
export function resolveAstTreeLabels(labels?: Partial<AstTreeLabels>): AstTreeLabels {
  return labels ? { ...DEFAULT_AST_TREE_LABELS, ...labels } : DEFAULT_AST_TREE_LABELS;
}

/** 节点检查器的文案。 */
export interface NodeInspectorLabels {
  copyJson: string;
  copySource: string;
  copied: string;
  copyFailed: string;
  /** 未选中节点时的提示。 */
  noSelection: string;
  /** 语法节点属性分组的标题。 */
  props: string;
  /** 语法节点属性列表分组的标题。 */
  attributes: string;
  /** 源码分组的标题。 */
  source: string;
  /** 没有值的布尔属性的说明。 */
  booleanAttribute: string;
  /** 语义节点分组的标题。 */
  semanticValue: string;
  /** 生成内容没有源码时的说明。 */
  generated: string;
}

const DEFAULT_NODE_INSPECTOR_LABELS: NodeInspectorLabels = {
  copyJson: "Copy JSON",
  copySource: "Copy source",
  copied: "Copied",
  copyFailed: "Copy failed",
  noSelection: "Select a node to inspect it",
  props: "props",
  attributes: "attributes",
  source: "source",
  booleanAttribute: "(boolean)",
  semanticValue: "semantic value",
  generated: "Generated content",
};

/** 用传入的文案覆盖默认值。 */
export function resolveNodeInspectorLabels(
  labels?: Partial<NodeInspectorLabels>,
): NodeInspectorLabels {
  return labels ? { ...DEFAULT_NODE_INSPECTOR_LABELS, ...labels } : DEFAULT_NODE_INSPECTOR_LABELS;
}
