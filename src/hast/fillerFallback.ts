import type { Element, Root, RootContent } from "hast";
import type {
  WikitextDiagnostic,
  WikitextDocument,
  WikitextOrigin,
  WikitextPosition,
} from "../ast/model";
import { flattenNodes } from "../ast/query";

const FILLER_CLASS = "wtr-table__cell--filler";
const CELL_CLASS = "wtr-table__cell";

interface FillerOmissionResult {
  readonly omitted: number;
  readonly tables: number;
}

interface TableMetaCarrier {
  readonly data?: {
    wikitext?: {
      id?: string;
      type?: string;
      origin?: WikitextOrigin;
    };
  };
}

function isElement(node: RootContent): node is Element {
  return node.type === "element";
}

/** 只识别语义 wiki 表格；HTML 表格与插件重建的表格保持原样。 */
function isSemanticTable(element: Element): boolean {
  const data = (element as TableMetaCarrier).data;
  return element.tagName === "table" && data?.wikitext?.type === "table";
}

function classTokens(element: Element): string[] {
  const value: unknown = element.properties?.className;
  if (typeof value === "string") {
    return value.split(/\s+/u).filter(Boolean);
  }
  return Array.isArray(value) ? value.map(String) : [];
}

function isLibraryFiller(node: RootContent): node is Element {
  if (
    node.type !== "element" ||
    node.tagName !== "td" ||
    node.children.length > 0 ||
    node.properties?.dataNodeId !== undefined ||
    (node as { data?: unknown }).data !== undefined
  ) {
    return false;
  }
  // 精确匹配库生成的 class 组合；插件只要改动 class 或内容就保留该单元格。
  const classes = classTokens(node);
  return classes.length === 2 && classes.includes(CELL_CLASS) && classes.includes(FILLER_CLASS);
}

function tableRows(table: Element): Element[] {
  const rows: Element[] = [];
  for (const child of table.children) {
    if (!isElement(child)) {
      continue;
    }
    if (child.tagName === "tr") {
      rows.push(child);
    } else if (child.tagName === "tbody") {
      rows.push(...child.children.filter(isElement).filter((row) => row.tagName === "tr"));
    }
  }
  return rows;
}

/**
 * 在节点数超限时省略语义表格行末由库生成的空补位格。
 *
 * 只删除每行末尾连续的空 `td`，不移动真实单元格，也不处理 HTML 表格或插件
 * 新增的内容，避免改变作者内容或其它表格的布局。
 */
export function omitEmptyTableFillers(
  root: Root,
  document: WikitextDocument | undefined,
  diagnostics: WikitextDiagnostic[],
): FillerOmissionResult {
  const semanticById = document
    ? new Map(flattenNodes(document.ast).map((node) => [node.id, node]))
    : undefined;
  let omitted = 0;
  let tables = 0;

  const visit = (element: Element): void => {
    if (isSemanticTable(element)) {
      let tableOmitted = 0;
      for (const row of tableRows(element)) {
        let index = row.children.length - 1;
        while (index >= 0) {
          const child = row.children[index]!;
          if (!isLibraryFiller(child)) {
            break;
          }
          index--;
        }
        tableOmitted += row.children.splice(index + 1).length;
      }
      if (tableOmitted > 0) {
        omitted += tableOmitted;
        tables++;
        const meta = (element as TableMetaCarrier).data?.wikitext;
        const semantic = meta?.id ? semanticById?.get(meta.id) : undefined;
        const origin: WikitextOrigin | undefined = semantic?.origin ?? meta?.origin;
        const position: WikitextPosition | undefined = semantic?.position;
        diagnostics.push({
          code: "TABLE_FILLER_BUDGET_EXCEEDED",
          stage: "finalize",
          severity: "warning",
          message: `Omitted ${tableOmitted} empty table filler cells to keep the render HAST within the node budget.`,
          ...(origin ? { origin } : {}),
          ...(position ? { position } : {}),
        });
      }
    }
    for (const child of element.children) {
      if (isElement(child)) {
        visit(child);
      }
    }
  };

  for (const child of root.children) {
    if (isElement(child)) {
      visit(child);
    }
  }
  return { omitted, tables };
}
