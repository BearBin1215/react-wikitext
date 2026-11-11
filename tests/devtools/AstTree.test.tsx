import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flattenNodes } from "@/ast";
import { AstTree } from "@/devtools";
import { parse, prepare } from "../helpers/parse";

const scrollDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");

function stubScrollIntoView(): ReturnType<typeof vi.fn> {
  const mock = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: mock });
  return mock;
}

afterEach(() => {
  cleanup();
  if (scrollDescriptor) {
    Object.defineProperty(Element.prototype, "scrollIntoView", scrollDescriptor);
  } else {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
});

function row(container: HTMLElement, id: string): HTMLElement {
  return container.querySelector<HTMLElement>(`[data-tree-label="${id}"]`)!;
}

describe("AstTree", () => {
  it("renders the semantic root and expands the first two levels by default", () => {
    const doc = parse("== H ==\ntext");
    const { container } = render(<AstTree document={doc} />);
    expect(container.textContent).toContain("root");
    expect(container.textContent).toContain("heading");
    expect(container.textContent).toContain("paragraph");
    expect(container.textContent).toContain("text");
  });

  it("can inspect a rendered document", () => {
    const prepared = prepare("== H ==\ntext");
    const { container } = render(<AstTree document={prepared} />);
    expect(container.textContent).toContain("root");
    expect(container.textContent).toContain("heading");
  });

  it("can switch to the retained syntax tree", () => {
    const doc = parse("== H ==\ntext");
    const { container } = render(<AstTree document={doc} kind="syntax" />);
    expect(container.textContent).toContain("heading-title");
    expect(container.textContent).toContain("heading-trail");
  });

  it("reports a missing syntax tree", () => {
    const prepared = prepare("== H ==\ntext");
    render(<AstTree document={prepared} kind="syntax" />);
    expect(screen.getByText("Syntax tree was not retained for this document")).toBeTruthy();
  });

  it("collapses and expands all nodes", () => {
    const doc = parse("== H ==\ntext");
    const { container } = render(<AstTree document={doc} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(container.textContent).not.toContain("heading");
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(container.textContent).toContain("heading");
  });

  it("calls onSelect and keeps an uncontrolled selection", () => {
    const doc = parse("== H ==\ntext");
    const heading = flattenNodes(doc.ast).find((node) => node.type === "heading")!;
    const onSelect = vi.fn();
    const { container } = render(<AstTree document={doc} onSelect={onSelect} />);
    fireEvent.click(row(container, heading.id));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: heading.id }), "semantic");
    expect(container.querySelector(".wikitext-tree__row.is-selected")?.textContent).toContain(
      "heading",
    );
    expect(container.querySelector('[aria-selected="true"]')).toBeTruthy();
  });

  it("supports an initial selection", () => {
    const doc = parse("== H ==\ntext");
    const heading = flattenNodes(doc.ast).find((node) => node.type === "heading")!;
    const { container } = render(<AstTree document={doc} defaultSelectedId={heading.id} />);
    expect(container.querySelector(".wikitext-tree__row.is-selected")?.textContent).toContain(
      "heading",
    );
  });

  it("restores an uncontrolled selection when the document changes", () => {
    const oldDoc = parse("== H ==\ntext");
    const heading = flattenNodes(oldDoc.ast).find((node) => node.type === "heading")!;
    const { container, rerender } = render(<AstTree document={oldDoc} />);
    fireEvent.click(row(container, heading.id));

    const nextDoc = parse("x\n== H ==\ntext");
    rerender(<AstTree document={nextDoc} />);
    expect(container.querySelector(".wikitext-tree__row.is-selected")?.textContent).toContain(
      "heading",
    );
  });

  it("keeps an uncontrolled selection per tree kind", () => {
    const doc = parse("== H ==\ntext");
    const heading = flattenNodes(doc.ast).find((node) => node.type === "heading")!;
    const { container, rerender } = render(<AstTree document={doc} />);
    fireEvent.click(row(container, heading.id));

    rerender(<AstTree document={doc} kind="syntax" />);
    const title = doc.syntax!.children[0]!.children.find((node) => node.type === "heading-title")!;
    fireEvent.click(row(container, title.id));

    rerender(<AstTree document={doc} />);
    expect(container.querySelector(".wikitext-tree__row.is-selected")?.textContent).toContain(
      "heading",
    );
    rerender(<AstTree document={doc} kind="syntax" />);
    expect(container.querySelector(".wikitext-tree__row.is-selected")?.textContent).toContain(
      "heading-title",
    );
  });

  it("does not re-expand ancestors after the user collapses them", () => {
    const doc = parse("== H ==\ntext");
    const text = flattenNodes(doc.ast).find((node) => node.type === "text")!;
    const onExpandedChange = vi.fn();
    const { container } = render(<AstTree document={doc} onExpandedChange={onExpandedChange} />);
    fireEvent.click(row(container, text.id));
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));

    expect(container.textContent).not.toContain("heading");
    expect(onExpandedChange).toHaveBeenLastCalledWith(new Set());
  });

  it("does not re-reveal a controlled selection after expansion is cleared", () => {
    const doc = parse("== H ==\ntext");
    const heading = flattenNodes(doc.ast).find((node) => node.type === "heading")!;
    const text = flattenNodes(doc.ast).find((node) => node.type === "text")!;
    const onExpandedChange = vi.fn();
    const expanded = new Set(["0", heading.id]);
    const { rerender } = render(
      <AstTree
        document={doc}
        selectedId={text.id}
        expandedIds={expanded}
        onExpandedChange={onExpandedChange}
      />,
    );
    rerender(
      <AstTree
        document={doc}
        selectedId={text.id}
        expandedIds={new Set()}
        onExpandedChange={onExpandedChange}
      />,
    );
    expect(onExpandedChange).not.toHaveBeenCalled();
  });

  it("supports a controlled empty selection with null", () => {
    const doc = parse("== H ==\ntext");
    const heading = flattenNodes(doc.ast).find((node) => node.type === "heading")!;
    const onSelect = vi.fn();
    const { container, rerender } = render(
      <AstTree document={doc} selectedId={null} onSelect={onSelect} />,
    );
    fireEvent.click(row(container, heading.id));
    expect(onSelect).toHaveBeenCalled();
    expect(container.querySelector(".wikitext-tree__row.is-selected")).toBeNull();

    rerender(<AstTree document={doc} selectedId={heading.id} onSelect={onSelect} />);
    expect(container.querySelector(".wikitext-tree__row.is-selected")?.textContent).toContain(
      "heading",
    );
  });

  it("keeps a tab stop when the controlled selection is missing", () => {
    const doc = parse("text");
    const { container } = render(<AstTree document={doc} selectedId="missing" />);
    const labels = Array.from(container.querySelectorAll<HTMLElement>("[data-tree-label]"));
    expect(labels.some((label) => label.tabIndex === 0)).toBe(true);
  });

  it("keeps a tab stop when the controlled selection is collapsed", () => {
    const doc = parse("== H ==\ntext");
    const text = flattenNodes(doc.ast).find((node) => node.type === "text")!;
    const { container } = render(
      <AstTree document={doc} selectedId={text.id} expandedIds={new Set()} />,
    );
    const labels = Array.from(container.querySelectorAll<HTMLElement>("[data-tree-label]"));
    expect(labels.some((label) => label.tabIndex === 0)).toBe(true);
  });

  it("uses focusable tree items with non-button labels", () => {
    const doc = parse("== H ==\ntext");
    const { container } = render(<AstTree document={doc} />);
    const items = Array.from(container.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((item) => item.tabIndex === 0)).toBe(true);
    expect(container.querySelector('[role="treeitem"] .wikitext-tree__label')?.tagName).toBe(
      "SPAN",
    );
  });

  it("supports a custom node label with the built-in label as fallback", () => {
    const doc = parse("== H ==\ntext");
    const { container } = render(
      <AstTree
        document={doc}
        getNodeLabel={(node, fallback) => (node.type === "heading" ? `${fallback}!` : "")}
      />,
    );
    expect(container.textContent).toContain("h2!");
  });

  it("searches nodes, selects a result, and restores focus to the row", async () => {
    const doc = parse("text {{Tpl}}");
    const template = flattenNodes(doc.ast).find((node) => node.type === "template")!;
    const onSelect = vi.fn();
    render(<AstTree document={doc} onSelect={onSelect} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "template" } });
    const result = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".wikitext-tree__result"),
    ).find((button) => button.textContent?.includes("template"));
    fireEvent.click(result!);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: template.id }), "semantic");
    await waitFor(() => {
      expect(document.activeElement?.getAttribute("data-tree-label")).toBe(template.id);
    });
  });

  it("re-expands ancestors when the same node is selected again from search", async () => {
    const doc = parse("alpha");
    const text = flattenNodes(doc.ast).find((node) => node.type === "text")!;
    const { container } = render(<AstTree document={doc} />);
    fireEvent.click(row(container, text.id));
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(container.textContent).not.toContain("alpha");

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "alpha" } });
    const result = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".wikitext-tree__result"),
    ).find((button) => button.querySelector(".wikitext-tree__type")?.textContent === "text");
    fireEvent.click(result!);
    await waitFor(() => {
      expect(container.querySelector(".wikitext-tree__row.is-selected")?.textContent).toContain(
        "alpha",
      );
    });
  });

  it("reports no results", () => {
    const doc = parse("text");
    render(<AstTree document={doc} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "not-present-anywhere" } });
    expect(screen.getByText("No matching nodes")).toBeTruthy();
  });

  it("reports truncated search results", () => {
    const source = Array.from({ length: 90 }, (_, index) => `match ${index}`).join("\n\n");
    const doc = parse(source);
    render(<AstTree document={doc} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "match" } });
    expect(screen.getByText("More matches are hidden. Refine the search.")).toBeTruthy();
  });

  it("moves focus from the search box into results and clears with Escape", () => {
    const doc = parse("text {{Tpl}}");
    render(<AstTree document={doc} />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "template" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(document.activeElement?.classList.contains("wikitext-tree__result")).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
  });

  it("supports localized labels", () => {
    const doc = parse("text");
    render(
      <AstTree
        document={doc}
        labels={{ expandAll: "展开全部", collapseAll: "折叠全部", treeLabel: "语义树" }}
      />,
    );
    expect(screen.getByRole("button", { name: "展开全部" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "折叠全部" })).toBeTruthy();
    expect(screen.getByRole("tree", { name: "语义树" })).toBeTruthy();
  });

  it("supports controlled expansion", () => {
    const doc = parse("== H ==\ntext");
    const onExpandedChange = vi.fn();
    const { container } = render(
      <AstTree document={doc} expandedIds={new Set(["0"])} onExpandedChange={onExpandedChange} />,
    );
    expect(container.textContent).toContain("heading");
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(onExpandedChange).toHaveBeenCalledWith(new Set());
    expect(container.textContent).toContain("heading");
  });

  it("reports expansion changes in uncontrolled mode", () => {
    const doc = parse("== H ==\ntext");
    const onExpandedChange = vi.fn();
    render(<AstTree document={doc} onExpandedChange={onExpandedChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(onExpandedChange).toHaveBeenCalledWith(new Set());
  });

  it("does not report unchanged controlled expansion", () => {
    const doc = parse("text");
    const onExpandedChange = vi.fn();
    render(<AstTree document={doc} expandedIds={new Set()} onExpandedChange={onExpandedChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(onExpandedChange).not.toHaveBeenCalled();
  });

  it("selects with Enter and Space and does not select on toggle", () => {
    const doc = parse("== H ==\ntext");
    const heading = flattenNodes(doc.ast).find((node) => node.type === "heading")!;
    const onSelect = vi.fn();
    const { container } = render(<AstTree document={doc} onSelect={onSelect} />);
    const headingRow = row(container, heading.id);
    headingRow.focus();
    fireEvent.keyDown(headingRow, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: heading.id }), "semantic");

    onSelect.mockClear();
    const toggle = headingRow.querySelector<HTMLElement>(".wikitext-tree__toggle")!;
    fireEvent.click(toggle);
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(headingRow);

    fireEvent.keyDown(headingRow, { key: " " });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: heading.id }), "semantic");
  });

  it("does not rely on path-like node ids", () => {
    const doc = parse("== H ==\ntext");
    let counter = 0;
    const rename = (node: unknown): void => {
      const candidate = node as { id: string; children?: unknown[] };
      candidate.id = `n${counter++}`;
      for (const child of candidate.children ?? []) {
        rename(child);
      }
    };
    const renamed = structuredClone(doc) as typeof doc;
    rename(renamed.ast);
    const { container } = render(<AstTree document={renamed} />);
    const levels = Array.from(container.querySelectorAll("[role=treeitem]")).map((item) =>
      item.getAttribute("aria-level"),
    );
    expect(levels).toContain("2");
    expect(levels.filter((level) => level === "1")).toHaveLength(1);
  });

  it("supports keyboard expansion and focus movement", () => {
    const doc = parse("== H ==\ntext");
    const { container } = render(<AstTree document={doc} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    const rootLabel = container.querySelector<HTMLElement>('[data-tree-label="0"]')!;
    rootLabel.focus();
    fireEvent.keyDown(rootLabel, { key: "ArrowRight" });
    expect(container.textContent).toContain("heading");
    fireEvent.keyDown(rootLabel, { key: "ArrowLeft" });
    expect(container.textContent).not.toContain("heading");

    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    const labels = Array.from(container.querySelectorAll<HTMLElement>("[data-tree-label]"));
    labels[0]!.focus();
    fireEvent.keyDown(labels[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(labels[1]);
    fireEvent.keyDown(labels[1]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(labels[0]);
  });

  it("prevents page scrolling at tree keyboard boundaries", () => {
    const doc = parse("== H ==\ntext");
    const { container } = render(<AstTree document={doc} />);
    const labels = Array.from(container.querySelectorAll<HTMLElement>("[data-tree-label]"));
    const first = labels[0]!;
    const last = labels.at(-1)!;

    first.focus();
    expect(fireEvent.keyDown(first, { key: "ArrowUp" })).toBe(false);
    expect(document.activeElement).toBe(first);

    last.focus();
    expect(fireEvent.keyDown(last, { key: "ArrowDown" })).toBe(false);
    expect(document.activeElement).toBe(last);

    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    const rootLabel = row(container, "0");
    rootLabel.focus();
    expect(fireEvent.keyDown(rootLabel, { key: "ArrowLeft" })).toBe(false);
    expect(document.activeElement).toBe(rootLabel);

    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    const leaf = Array.from(container.querySelectorAll<HTMLElement>("[data-tree-label]")).find(
      (label) =>
        label.querySelector(":scope > .wikitext-tree__row > .wikitext-tree__spacer") !== null,
    )!;
    const rowCount = container.querySelectorAll('[role="treeitem"]').length;
    leaf.focus();
    expect(fireEvent.keyDown(leaf, { key: "ArrowRight" })).toBe(false);
    expect(document.activeElement).toBe(leaf);
    expect(container.querySelectorAll('[role="treeitem"]').length).toBe(rowCount);
  });

  it("prevents page scrolling at search result boundaries", () => {
    const doc = parse("text {{Tpl}}");
    const { container } = render(<AstTree document={doc} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "template" } });
    const results = Array.from(container.querySelectorAll<HTMLElement>(".wikitext-tree__result"));
    const first = results[0]!;
    const last = results.at(-1)!;

    first.focus();
    expect(fireEvent.keyDown(first, { key: "ArrowUp" })).toBe(false);
    expect(document.activeElement).toBe(first);

    last.focus();
    expect(fireEvent.keyDown(last, { key: "ArrowDown" })).toBe(false);
    expect(document.activeElement).toBe(last);
  });

  it("uses the expand and collapse labels as pointer hints", () => {
    const doc = parse("== H ==\ntext");
    const heading = flattenNodes(doc.ast).find((node) => node.type === "heading")!;
    const { container } = render(
      <AstTree document={doc} labels={{ expand: "Open", collapse: "Close" }} />,
    );
    const toggle = row(container, heading.id).querySelector<HTMLElement>(".wikitext-tree__toggle")!;
    expect(toggle.getAttribute("title")).toBe("Close");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("title")).toBe("Open");
  });

  it("shows the matched node label in search results", () => {
    const doc = parse("== H ==\ntext");
    const { container } = render(
      <AstTree
        document={doc}
        getNodeLabel={(node, fallback) => (node.type === "heading" ? `${fallback}!` : "")}
      />,
    );
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "h2!" } });
    const result = container.querySelector<HTMLElement>(".wikitext-tree__result")!;
    expect(result.querySelector(".wikitext-tree__name")?.textContent).toBe("h2!");
  });

  it("does not select the parent when the child indent is clicked", () => {
    const doc = parse("== H ==\ntext");
    const onSelect = vi.fn();
    const { container } = render(<AstTree document={doc} onSelect={onSelect} />);
    fireEvent.click(container.querySelector(".wikitext-tree__children")!);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("scrolls to an externally selected row after clearing search", () => {
    const scrollIntoView = stubScrollIntoView();
    const doc = parse("== H ==\ntext");
    const heading = flattenNodes(doc.ast).find((node) => node.type === "heading")!;
    const text = flattenNodes(doc.ast).find((node) => node.type === "text")!;
    const { rerender } = render(<AstTree document={doc} selectedId={text.id} />);
    scrollIntoView.mockClear();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "text" } });
    rerender(<AstTree document={doc} selectedId={heading.id} />);
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("scrolls again after the selection moves through a missing id", () => {
    const scrollIntoView = stubScrollIntoView();
    const doc = parse("== H ==\ntext");
    const heading = flattenNodes(doc.ast).find((node) => node.type === "heading")!;
    const { rerender } = render(<AstTree document={doc} selectedId={heading.id} />);
    scrollIntoView.mockClear();

    rerender(<AstTree document={doc} selectedId="missing" />);
    expect(scrollIntoView).not.toHaveBeenCalled();

    rerender(<AstTree document={doc} selectedId={heading.id} />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("does not scroll again when the selected row is already current", () => {
    const scrollIntoView = stubScrollIntoView();
    const doc = parse("== H ==\ntext");
    const heading = flattenNodes(doc.ast).find((node) => node.type === "heading")!;
    const { container } = render(<AstTree document={doc} selectedId={heading.id} />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    scrollIntoView.mockClear();

    const toggle = row(container, heading.id).querySelector<HTMLElement>(".wikitext-tree__toggle")!;
    fireEvent.click(toggle);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("recomputes default expansion before layout effects when switching trees", () => {
    const doc = parse("* a\n* b");
    const onLayout = vi.fn();
    function LayoutProbe(): null {
      useLayoutEffect(() => {
        onLayout(document.body.textContent ?? "");
      });
      return null;
    }
    const { rerender } = render(
      <>
        <AstTree document={doc} />
        <LayoutProbe />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    onLayout.mockClear();

    rerender(
      <>
        <AstTree document={doc} kind="syntax" />
        <LayoutProbe />
      </>,
    );
    // 语法树在提交前就按默认深度展开，而不是把语义树的空集合套上去。
    expect(onLayout.mock.calls[0]![0]).toContain("list");
  });
});
