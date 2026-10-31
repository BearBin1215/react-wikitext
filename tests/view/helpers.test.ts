import { describe, expect, it } from "vitest";
import { flattenNodes, getTemplateParameters, isNodeType } from "@/ast";
import { parse } from "../helpers/parse";

describe("semantic helpers", () => {
  it("extracts template parameters with anonymous indexes", () => {
    const document = parse("{{Infobox|name=x|first|second|name=y}}");
    const template = flattenNodes(document.ast).find((node) => isNodeType(node, "template"))!;
    const parameters = getTemplateParameters(template);
    expect(parameters.map((parameter) => parameter.name)).toEqual(["name", "1", "2", "name"]);
    expect(
      parameters.filter((parameter) => parameter.anonymous).map((parameter) => parameter.index),
    ).toEqual([1, 2]);
    expect(
      parameters[0]?.node.children.map((node) => (node.type === "text" ? node.value : "")),
    ).toEqual(["x"]);
  });

  it("extracts parser function parameters", () => {
    const document = parse("{{#if:a|b}}");
    const parserFunction = flattenNodes(document.ast).find((node) =>
      isNodeType(node, "parserFunction"),
    )!;
    expect(parserFunction.name).toBe("if");
    expect(getTemplateParameters(parserFunction)).toHaveLength(2);
  });

  it("exposes argument names and default nodes directly", () => {
    const document = parse("{{{arg|fallback [[L]]}}}");
    const argument = flattenNodes(document.ast).find((node) => isNodeType(node, "argument"))!;
    expect(argument.name).toBe("arg");
    expect(argument.children.map((node) => node.type)).toEqual(["text", "link"]);
  });

  it("exposes internal link target, page and fragment directly", () => {
    const document = parse("[[Target#section|Label]]");
    const link = flattenNodes(document.ast).find((node) => isNodeType(node, "link"))!;
    expect(link).toMatchObject({
      target: "Target#section",
      page: "Target",
      fragment: "section",
    });
  });
});
