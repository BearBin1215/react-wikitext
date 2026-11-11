/** 渲染时显示给用户的文案，可以整体或按字段覆盖。 */
export interface WikitextLabels {
  /** 模板未展开时的提示。 */
  templateNotExpanded: string;
  /** 解析器函数未求值时的提示。 */
  parserFunctionNotEvaluated: string;
  /** 没有可用图片地址时的文件占位文案。 */
  filePlaceholder: string;
  /** 引用链接的可读名称；与序号一起构成 aria-label。 */
  reference: string;
  /** 目录标题。 */
  toc: string;
  /** 目录折叠控件的“隐藏”文案。 */
  tocHide: string;
  /** 目录折叠控件的“显示”文案。 */
  tocShow: string;
  /** 目录折叠控件的可访问名称。 */
  tocToggle: string;
  /** 分类底栏标题。 */
  categories: string;
  /** 未知节点的默认提示。 */
  unknownNode: string;
  /** 重定向目标的前缀文案。 */
  redirectTo: string;
  /** 链接被安全策略拦截时的提示。 */
  blockedLink: string;
  /** HTML 标签被安全策略拦截时的提示。 */
  blockedHtml: string;
  /** 渲染过程抛出异常时的提示。 */
  renderFailed: string;
  /** 嵌套表格不支持时的提示。 */
  nestedTableUnsupported: string;
  /** 红链标题中表示页面不存在的后缀。 */
  pageDoesNotExist: string;
}

/** 文案字段清单；供设置与快照校验共用。 */
export const WIKITEXT_LABEL_KEYS = [
  "templateNotExpanded",
  "parserFunctionNotEvaluated",
  "filePlaceholder",
  "reference",
  "toc",
  "tocHide",
  "tocShow",
  "tocToggle",
  "categories",
  "unknownNode",
  "redirectTo",
  "blockedLink",
  "blockedHtml",
  "renderFailed",
  "nestedTableUnsupported",
  "pageDoesNotExist",
] as const satisfies ReadonlyArray<keyof WikitextLabels>;

/** 默认英文文案；冻结以避免宿主修改默认值影响后续准备。 */
export const DEFAULT_WIKITEXT_LABELS: WikitextLabels = Object.freeze({
  templateNotExpanded: "Template not expanded",
  parserFunctionNotEvaluated: "Parser function not evaluated",
  filePlaceholder: "File",
  reference: "Reference",
  toc: "Contents",
  tocHide: "hide",
  tocShow: "show",
  tocToggle: "Toggle table of contents",
  categories: "Categories",
  unknownNode: "Unsupported node",
  redirectTo: "Redirect to",
  blockedLink: "Blocked link",
  blockedHtml: "Blocked HTML",
  renderFailed: "Render failed",
  nestedTableUnsupported: "Nested table not supported",
  pageDoesNotExist: "(page does not exist)",
});

/**
 * 用传入的文案覆盖默认值。
 * @param labels 需要覆盖的字段；未提供的字段沿用默认文案。
 */
export function resolveWikitextLabels(labels?: Partial<WikitextLabels>): WikitextLabels {
  return labels ? { ...DEFAULT_WIKITEXT_LABELS, ...labels } : DEFAULT_WIKITEXT_LABELS;
}
