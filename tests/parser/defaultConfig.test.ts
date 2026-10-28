import { describe, expect, it } from "vitest";
import parserPackage from "wikiparser-node/package.json";
import upstreamDefault from "wikiparser-node/config/default.json";
import { MEDIAWIKI_CONFIG, createMediaWikiConfig } from "@/configs";
import {
  createWikiparser,
  parseWikitext,
  WikitextParseError,
  type WikitextSyntaxNode,
} from "@/parse";
import { MINIMUM_CONFIG } from "../helpers/configs";
import { PARSER_VERSION } from "@/parse/loadParser";

function flatten(root: WikitextSyntaxNode): WikitextSyntaxNode[] {
  return [root, ...root.children.flatMap((child) => flatten(child))];
}

function typesOf(document: { syntax?: WikitextSyntaxNode }): string[] {
  return document.syntax ? flatten(document.syntax).map((node) => node.type) : [];
}

describe("default config", () => {
  it("keeps PARSER_VERSION in sync with the dependency", () => {
    expect(PARSER_VERSION).toBe(parserPackage.version);
  });

  it("matches the upstream default.json snapshot", () => {
    expect(MEDIAWIKI_CONFIG).toEqual(upstreamDefault);
  });

  it("enables ref, gallery, and file parsing by default", () => {
    const ref = parseWikitext('<ref name="r">note</ref>', { retainSyntax: true });
    expect(typesOf(ref)).toContain("ext");
    expect(flatten(ref.syntax!).find((node) => node.type === "ext")?.props.name).toBe("ref");

    const gallery = parseWikitext("<gallery>File:A.png|Caption\nFile:B.png</gallery>", {
      retainSyntax: true,
    });
    expect(flatten(gallery.syntax!).some((node) => node.type === "gallery-image")).toBe(true);

    const file = parseWikitext("[[File:X.png|thumb|alt=Alt text|Caption]]", {
      retainSyntax: true,
    });
    expect(flatten(file.syntax!).some((node) => node.type === "image-parameter")).toBe(true);
  });

  it("degrades ref and gallery with the upstream minimum config", () => {
    const parser = createWikiparser({ config: MINIMUM_CONFIG });
    const ref = parser.parse('<ref name="r">note</ref>', { retainSyntax: true });
    expect(typesOf(ref)).not.toContain("ext");
    const gallery = parser.parse("<gallery>File:A.png</gallery>", { retainSyntax: true });
    expect(flatten(gallery.syntax!).some((node) => node.type === "gallery-image")).toBe(false);
  });

  it("parses double underscores after normalizing the config", () => {
    const document = parseWikitext("a\n__TOC__\n__NOTOC__\n", { retainSyntax: true });
    expect(typesOf(document)).toContain("double-underscore");
  });

  it("does not mutate the shared default config across parses", () => {
    const before = structuredClone(MEDIAWIKI_CONFIG);
    parseWikitext("__TOC__");
    parseWikitext("__TOC__");
    expect(MEDIAWIKI_CONFIG).toEqual(before);
    expect(MEDIAWIKI_CONFIG.doubleUnderscore[0]).toEqual([]);
    expect(MEDIAWIKI_CONFIG.excludes).toBeUndefined();
  });

  it("freezes the shared config", () => {
    expect(Object.isFrozen(MEDIAWIKI_CONFIG)).toBe(true);
    expect(Object.isFrozen(MEDIAWIKI_CONFIG.namespaces)).toBe(true);
    expect(Object.isFrozen(MEDIAWIKI_CONFIG.html)).toBe(true);
  });

  it("builds an independent config from deep overrides", () => {
    const config = createMediaWikiConfig({ namespaces: { 3000: "Custom" } });
    expect(config.namespaces[3000]).toBe("Custom");
    expect(config.namespaces[6]).toBe("File");
    expect(config).not.toBe(MEDIAWIKI_CONFIG);
    expect(MEDIAWIKI_CONFIG.namespaces[3000]).toBeUndefined();
    expect(() => createMediaWikiConfig({ html: [] as never })).toThrowError(WikitextParseError);
  });
});
