const FILLER_CLASS = "wtr-table__cell--filler";

/** 生成会触发 HAST 节点预算的稀疏语义表格样本。 */
export function sparseTableSource(tables = 45): string {
  const wide = `| ${Array.from({ length: 100 }, (_, index) => `h${index}`).join(" || ")}`;
  const sparse = Array.from({ length: 10 }, () => "|-\n| y").join("\n");
  const table = `{| class="wikitable"\n|-\n${wide}\n${sparse}\n|}`;
  return Array.from({ length: tables }, () => table).join("\n\n");
}

/** 统计 HAST 中带补位 class 的节点数。 */
export function countFillers(node: unknown): number {
  if (!node || typeof node !== "object") {
    return 0;
  }
  const element = node as {
    properties?: { className?: unknown };
    children?: readonly unknown[];
  };
  const className = element.properties?.className;
  const isFiller = Array.isArray(className) && className.some((token) => token === FILLER_CLASS);
  return (
    (isFiller ? 1 : 0) +
    (element.children ?? []).reduce<number>((total, child) => total + countFillers(child), 0)
  );
}
