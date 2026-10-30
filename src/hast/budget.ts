import { RENDER_MAX_HAST_DEPTH, RENDER_MAX_HAST_NODES } from "../ast/limits";

/** 渲染快照的 HAST 预算；prepare 与 restore 共用同一组上限，避免合法产物无法恢复。 */
export interface HastBudget {
  readonly maxNodes: number;
  readonly maxDepth: number;
}

export const RENDER_HAST_BUDGET: HastBudget = Object.freeze({
  maxNodes: RENDER_MAX_HAST_NODES,
  maxDepth: RENDER_MAX_HAST_DEPTH,
});

/**
 * 统计 HAST 节点数，达到 `stopAt` 后提前返回，用于判断是否触发降级。
 * 根节点按 1 个节点计。
 */
export function hastNodeCount(root: unknown, stopAt = Number.POSITIVE_INFINITY): number {
  let count = 0;
  const visit = (node: unknown): void => {
    if (count >= stopAt) {
      return;
    }
    count++;
    const children = (node as { children?: unknown } | null)?.children;
    if (Array.isArray(children)) {
      for (const child of children) {
        if (count >= stopAt) {
          return;
        }
        visit(child);
      }
    }
  };
  visit(root);
  return count;
}

/**
 * 检查 HAST 是否超出预算。
 * @returns 违规说明；在预算内时返回 undefined。
 */
export function hastBudgetViolation(
  root: unknown,
  budget: HastBudget = RENDER_HAST_BUDGET,
): string | undefined {
  let count = 0;
  let violation: string | undefined;
  const visit = (node: unknown, depth: number): void => {
    if (violation) {
      return;
    }
    count++;
    if (count > budget.maxNodes) {
      violation = `Render HAST node count exceeds the limit of ${budget.maxNodes}.`;
      return;
    }
    if (depth > budget.maxDepth) {
      violation = `Render HAST depth exceeds the limit of ${budget.maxDepth}.`;
      return;
    }
    const children = (node as { children?: unknown } | null)?.children;
    if (Array.isArray(children)) {
      for (const child of children) {
        visit(child, depth + 1);
      }
    }
  };
  visit(root, 0);
  return violation;
}
