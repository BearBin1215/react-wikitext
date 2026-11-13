import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { flattenNodes } from "@/ast";
import { createTemplateTableProvider } from "@/expand";
import type { WikitextStageName, WikitextStageSink } from "@/instrumentation";
import {
  prepareWikitext,
  restoreWikitextRenderSnapshot,
  serializeWikitextRenderSnapshot,
} from "@/hast";
import { createWikiparser } from "@/parse";
import { WikitextView } from "@/view";
import { expandWikitext } from "../helpers/expand";
import { buildFixture } from "../helpers/fixtures";
import { ZH_CONFIG } from "../helpers/configs";

const OUTPUT_DIR = resolve("test-results/bench");
const REPORT_PATH = resolve(OUTPUT_DIR, "report.json");
const SUMMARY_PATH = resolve(OUTPUT_DIR, "summary.md");
const WARMUP = 2;
const SAMPLES = 10;

const parser = createWikiparser({ config: ZH_CONFIG });

interface StageResult {
  readonly samples: readonly number[];
  readonly median: number;
  readonly p25: number;
  readonly p75: number;
}

interface ProfiledMeasurement {
  readonly total: StageResult;
  readonly phases: Readonly<Record<string, StageResult>>;
}

function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 1) {
    return sorted[0]!;
  }
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function summarize(samples: readonly number[]): StageResult {
  // oxlint-disable-next-line unicorn/no-array-sort -- ES2022 target has no toSorted
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    samples,
    median: quantile(sorted, 0.5),
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
  };
}

async function measure(run: () => unknown | Promise<unknown>): Promise<StageResult> {
  for (let index = 0; index < WARMUP; index++) {
    await run();
  }
  const samples: number[] = [];
  for (let index = 0; index < SAMPLES; index++) {
    const started = performance.now();
    await run();
    samples.push(performance.now() - started);
  }
  return summarize(samples);
}

/**
 * 同时记录总耗时与阶段耗时。
 *
 * 阶段由 `src/instrumentation.ts` 的 sink 上报；未执行的阶段补 0 样本，
 * 让报告与校验器对每个阶段都拿到固定数量的样本。
 */
async function measureProfiled(
  run: (sink: WikitextStageSink | undefined) => unknown | Promise<unknown>,
): Promise<ProfiledMeasurement> {
  for (let index = 0; index < WARMUP; index++) {
    await run(undefined);
  }
  const totals: number[] = [];
  const phaseSamples = new Map<WikitextStageName, number[]>();
  for (let index = 0; index < SAMPLES; index++) {
    const collected = new Map<WikitextStageName, number>();
    const started = performance.now();
    await run((stage, durationMs) => {
      collected.set(stage, (collected.get(stage) ?? 0) + durationMs);
    });
    totals.push(performance.now() - started);
    for (const [stage, durationMs] of collected) {
      const samples = phaseSamples.get(stage) ?? [];
      samples.push(durationMs);
      phaseSamples.set(stage, samples);
    }
  }
  const phases: Record<string, StageResult> = {};
  for (const [stage, samples] of phaseSamples) {
    while (samples.length < SAMPLES) {
      samples.push(0);
    }
    phases[stage] = summarize(samples);
  }
  return { total: summarize(totals), phases };
}

function countHast(node: unknown): number {
  const candidate = node as { children?: readonly unknown[] };
  return (
    1 + (candidate.children ?? []).reduce<number>((total, child) => total + countHast(child), 0)
  );
}

function git(args: readonly string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

interface FixtureReport {
  readonly name: string;
  readonly kind: string;
  readonly degraded: boolean;
  readonly sourceChars: number;
  readonly sourceSummary: string;
  readonly nodeCounts: Record<string, number>;
  readonly stages: Record<string, StageResult>;
}

async function main(): Promise<void> {
  rmSync(OUTPUT_DIR, { recursive: true, force: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const articleSource = buildFixture(20_000);
  const denseSource = Array.from({ length: 2_400 }, (_, index) => `* item ${index}`).join("\n\n");
  const tableSource = [
    "== Tables ==",
    ...Array.from({ length: 40 }, (_, index) =>
      [
        '{| class="wikitable"',
        "|+ Caption",
        "! A !! B",
        "|-",
        `| value ${index} || [[Link ${index}|label]]`,
        "|}",
        `<ref name="r${index}">note ${index}</ref>`,
      ].join("\n"),
    ),
  ].join("\n\n");

  const templates: Record<string, string> = {
    "Template:Left": "| {{{1}}} || {{{2}}}\n|-\n",
    "Template:Right": "| {{{1}}} || {{{2}}}\n|-\n",
    "Template:Nested": "{{Left|a|{{Right|b|c}}}}",
    "Template:List": "* {{{1}}}\n* {{{2}}}\n",
  };
  const repeated = `${"{{Nested}}".repeat(100)}\n${"{{List|x|y}}".repeat(100)}`;
  const deepTemplates = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [
      `Template:D${index}`,
      index === 11 ? "end" : `{{D${index + 1}}}`,
    ]),
  );
  const degraded = "{{Missing}} and {{#if:a|b}}";

  const fixtures: FixtureReport[] = [];

  const article = parser.parse(articleSource, { pageName: "Bench article" });
  const articlePrepared = prepareWikitext(article);
  const articlePrepare = await measureProfiled((sink) => {
    const prepared = prepareWikitext(article, sink === undefined ? {} : { profile: sink });
    if (prepared.hast.children.length === 0) {
      throw new Error("empty prepared document");
    }
    return prepared;
  });
  const serializedArticle = serializeWikitextRenderSnapshot(articlePrepared);
  fixtures.push({
    name: "article-20k",
    kind: "regular",
    degraded: false,
    sourceChars: articleSource.length,
    sourceSummary: "headings, links, lists, tables, templates, refs and HTML blocks",
    nodeCounts: {
      semantic: flattenNodes(article.ast).length,
      hast: countHast(articlePrepared.hast),
    },
    stages: {
      parse: await measure(() => parser.parse(articleSource, { pageName: "Bench article" })),
      prepare: articlePrepare.total,
      ...articlePrepare.phases,
      serialize: await measure(() => serializeWikitextRenderSnapshot(articlePrepared)),
      restore: await measure(() => {
        const restored = restoreWikitextRenderSnapshot(serializedArticle);
        if (restored.hast.children.length === 0) {
          throw new Error("empty restored document");
        }
      }),
      render: await measure(() => {
        const html = renderToStaticMarkup(
          createElement(WikitextView, { snapshot: articlePrepared }),
        );
        if (html.length === 0) {
          throw new Error("empty HTML");
        }
      }),
    },
  });

  const dense = parser.parse(denseSource, { pageName: "Bench lists" });
  fixtures.push({
    name: "dense-lists",
    kind: "dense-list",
    degraded: false,
    sourceChars: denseSource.length,
    sourceSummary: "2400 independent list items",
    nodeCounts: { semantic: flattenNodes(dense.ast).length },
    stages: {
      parse: await measure(() => parser.parse(denseSource, { pageName: "Bench lists" })),
    },
  });

  const tableDocument = parser.parse(tableSource, { pageName: "Bench tables" });
  const tablePrepared = prepareWikitext(tableDocument);
  fixtures.push({
    name: "tables-references",
    kind: "prepare",
    degraded: false,
    sourceChars: tableSource.length,
    sourceSummary: "40 tables with captions plus references",
    nodeCounts: {
      semantic: flattenNodes(tableDocument.ast).length,
      hast: countHast(tablePrepared.hast),
    },
    stages: {
      prepare: await measure(() => {
        const prepared = prepareWikitext(tableDocument);
        if (prepared.headings.length === 0) {
          throw new Error("fixture lost its headings");
        }
      }),
    },
  });

  // 模板表在每次采样内都会复制一次；用 1000 条记录把复制成本单独列出来。
  const largeTable = Object.fromEntries(
    Array.from({ length: 1_000 }, (_, index) => [`Template:T${index}`, `body ${index} {{{1|}}}`]),
  );
  fixtures.push({
    name: "provider-table-1k",
    kind: "expand",
    degraded: false,
    sourceChars: largeTable["Template:T0"]!.length,
    sourceSummary: "1000-entry template table copied per construction",
    nodeCounts: { templates: 1_000 },
    stages: {
      copy: await measure(() =>
        createTemplateTableProvider({ key: "bench", revision: "v1", templates: largeTable }),
      ),
    },
  });

  const expandRepeated = await measureProfiled((sink) =>
    expandWikitext(repeated, {
      parser,
      templates,
      ...(sink === undefined ? {} : { profile: sink }),
    }),
  );
  const expandRepeatedRun = await expandWikitext(repeated, { parser, templates });
  expect(expandRepeatedRun.expansion.status).toBe("complete");
  fixtures.push({
    name: "expand-repeated",
    kind: "expand",
    degraded: false,
    sourceChars: repeated.length,
    sourceSummary: "100 repeated nested template calls plus 100 list calls",
    nodeCounts: {
      records: expandRepeatedRun.expansion.records.length,
      expandedChars: expandRepeatedRun.snapshot.source.length,
    },
    stages: {
      expand: expandRepeated.total,
      ...Object.fromEntries(
        Object.entries(expandRepeated.phases).map(([stage, result]) => [`expand:${stage}`, result]),
      ),
    },
  });

  const expandNested = await expandWikitext("{{D0}}", {
    parser,
    templates: deepTemplates,
  });
  expect(expandNested.snapshot.source).toBe("end");
  fixtures.push({
    name: "expand-nested",
    kind: "expand",
    degraded: false,
    sourceChars: "{{D0}}".length,
    sourceSummary: "12-level nested template calls",
    nodeCounts: { records: expandNested.expansion.records.length },
    stages: {
      expand: await measure(() =>
        expandWikitext("{{D0}}", {
          parser,
          templates: deepTemplates,
        }),
      ),
    },
  });

  const expandDegraded = await expandWikitext(degraded, { parser });
  expect(expandDegraded.expansion.status).toBe("partial");
  fixtures.push({
    name: "expand-degraded",
    kind: "expand",
    degraded: true,
    sourceChars: degraded.length,
    sourceSummary: "missing template and unsupported parser function",
    nodeCounts: {
      records: expandDegraded.expansion.records.length,
      diagnostics: expandDegraded.expansion.diagnostics.length,
    },
    stages: {
      expand: await measure(async () => {
        const result = await expandWikitext(degraded, { parser });
        if (result.expansion.status !== "partial") {
          throw new Error(`unexpected expanded status: ${result.expansion.status}`);
        }
      }),
    },
  });

  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    name: string;
    version: string;
  };

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    package: { name: packageJson.name, version: packageJson.version },
    git: {
      commit: git(["rev-parse", "HEAD"]),
      dirty: (git(["status", "--porcelain"]) ?? "") !== "",
    },
    environment: {
      node: process.version,
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model ?? "unknown",
      cpus: cpus().length,
      totalMemoryMb: Math.round(totalmem() / 1024 / 1024),
    },
    parser: { name: parser.name, version: parser.version },
    sampling: { warmup: WARMUP, samples: SAMPLES, unit: "ms" },
    fixtures,
  };

  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    "# Benchmark summary",
    "",
    `Generated: ${report.generatedAt}`,
    `Node: ${report.environment.node}; parser: ${report.parser.name}@${report.parser.version}`,
    `Commit: ${report.git.commit ?? "unknown"}${report.git.dirty ? " (dirty)" : ""}`,
    "",
    "| Fixture | Stage | Samples | Median (ms) | IQR (ms) |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const fixture of fixtures) {
    for (const [stage, result] of Object.entries(fixture.stages)) {
      lines.push(
        `| ${fixture.name}${fixture.degraded ? " (degraded)" : ""} | ${stage} | ${result.samples.length} | ${result.median.toFixed(2)} | ${result.p25.toFixed(2)}–${result.p75.toFixed(2)} |`,
      );
    }
  }
  writeFileSync(SUMMARY_PATH, `${lines.join("\n")}\n`);
  console.log(`Benchmark report written to ${REPORT_PATH}`);
}

const REQUIRED_STAGES = new Set([
  "parse",
  "prepare",
  "prepare-clone",
  "prepare-plugin",
  "prepare-convert",
  "prepare-rehype",
  "prepare-assemble",
  "serialize",
  "restore",
  "render",
  "expand",
  "expand:normalize",
  "expand:page-syntax",
  "expand:template",
  "expand:evaluate",
  "expand:fetch",
  "expand:assemble",
  "expand:final-syntax",
  "expand:build",
  "copy",
]);

describe("performance report", () => {
  it("measures parse, prepare, render and expand and writes a report", async () => {
    await main();
    const report = JSON.parse(readFileSync(REPORT_PATH, "utf8")) as {
      fixtures: readonly { stages: Record<string, unknown> }[];
    };
    const stages = new Set(report.fixtures.flatMap((fixture) => Object.keys(fixture.stages)));
    for (const stage of REQUIRED_STAGES) {
      expect(stages.has(stage)).toBe(true);
    }
  }, 600_000);
});
