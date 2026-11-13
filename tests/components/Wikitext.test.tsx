import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Wikitext,
  WikitextError,
  type WikitextErrorInfo,
  type WikitextRenderSnapshot,
} from "@/index";
import { createWikiparser } from "@/parse";

afterEach(cleanup);

describe("Wikitext source component", () => {
  it("parses and prepares a source string", () => {
    render(<Wikitext source={"== A ==\n[[B|label]]"} />);
    expect(screen.getByRole("heading", { name: "A" })).toBeTruthy();
    expect(screen.getByText("label")).toBeTruthy();
  });

  it("uses an injected parser and reuses the parsed document across renders", () => {
    const parser = createWikiparser();
    const parseSpy = vi.spyOn(parser, "parse");
    const { rerender } = render(<Wikitext source="text" parser={parser} />);
    rerender(<Wikitext source="text" parser={parser} />);
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(parseSpy).toHaveBeenCalledWith("text", undefined);
  });

  it("reuses the parsed document when only prepare options change", () => {
    const parser = createWikiparser();
    const parseSpy = vi.spyOn(parser, "parse");
    const { rerender } = render(<Wikitext source="[[A|label]]" parser={parser} />);
    rerender(
      <Wikitext
        source="[[A|label]]"
        parser={parser}
        prepareOptions={{ resolveLink: () => ({ href: "/wiki/A" }) }}
      />,
    );
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText("label").closest("a")?.getAttribute("href")).toBe("/wiki/A");
  });

  it("forwards view props without listing them one by one", () => {
    const { container } = render(
      <Wikitext source="x" className="custom" containerProps={{ id: "host" }} />,
    );
    const host = container.querySelector("#host");
    expect(host?.className).toBe("wikitext-view custom");
    expect(host?.textContent).toBe("x");
  });

  it("forwards prepare options", () => {
    render(
      <Wikitext
        source="[[A|label]]"
        prepareOptions={{ resolveLink: () => ({ href: "/wiki/A" }) }}
      />,
    );
    expect(screen.getByText("label").closest("a")?.getAttribute("href")).toBe("/wiki/A");
  });

  it("exposes diagnostics through onPrepared", () => {
    const prepared: WikitextRenderSnapshot[] = [];
    render(<Wikitext source="[[File:X.png]]" onPrepared={(document) => prepared.push(document)} />);
    expect(prepared).toHaveLength(1);
    expect(
      prepared[0]?.diagnostics.some((diagnostic) => diagnostic.code === "FILE_PLACEHOLDER"),
    ).toBe(true);
  });

  it("renders the built-in error container when only onError is provided", () => {
    const errors: WikitextErrorInfo[] = [];
    render(
      <Wikitext
        source="text"
        prepareOptions={{ headingIdStrategy: "nope" as never }}
        onError={(_error, info) => errors.push(info)}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Render failed");
    expect(errors).toEqual([{ stage: "prepare" }]);
  });

  it("passes a WikitextError to onError", () => {
    const errors: WikitextError[] = [];
    render(
      <Wikitext
        source={"x".repeat(120)}
        parseOptions={{ maxSourceLength: 100 }}
        onError={(error) => errors.push(error)}
      />,
    );
    expect(errors[0]).toBeInstanceOf(WikitextError);
    expect(errors[0]?.code).toBe("SOURCE_TOO_LONG");
  });

  it("lets the fallback take over error rendering completely", () => {
    const { container } = render(
      <Wikitext
        source={"x".repeat(120)}
        parseOptions={{ maxSourceLength: 100 }}
        onError={() => undefined}
        fallback={(error) => <span data-fallback="parse">{error.message}</span>}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.querySelector("[data-fallback=parse]")).toBeTruthy();
  });

  it("renders nothing when the fallback is null", () => {
    const { container } = render(
      <Wikitext
        source={"x".repeat(120)}
        parseOptions={{ maxSourceLength: 100 }}
        onError={() => undefined}
        fallback={null}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("uses prepare labels for the built-in error text", () => {
    render(
      <Wikitext
        source="text"
        prepareOptions={{
          headingIdStrategy: "nope" as never,
          labels: { renderFailed: "渲染失败" },
        }}
        onError={() => undefined}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("渲染失败");
  });
});
