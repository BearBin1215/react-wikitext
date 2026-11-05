import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AST_SCHEMA_VERSION, RENDER_SCHEMA_VERSION, SYNTAX_SCHEMA_VERSION } from "@/ast";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

const SCHEMA_PAGES = [
  "website/docs/zh/project/status.mdx",
  "website/docs/en/project/status.mdx",
  "website/docs/zh/api/ast.mdx",
  "website/docs/en/api/ast.mdx",
] as const;

const SCHEMAS = {
  AST_SCHEMA_VERSION,
  SYNTAX_SCHEMA_VERSION,
  RENDER_SCHEMA_VERSION,
} as const;

describe("documented versions", () => {
  it.each(SCHEMA_PAGES)("%s lists the current schema values", (path) => {
    const content = read(path);
    for (const [name, value] of Object.entries(SCHEMAS)) {
      const match = new RegExp(`\\|\\s*\`${name}\`\\s*\\|\\s*\`(\\d+)\``, "u").exec(content);
      expect(match, `${path} documents ${name}`).not.toBeNull();
      expect(match?.[1], `${path} ${name}`).toBe(String(value));
    }
  });
});
