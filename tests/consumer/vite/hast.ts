import type { Root } from "hast";

export interface HastNode {
  readonly type: string;
  readonly tagName?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly value?: string;
  readonly children?: readonly HastNode[];
}

export function textContent(node: HastNode | undefined): string {
  if (!node) {
    return "";
  }
  if (node.type === "text") {
    return node.value ?? "";
  }
  return (node.children ?? []).map(textContent).join("");
}

export function findElement(
  node: HastNode | undefined,
  predicate: (element: HastNode) => boolean,
): HastNode | undefined {
  if (!node) {
    return undefined;
  }
  if (node.type === "element" && predicate(node)) {
    return node;
  }
  for (const child of node.children ?? []) {
    const found = findElement(child, predicate);
    if (found) {
      return found;
    }
  }
  return undefined;
}

export function findAllElements(
  node: HastNode | undefined,
  predicate: (element: HastNode) => boolean,
): HastNode[] {
  const found: HastNode[] = [];
  const visit = (current: HastNode): void => {
    if (current.type === "element" && predicate(current)) {
      found.push(current);
    }
    for (const child of current.children ?? []) {
      visit(child);
    }
  };
  if (node) {
    visit(node);
  }
  return found;
}

export function classNames(node: HastNode): readonly string[] {
  const value = node.properties?.className;
  return Array.isArray(value) ? (value as string[]) : [];
}

export function summarize(root: Root): {
  heading: string | null;
  paragraph: string | null;
  link: { text: string; href: string | null; tag: string | null } | null;
  tableCells: string[];
} {
  const tree = root as unknown as HastNode;
  const heading = findElement(tree, (element) => element.tagName === "h2");
  const paragraph = findElement(tree, (element) => element.tagName === "p");
  const link = findElement(tree, (element) => classNames(element).includes("wtr-link"));
  const table = findElement(tree, (element) => element.tagName === "table");
  return {
    heading: heading ? textContent(heading) : null,
    paragraph: paragraph ? textContent(paragraph) : null,
    link: link
      ? {
          text: textContent(link),
          href: typeof link.properties?.href === "string" ? link.properties.href : null,
          tag: link.tagName ?? null,
        }
      : null,
    tableCells: table
      ? findAllElements(table, (element) => element.tagName === "td").map(textContent)
      : [],
  };
}
