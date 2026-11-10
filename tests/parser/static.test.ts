import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { moduleReferences } from "../helpers/imports";
import { readSourceEntries, readSourceFiles } from "../helpers/sources";

function valueReferences(directory: string): Array<{ file: string; specifier: string }> {
  return readSourceEntries(directory).flatMap(({ file, code }) =>
    moduleReferences(file, code)
      .filter((reference) => reference.kind === "value")
      .map((reference) => ({ file, specifier: reference.specifier })),
  );
}

describe("module reference parsing", () => {
  it("distinguishes type-only imports from value imports", () => {
    const references = moduleReferences(
      "sample.ts",
      [
        'import type { A } from "./a";',
        'import { type B, C } from "./b";',
        'export type { D } from "./d";',
        'export { E } from "./e";',
        'import "./side-effect";',
        'const lazy = import("./lazy");',
        'const typed: import("./typed").T = {} as never;',
      ].join("\n"),
    );
    expect(references).toEqual([
      { specifier: "./a", kind: "type" },
      { specifier: "./b", kind: "value" },
      { specifier: "./d", kind: "type" },
      { specifier: "./e", kind: "value" },
      { specifier: "./side-effect", kind: "value" },
      { specifier: "./lazy", kind: "value" },
      { specifier: "./typed", kind: "type" },
    ]);
  });
});

describe("layer boundaries", () => {
  const parserLayers = [
    "src/parse",
    "src/ast",
    "src/normalize",
    "src/configs",
    "src/expand",
  ].flatMap(readSourceFiles);

  it("does not call Node-only parser APIs at runtime", () => {
    expect(parserLayers.length).toBeGreaterThan(0);
    for (const source of parserLayers) {
      expect(source).not.toMatch(/\btoHtml\s*\(/u);
      expect(source).not.toMatch(/\bquerySelectorAll\s*\(/u);
      expect(source).not.toMatch(/\bgetAttr(?:ibute)?\s*\(/u);
      expect(source).not.toMatch(/\bjson\s*\(/u);
    }
  });

  it("does not depend on React, CodeMirror, or DOM globals", () => {
    for (const source of parserLayers) {
      expect(source).not.toMatch(/from\s+['"]react['"]/u);
      expect(source).not.toMatch(/@codemirror/u);
      expect(source).not.toMatch(/\bwindow\./u);
      expect(source).not.toMatch(/\bglobalThis\.document\b/u);
    }
  });

  it("does not let view load the parser", () => {
    const sources = readSourceFiles("src/view");
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source).not.toMatch(/wikiparser-node/u);
      expect(source).not.toMatch(/from\s+["'][^"']*loadParser/u);
      expect(source).not.toMatch(/from\s+["']\.\.\/parse/u);
      expect(source).not.toMatch(/from\s+["']\.\.\/configs/u);
    }
  });

  it("keeps view value imports away from the sanitizer implementation", () => {
    for (const { file, specifier } of valueReferences("src/view")) {
      expect(specifier, `${file}: ${specifier}`).not.toMatch(/(?:^|\/)hast\/sanitize$/u);
      expect(specifier, `${file}: ${specifier}`).not.toBe("entities");
      expect(specifier, `${file}: ${specifier}`).not.toBe("hast-util-sanitize");
    }
  });

  it("keeps HAST value imports away from parser orchestration", () => {
    for (const { file, specifier } of valueReferences("src/hast")) {
      expect(specifier, `${file}: ${specifier}`).not.toMatch(
        /(?:^|\/)ast\/parser$|(?:^|\/)ast$|(?:^|\/)normalize(?:\/|$)|(?:^|\/)parse(?:\/|$)|(?:^|\/)configs(?:\/|$)/u,
      );
    }
  });

  it("keeps hast and unified independent from React and the default parser", () => {
    for (const directory of ["src/hast", "src/unified"]) {
      for (const { file, specifier } of valueReferences(directory)) {
        expect(specifier, `${file}: ${specifier}`).not.toBe("react");
        expect(specifier, `${file}: ${specifier}`).not.toMatch(/^react(?:-dom)?\//u);
        expect(specifier, `${file}: ${specifier}`).not.toMatch(/wikiparser-node/u);
        expect(specifier, `${file}: ${specifier}`).not.toMatch(
          /(?:^|\/)parse\/loadParser(?:\/|$)|(?:^|\/)configs(?:\/|$)/u,
        );
      }
    }
  });

  it("keeps the root entry limited to view, source component and parser-free errors", () => {
    const code = readFileSync("src/index.ts", "utf8");
    const values = moduleReferences("src/index.ts", code)
      .filter((reference) => reference.kind === "value")
      .map((reference) => reference.specifier);
    expect(values).toEqual(["./view", "./Wikitext", "./ast/errors"]);
    // 错误类只能依赖类型与自身，不能把解析器带进根入口。
    expect(readFileSync("src/ast/errors.ts", "utf8")).not.toMatch(/wikiparser-node|loadParser/u);
    expect(code).not.toMatch(/devtools|AstTree|NodeInspector/u);
  });

  it("keeps devtools independent from parser orchestration and the render pipeline", () => {
    const sources = readSourceFiles("src/devtools");
    expect(sources.length).toBeGreaterThan(0);
    for (const { file, specifier } of valueReferences("src/devtools")) {
      expect(specifier, `${file}: ${specifier}`).not.toMatch(
        /wikiparser-node|loadParser|(?:^|\/)parse(?:\/|$)|(?:^|\/)configs(?:\/|$)|(?:^|\/)normalize(?:\/|$)|(?:^|\/)hast(?:\/|$)|(?:^|\/)view(?:\/|$)/u,
      );
      expect(specifier, `${file}: ${specifier}`).not.toMatch(/^react-dom(?:\/|$)/u);
    }
  });

  it("keeps the expand layer independent from React, HAST and view", () => {
    const sources = readSourceFiles("src/expand");
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source).not.toMatch(/from\s+["'][^"']*\/hast/u);
      expect(source).not.toMatch(/from\s+["'][^"']*\/view/u);
      expect(source).not.toMatch(/hast-util/u);
      expect(source).not.toMatch(/from\s+["']react(?:\/|["'])/u);
      expect(source).not.toMatch(/react-dom/u);
      expect(source).not.toMatch(/from\s+["']unified["']/u);
      expect(source).not.toMatch(/from\s+["']vfile["']/u);
    }
  });

  it("does not export the expand entry from the root entry", () => {
    const root = readFileSync("src/index.ts", "utf8");
    expect(root).not.toMatch(/from\s+["']\.\/expand/u);
    expect(root).not.toMatch(/\bexpandWikitext\b/u);
  });
});
