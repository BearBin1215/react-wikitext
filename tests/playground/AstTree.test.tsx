import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flattenNodes } from "@/ast";
import { AstTree } from "@pg/devtools";
import { parse } from "../helpers/parse";

afterEach(cleanup);

describe("AstTree", () => {
  it("renders the semantic root and expands the first two levels by default", () => {
    const doc = parse("== H ==\ntext");
    const { container } = render(<AstTree document={doc} />);
    expect(container.textContent).toContain("root");
    expect(container.textContent).toContain("heading");
    expect(container.textContent).toContain("paragraph");
    expect(container.textContent).toContain("text");
  });

  it("can switch to the retained syntax tree", () => {
    const doc = parse("== H ==\ntext");
    const { container } = render(<AstTree document={doc} tree="syntax" />);
    expect(container.textContent).toContain("heading-title");
    expect(container.textContent).toContain("heading-trail");
  });

  it("collapses and expands all nodes", () => {
    const doc = parse("== H ==\ntext");
    const { container } = render(<AstTree document={doc} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(container.textContent).not.toContain("heading");
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(container.textContent).toContain("heading");
  });

  it("calls onSelect when a node label is clicked", () => {
    const doc = parse("== H ==\ntext");
    const heading = flattenNodes(doc.ast).find((node) => node.type === "heading")!;
    const onSelect = vi.fn();
    render(<AstTree document={doc} onSelect={onSelect} />);
    const label = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".wikitext-tree__label"),
    ).find((button) => button.textContent?.includes("heading"));
    fireEvent.click(label!);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: heading.id }), "semantic");
  });

  it("searches nodes and selects a result", () => {
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
  });

  it("reports no results", () => {
    const doc = parse("text");
    render(<AstTree document={doc} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "not-present-anywhere" } });
    expect(screen.getByText("No matching nodes")).toBeTruthy();
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

  it("recomputes default expansion when switching trees", () => {
    const doc = parse("* a\n* b");
    const { container, rerender } = render(<AstTree document={doc} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    rerender(<AstTree document={doc} tree="syntax" />);
    // 语法树按默认深度重新展开，而不是把语义树的空集合套上去。
    expect(container.textContent).toContain("list");
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
    const rootLabel = container.querySelector<HTMLButtonElement>('[data-tree-label="0"]')!;
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
});
