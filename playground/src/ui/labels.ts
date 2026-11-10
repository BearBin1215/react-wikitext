import type { AstTreeLabels, NodeInspectorLabels } from "react-wikitext/devtools";
import type { WikitextLabels } from "react-wikitext/view";
import type { LabelLanguage } from "@pg/state/options";

const ZH_WIKITEXT_LABELS: Partial<WikitextLabels> = {
  templateNotExpanded: "模板未展开",
  parserFunctionNotEvaluated: "解析器函数未求值",
  filePlaceholder: "文件",
  reference: "引用",
  unknownNode: "未支持节点",
  redirectTo: "重定向至",
  blockedLink: "已拦截的链接",
  blockedHtml: "已拦截的 HTML",
  renderFailed: "渲染失败",
  nestedTableUnsupported: "暂不支持嵌套表格",
};

const ZH_AST_TREE_LABELS: Partial<AstTreeLabels> = {
  expand: "展开",
  collapse: "折叠",
  expandAll: "展开全部",
  collapseAll: "折叠全部",
  searchLabel: "搜索节点",
  searchPlaceholder: "搜索节点",
  searchResults: "搜索结果",
  noResults: "没有匹配的节点",
  resultsTruncated: "还有更多匹配未显示，请缩小搜索范围",
  treeLabel: "语义树",
  syntaxTree: "语法树",
  noSyntax: "该文档未保留语法树",
  noRange: "没有源码区间",
};

const ZH_NODE_INSPECTOR_LABELS: Partial<NodeInspectorLabels> = {
  copyJson: "复制 JSON",
  copySource: "复制源码",
  copied: "已复制",
  copyFailed: "复制失败",
  regionLabel: "节点详情",
  noSelection: "选择一个节点查看详情",
  props: "属性 props",
  attributes: "属性 attributes",
  source: "源码",
  booleanAttribute: "（布尔）",
  semanticValue: "语义值",
  generated: "生成内容",
  unserializable: "节点数据无法序列化",
};

export function viewLabels(language: LabelLanguage): Partial<WikitextLabels> | undefined {
  return language === "zh" ? ZH_WIKITEXT_LABELS : undefined;
}

export function treeLabels(language: LabelLanguage): Partial<AstTreeLabels> | undefined {
  return language === "zh" ? ZH_AST_TREE_LABELS : undefined;
}

export function inspectorLabels(language: LabelLanguage): Partial<NodeInspectorLabels> | undefined {
  return language === "zh" ? ZH_NODE_INSPECTOR_LABELS : undefined;
}
