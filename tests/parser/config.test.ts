import { describe, expect, it } from "vitest";
import { MEDIAWIKI_CONFIG, type ParserConfig } from "@/configs";
import { MINIMUM_CONFIG } from "../helpers/configs";
import { normalizeConfig } from "@/configs/config";
import { WikitextParseError } from "@/parse";

describe("normalizeConfig", () => {
  it("defaults to the MediaWiki config", () => {
    const config = normalizeConfig();
    expect(config.ext).toEqual(MEDIAWIKI_CONFIG.ext);
    expect(config.img).toEqual(MEDIAWIKI_CONFIG.img);
    expect(config.excludes).toEqual([]);
  });

  it("deep-clones the config so parser mutations do not leak", () => {
    const config = normalizeConfig();
    expect(config.html).not.toBe(MEDIAWIKI_CONFIG.html);
    expect(config.doubleUnderscore).not.toBe(MEDIAWIKI_CONFIG.doubleUnderscore);
    expect(config.doubleUnderscore[0]).not.toBe(MEDIAWIKI_CONFIG.doubleUnderscore[0]);
  });

  it("adds excludes to the minimum config without mutating the input", () => {
    const input = structuredClone(MINIMUM_CONFIG) as ParserConfig;
    delete input.excludes;
    const config = normalizeConfig(input);
    expect(config.excludes).toEqual([]);
    expect(input.excludes).toBeUndefined();
  });

  it("keeps a caller-provided excludes array", () => {
    const input = structuredClone(MINIMUM_CONFIG) as ParserConfig;
    input.excludes = ["heading"];
    expect(normalizeConfig(input).excludes).toEqual(["heading"]);
  });

  it("expands doubleUnderscore maps into parser arrays", () => {
    const config = normalizeConfig();
    expect(config.doubleUnderscore[0]).toContain("toc");
    expect(config.doubleUnderscore[0]).toContain("notoc");
    expect(config.doubleUnderscore[1].length).toBeGreaterThan(0);
  });

  it("rejects a non-object config", () => {
    expect(() => normalizeConfig([] as never)).toThrowError(WikitextParseError);
  });

  it.each([
    ["html", { html: [[]] }],
    ["parserFunction", { parserFunction: [] }],
    ["doubleUnderscore", { doubleUnderscore: [[]] }],
    ["namespaces", { namespaces: [] }],
    ["nsid", { nsid: null }],
    ["ext", { ext: null }],
    ["img", { img: [] }],
  ])("rejects a malformed %s", (_field, override) => {
    const input = { ...structuredClone(MINIMUM_CONFIG), ...override } as never;
    expect(() => normalizeConfig(input)).toThrowError(WikitextParseError);
    try {
      normalizeConfig(input);
    } catch (error) {
      expect((error as WikitextParseError).code).toBe("INVALID_CONFIG");
    }
  });
});
