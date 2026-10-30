import { describe, expect, it } from "vitest";
import { sanitizeHref, sanitizeImageUrl, sanitizedAttributesToProps } from "@/hast";

describe("sanitizeHref", () => {
  it("allows http, https and mailto", () => {
    expect(sanitizeHref("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(sanitizeHref("http://example.com")).toBe("http://example.com/");
    expect(sanitizeHref("mailto:user@example.com")).toBe("mailto:user@example.com");
  });

  it("normalizes protocol-relative links to https", () => {
    expect(sanitizeHref("//example.com/x")).toBe("https://example.com/x");
  });

  it("rejects dangerous protocols and obfuscation", () => {
    for (const value of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "java\tscript:alert(1)",
      "&#106;avascript:alert(1)",
      "java\\script:alert(1)",
    ]) {
      expect(sanitizeHref(value)).toBeNull();
    }
  });

  it("rejects empty values", () => {
    expect(sanitizeHref("   ")).toBeNull();
  });

  it("rejects relative paths by default", () => {
    expect(sanitizeHref("/wiki/A")).toBeNull();
  });

  it("allows relative paths for resolved internal links", () => {
    expect(sanitizeHref("/wiki/A", { allowRelative: true })).toBe("/wiki/A");
    expect(sanitizeHref("#section", { allowRelative: true })).toBe("#section");
    expect(sanitizeHref("./a", { allowRelative: true })).toBe("./a");
  });

  it("allows bare relative paths only without a scheme-like colon", () => {
    expect(sanitizeHref("Target", { allowRelative: true })).toBe("Target");
    expect(sanitizeHref("wiki/A", { allowRelative: true })).toBe("wiki/A");
    expect(sanitizeHref("java\\script:alert(1)", { allowRelative: true })).toBeNull();
    expect(sanitizeHref("C:/Windows", { allowRelative: true })).toBeNull();
  });

  it("still rejects dangerous absolute hrefs", () => {
    expect(sanitizeHref("javascript:alert(1)", { allowRelative: true })).toBeNull();
    expect(sanitizeHref("//example.com", { allowRelative: true })).toBe("https://example.com/");
  });
});

describe("sanitizeImageUrl", () => {
  it("allows only http and https by default", () => {
    expect(sanitizeImageUrl("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(sanitizeImageUrl("mailto:x@example.com")).toBeNull();
    expect(sanitizeImageUrl("javascript:alert(1)")).toBeNull();
  });

  it("supports explicit relative image paths", () => {
    expect(sanitizeImageUrl("/img/a.png")).toBeNull();
    expect(sanitizeImageUrl("/img/a.png", { allowRelative: true })).toBe("/img/a.png");
    expect(sanitizeImageUrl("javascript:alert(1)", { allowRelative: true })).toBeNull();
  });
});

describe("sanitizedAttributesToProps", () => {
  it("keeps whitelisted attributes and drops style, events and ids", () => {
    expect(
      sanitizedAttributesToProps([
        { name: "class", value: "a b" },
        { name: "title", value: "hello" },
        { name: "dir", value: "rtl" },
        { name: "lang", value: "zh-CN" },
        { name: "style", value: "color:red" },
        { name: "onclick", value: "alert(1)" },
        { name: "id", value: "x" },
      ]),
    ).toEqual({
      className: ["a", "b"],
      title: "hello",
      dir: "rtl",
      lang: "zh-CN",
      style: "color: red", // HAST 属性值规范化后再由 JSX runtime 转成对象
    });
  });

  it("filters invalid class tokens, dir and lang values", () => {
    expect(
      sanitizedAttributesToProps([
        { name: "class", value: "ok bad<value" },
        { name: "dir", value: "sideways" },
        { name: "lang", value: "not a language!" },
      ]),
    ).toEqual({ className: ["ok"] });
  });

  it("clamps colspan and rowspan", () => {
    expect(
      sanitizedAttributesToProps([
        { name: "colspan", value: "0" },
        { name: "rowspan", value: "99999" },
      ]),
    ).toEqual({ rowSpan: 1000 });
  });

  it("splits headers into a list", () => {
    expect(sanitizedAttributesToProps([{ name: "headers", value: "a b" }])).toEqual({
      headers: ["a", "b"],
    });
  });

  it("keeps layout attributes only on their table tags", () => {
    expect(sanitizedAttributesToProps([{ name: "align", value: "right" }], "td")).toEqual({
      align: "right",
    });
    expect(sanitizedAttributesToProps([{ name: "align", value: "right" }], "span")).toEqual({});
  });

  it("maps legacy table attributes and boolean nowrap", () => {
    expect(
      sanitizedAttributesToProps(
        [
          { name: "valign", value: "top" },
          { name: "bgcolor", value: "#eee" },
          { name: "nowrap", value: null },
        ],
        "td",
      ),
    ).toEqual({ vAlign: "top", bgColor: "#eee", noWrap: true });
  });

  it("keeps safe data attributes and rejects reserved ones", () => {
    expect(sanitizedAttributesToProps([{ name: "data-sort-value", value: "v" }], "td")).toEqual({
      dataSortValue: "v",
    });
    expect(
      sanitizedAttributesToProps(
        [
          { name: "data-node-id", value: "x" },
          { name: "data-mw-foo", value: "x" },
        ],
        "td",
      ),
    ).toEqual({});
  });

  it("drops boolean or missing values", () => {
    expect(
      sanitizedAttributesToProps([
        { name: "title", value: null },
        { name: "class", value: "" },
      ]),
    ).toEqual({});
  });
});
