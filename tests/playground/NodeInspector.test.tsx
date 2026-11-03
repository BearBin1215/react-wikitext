import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flattenNodes, type WikitextSyntaxNode } from "@/ast";
import { NodeInspector } from "@pg/devtools";
import { parse } from "../helpers/parse";

afterEach(cleanup);

function flattenSyntax(root: WikitextSyntaxNode): WikitextSyntaxNode[] {
  return [root, ...root.children.flatMap((child) => flattenSyntax(child))];
}

describe("NodeInspector", () => {
  it("shows the empty state without a node", () => {
    const doc = parse("text");
    render(<NodeInspector document={doc} />);
    expect(screen.getByText("Select a node to inspect it")).toBeTruthy();
  });

  it("shows syntax type, range, props, attributes and source", () => {
    const doc = parse('<span class="x">hi</span>');
    const html = flattenSyntax(doc.syntax!).find((node) => node.type === "html")!;
    render(<NodeInspector document={doc} node={html} tree="syntax" />);
    expect(screen.getByText("html")).toBeTruthy();
    expect(screen.getByText("props")).toBeTruthy();
    expect(screen.getByText("attributes")).toBeTruthy();
    expect(screen.getByText("class", { selector: "code" })).toBeTruthy();
    expect(screen.getByText('<span class="x">')).toBeTruthy();
  });

  it("degrades gracefully when the node does not match the requested tree", () => {
    const doc = parse("[[A|b]]");
    const link = flattenNodes(doc.ast).find((node) => node.type === "link")!;
    render(<NodeInspector document={doc} node={link} tree="syntax" />);
    expect(screen.getByText("semantic value")).toBeTruthy();
  });

  it("shows semantic value and generated-content state", () => {
    const doc = parse("[[A|b]]");
    const link = flattenNodes(doc.ast).find((node) => node.type === "link")!;
    render(<NodeInspector document={doc} node={link} />);
    expect(screen.getByText("semantic value")).toBeTruthy();
    expect(screen.getByText("[[A|b]]")).toBeTruthy();
  });

  it("copies node JSON and source", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const doc = parse("[[A|b]]");
    const link = flattenNodes(doc.ast).find((node) => node.type === "link")!;
    render(<NodeInspector document={doc} node={link} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"type": "link"'));
    });
    await screen.findByText("Copied");
    fireEvent.click(screen.getByRole("button", { name: "Copy source" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("[[A|b]]");
    });
  });

  it("supports independent labels for section titles and booleans", () => {
    const doc = parse("<span title>x</span>");
    const html = flattenSyntax(doc.syntax!).find((node) => node.type === "html")!;
    render(
      <NodeInspector
        document={doc}
        node={html}
        tree="syntax"
        labels={{
          props: "节点字段",
          attributes: "属性列表",
          source: "节点源码",
          booleanAttribute: "（布尔）",
        }}
      />,
    );
    expect(screen.getByText("节点字段")).toBeTruthy();
    expect(screen.getByText("属性列表")).toBeTruthy();
    expect(screen.getByText("节点源码")).toBeTruthy();
    expect(screen.getByText(/（布尔）/u)).toBeTruthy();
  });

  it("reports clipboard failures", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const doc = parse("text");
    const node = flattenNodes(doc.ast).find((candidate) => candidate.type === "text")!;
    render(<NodeInspector document={doc} node={node} labels={{ copyFailed: "复制失败" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    expect(await screen.findByText("复制失败")).toBeTruthy();
  });
});
