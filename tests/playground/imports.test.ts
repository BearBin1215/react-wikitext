import { dirname, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { moduleReferences } from "../helpers/imports";
import { readSourceEntries } from "../helpers/sources";

const ALLOWED_SUBPATHS = new Set([
  "ast",
  "parse",
  "expand",
  "hast",
  "unified",
  "view",
  "configs",
  "devtools",
  "styles.css",
  "devtools.css",
]);

const LIBRARY_SOURCE = resolve("src");
const PLAYGROUND_SOURCE = resolve("playground/src");

/** 验收台的 fixture 例外：只允许读取仓库内的测试语料，不接受任意相对路径。 */
const ALLOWED_RELATIVE_ROOTS = [resolve("tests/fixtures")];

describe("playground imports", () => {
  it("only consumes the library through public entry points", () => {
    for (const { file, code } of readSourceEntries("playground/src")) {
      for (const { specifier } of moduleReferences(file, code)) {
        expect(specifier.startsWith("@/"), `${file}: ${specifier}`).toBe(false);
        if (specifier.startsWith("react-wikitext/")) {
          const subpath = specifier.slice("react-wikitext/".length);
          expect(ALLOWED_SUBPATHS.has(subpath), `${file}: ${specifier}`).toBe(true);
        }
        if (specifier.startsWith(".")) {
          // 相对路径可以绕过 specifier 检查，因此直接断言解析结果不在 src/ 下。
          const target = resolve(dirname(file), specifier);
          const inside = (root: string): boolean =>
            target === root || target.startsWith(root + sep);
          const allowed =
            !inside(LIBRARY_SOURCE) &&
            (inside(PLAYGROUND_SOURCE) || ALLOWED_RELATIVE_ROOTS.some(inside));
          expect(allowed, `${file}: ${specifier} → ${target}`).toBe(true);
        }
      }
    }
  });
});
