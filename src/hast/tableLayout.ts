import type { Element, ElementContent } from "hast";

/** 超过该逻辑列数的表格不补空单元格，避免异常 colspan 放大 DOM。 */
const MAX_FILLER_COLUMNS = 100;
/** 单张表最多补充的空单元格数量；超过时只收敛 span、不补格。 */
const MAX_FILLER_CELLS = 1_000;

interface ActiveSpan {
  readonly start: number;
  /** 半开区间结束列。 */
  readonly end: number;
  readonly endRow: number;
}

interface CellLayout {
  readonly colSpan: number;
  readonly rowSpan: number;
}

interface RowLayout {
  readonly cells: readonly CellLayout[];
  fillers: number;
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function spanValue(value: number | undefined): number {
  return value === undefined ? 1 : Math.min(Math.max(Math.floor(value), 1), 1_000);
}

function nextFree(
  column: number,
  spans: readonly ActiveSpan[],
): { readonly column: number; readonly available: number } {
  let current = column;
  for (const span of spans) {
    if (span.end <= current) {
      continue;
    }
    if (span.start > current) {
      return { column: current, available: span.start - current };
    }
    current = span.end;
  }
  return { column: current, available: Number.POSITIVE_INFINITY };
}

function isCell(node: ElementContent): node is Element {
  return node.type === "element" && (node.tagName === "td" || node.tagName === "th");
}

function computeLayout(rows: readonly (readonly CellLayout[])[]): RowLayout[] {
  const rowCount = rows.length;
  let active: ActiveSpan[] = [];
  const covered: number[] = [];
  const layouts: RowLayout[] = [];
  let width = 0;

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const live = active.filter((span) => span.endRow > rowIndex);
    // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 target has no toSorted
    live.sort((a, b) => a.start - b.start);
    const added: ActiveSpan[] = [];
    let cursor = 0;
    let occupied = 0;
    const cells: CellLayout[] = [];
    for (const cell of rows[rowIndex]!) {
      const slot = nextFree(cursor, live);
      const colSpan = Math.min(spanValue(cell.colSpan), slot.available);
      const rowSpan = Math.min(spanValue(cell.rowSpan), rowCount - rowIndex);
      cells.push({ colSpan, rowSpan });
      occupied += colSpan;
      if (rowSpan > 1) {
        added.push({
          start: slot.column,
          end: slot.column + colSpan,
          endRow: rowIndex + rowSpan,
        });
      }
      cursor = slot.column + colSpan;
    }
    let end = cursor;
    for (const span of live) {
      end = Math.max(end, span.end);
      occupied += span.end - span.start;
    }
    covered.push(occupied);
    width = Math.max(width, end);
    layouts.push({ cells, fillers: 0 });
    active = [...live, ...added];
  }

  if (width === 0 || width > MAX_FILLER_COLUMNS) {
    return layouts;
  }
  const gaps = covered.map((count) => Math.max(0, width - count));
  const total = gaps.reduce((sum, gap) => sum + gap, 0);
  if (total > MAX_FILLER_CELLS) {
    return layouts;
  }
  for (const [index, layout] of layouts.entries()) {
    layout.fillers = gaps[index]!;
  }
  return layouts;
}

/**
 * 为表格行补全逻辑网格：按 rowspan/colspan 计算单元格占位，
 * 把跨行限制在当前表格内、把跨列限制在空闲区间内，并在行尾缺口补空单元格。
 * @param rows 直接构成表格行的 `<tr>` 元素，按源码顺序排列。
 * @param createFiller 创建空单元格元素。
 */
export function applyTableLayout(rows: readonly Element[], createFiller: () => Element): void {
  if (rows.length === 0) {
    return;
  }
  const rowCells = rows.map((row) => row.children.filter(isCell));
  const layouts = computeLayout(
    rowCells.map((cells) =>
      cells.map((cell) => ({
        colSpan: numeric(cell.properties.colSpan) ?? 1,
        rowSpan: numeric(cell.properties.rowSpan) ?? 1,
      })),
    ),
  );

  layouts.forEach((layout, rowIndex) => {
    const row = rows[rowIndex]!;
    const cells = rowCells[rowIndex]!;
    layout.cells.forEach((cellLayout, cellIndex) => {
      const properties = cells[cellIndex]!.properties;
      if (numeric(properties.colSpan) !== undefined) {
        properties.colSpan = cellLayout.colSpan;
      }
      if (numeric(properties.rowSpan) !== undefined) {
        properties.rowSpan = cellLayout.rowSpan;
      }
    });
    for (let index = 0; index < layout.fillers; index++) {
      row.children.push(createFiller());
    }
  });
}
