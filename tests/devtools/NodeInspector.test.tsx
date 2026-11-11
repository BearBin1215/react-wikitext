import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flattenNodes, type WikitextNode, type WikitextSyntaxNode } from "@/ast";
import { NodeInspector } from "@/devtools";
import { parse, prepare } from "../helpers/parse";

afterEach(cleanup);

function flattenSyntax(root: WikitextSyntaxNode): WikitextSyntaxNode[] {
  return [root, ...root.children.flatMap((child) => flattenSyntax(child))];
}

describe("NodeInspector", () => {
  it("shows the empty state without a node", () => {
    const doc = parse("text");
    render(<NodeInspector document={doc} />);
    expect(screen.getByText("Select a node to inspect it")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Node inspector" })).toBeTruthy();
  });

  it("shows syntax type, range, props, attributes and source", () => {
    const doc = parse('<span class="x">hi</span>');
    const html = flattenSyntax(doc.syntax!).find((node) => node.type === "html")!;
    render(<NodeInspector document={doc} node={html} />);
    expect(screen.getByText("html")).toBeTruthy();
    expect(screen.getByText("props")).toBeTruthy();
    expect(screen.getByText("attributes")).toBeTruthy();
    expect(screen.getByText("class", { selector: "code" })).toBeTruthy();
    expect(screen.getByText('<span class="x">')).toBeTruthy();
  });

  it("reads semantic nodes from a rendered document", () => {
    const prepared = prepare("[[A|b]]");
    const link = flattenNodes(prepared.ast).find((node) => node.type === "link")!;
    render(<NodeInspector document={prepared} node={link} />);
    expect(screen.getByText("semantic value")).toBeTruthy();
    expect(screen.getByText("[[A|b]]")).toBeTruthy();
  });

  it("shows semantic value", () => {
    const doc = parse("[[A|b]]");
    const link = flattenNodes(doc.ast).find((node) => node.type === "link")!;
    render(<NodeInspector document={doc} node={link} />);
    expect(screen.getByText("semantic value")).toBeTruthy();
    expect(screen.getByText("[[A|b]]")).toBeTruthy();
  });

  it("shows generated content for nodes without a range", () => {
    const doc = parse("x");
    const generated = { type: "text", id: "generated", value: "x" } as unknown as WikitextNode;
    const { container } = render(<NodeInspector document={doc} node={generated} />);
    expect(screen.getAllByText("Generated content").length).toBe(2);
    const blocks = Array.from(container.querySelectorAll<HTMLElement>(".wikitext-inspector__code"));
    expect(blocks.at(-1)?.textContent).toBe("Generated content");
    expect(blocks.at(-1)?.getAttribute("tabindex")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Copy source" }) as HTMLButtonElement).disabled,
    ).toBe(true);
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
    expect(screen.getByRole("status").textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"type": "link"'));
    });
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Copy JSON: Copied");
    });
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy source" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("[[A|b]]");
    });
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Copy source: Copied");
    });
  });

  it("clears the copy status when the inspected node changes", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    const doc = parse("x [[A]]");
    const text = flattenNodes(doc.ast).find((node) => node.type === "text")!;
    const link = flattenNodes(doc.ast).find((node) => node.type === "link")!;
    const { rerender } = render(<NodeInspector document={doc} node={link} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Copy JSON: Copied");
    });
    rerender(<NodeInspector document={doc} node={text} />);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("shows a zero-length syntax range as empty source", () => {
    const doc = parse("== H ==");
    const trail = flattenSyntax(doc.syntax!).find((node) => node.type === "heading-trail")!;
    const { container } = render(<NodeInspector document={doc} node={trail} />);
    expect(screen.getByText("[7, 7)")).toBeTruthy();
    expect(screen.queryByText("Generated content")).toBeNull();
    const blocks = Array.from(container.querySelectorAll<HTMLElement>(".wikitext-inspector__code"));
    expect(blocks.at(-1)?.textContent).toBe("");
    expect(
      (screen.getByRole("button", { name: "Copy source" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("uses h3 for inspector section titles", () => {
    const doc = parse('<span class="x">hi</span>');
    const html = flattenSyntax(doc.syntax!).find((node) => node.type === "html")!;
    const { container } = render(<NodeInspector document={doc} node={html} />);
    expect(container.querySelector("h4")).toBeNull();
    expect(screen.getAllByRole("heading", { level: 3 }).length).toBeGreaterThan(0);
  });

  it("supports independent labels for section titles and booleans", () => {
    const doc = parse("<span title>x</span>");
    const html = flattenSyntax(doc.syntax!).find((node) => node.type === "html")!;
    render(
      <NodeInspector
        document={doc}
        node={html}
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

  it("degrades when node data cannot be serialized", async () => {
    const doc = parse("x");
    const circular = {
      type: "text",
      id: "circular",
      value: "x",
      origin: { range: [0, 1] },
    } as Record<string, unknown>;
    circular.self = circular;
    render(<NodeInspector document={doc} node={circular as unknown as WikitextNode} />);
    expect(screen.getByText("Node data cannot be serialized")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Copy JSON: Copy failed");
    });
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
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe("Copy JSON: 复制失败");
    });
  });
});
