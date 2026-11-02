export function textContent(node) {
  if (!node) {
    return "";
  }
  if (node.type === "text") {
    return node.value ?? "";
  }
  return (node.children ?? []).map(textContent).join("");
}

export function findElement(node, predicate) {
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

export function findAllElements(node, predicate) {
  const found = [];
  const visit = (current) => {
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

export function classNames(node) {
  const value = node.properties?.className;
  return Array.isArray(value) ? value : [];
}

export function summarize(root) {
  const heading = findElement(root, (element) => element.tagName === "h2");
  const paragraph = findElement(root, (element) => element.tagName === "p");
  const link = findElement(root, (element) => classNames(element).includes("wtr-link"));
  const table = findElement(root, (element) => element.tagName === "table");
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
