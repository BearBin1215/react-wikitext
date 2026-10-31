// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compareRanges } from "../helpers/parse";
import { ZH_CONFIG } from "../helpers/configs";
import { loadSampleCorpusFixtures } from "../helpers/sampleCorpus";

const pages = loadSampleCorpusFixtures();

describe("sample corpus fixtures", () => {
  it("parses sample pages and matches oracle ranges", () => {
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      const source = page.text.replace(/\r\n?/gu, "\n");
      const differences = compareRanges(source, ZH_CONFIG);
      const message = differences
        .slice(0, 5)
        .map(
          (diff) =>
            `${page.file} (${page.title}) ${diff.path} <${diff.type}> expected [${diff.expected.join("-")}] actual [${diff.actual.join("-")}]${diff.zeroLength ? " (zero-length)" : ""}`,
        )
        .join("\n");
      expect(message).toBe("");
    }
  }, 120_000);
});
