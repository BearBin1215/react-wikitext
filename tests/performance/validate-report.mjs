import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPORT = resolve("test-results/bench/report.json");
const SUMMARY = resolve("test-results/bench/summary.md");

function fail(message) {
  console.error(`Invalid benchmark report: ${message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(REPORT, "utf8"));
} catch (error) {
  fail(`cannot read ${REPORT}: ${error instanceof Error ? error.message : String(error)}`);
}

if (report.schemaVersion !== 1) {
  fail(`unexpected schemaVersion ${report.schemaVersion}`);
}
for (const section of ["package", "git", "environment", "parser", "sampling", "fixtures"]) {
  if (!report[section] || typeof report[section] !== "object") {
    fail(`missing ${section}`);
  }
}
if (report.sampling.warmup < 2 || report.sampling.samples < 10) {
  fail("warmup or sample count below the documented minimum");
}
if (!report.environment.node || !report.parser.name || !report.parser.version) {
  fail("missing environment or parser identity");
}
if (!report.git.commit) {
  fail("missing commit identity");
}

const required = {
  "article-20k": [
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
  ],
  "dense-lists": ["parse"],
  "tables-references": ["prepare"],
  "provider-table-1k": ["copy"],
  "expand-repeated": [
    "expand",
    "expand:normalize",
    "expand:page-syntax",
    "expand:template",
    "expand:evaluate",
    "expand:fetch",
    "expand:assemble",
    "expand:final-syntax",
    "expand:build",
  ],
  "expand-nested": ["expand"],
  "expand-degraded": ["expand"],
};
const byName = new Map(report.fixtures.map((fixture) => [fixture.name, fixture]));
for (const [name, stages] of Object.entries(required)) {
  const fixture = byName.get(name);
  if (!fixture) {
    fail(`missing fixture ${name}`);
  }
  for (const stage of stages) {
    const result = fixture.stages?.[stage];
    if (!result) {
      fail(`missing stage ${name}.${stage}`);
    }
    if (!Array.isArray(result.samples) || result.samples.length !== report.sampling.samples) {
      fail(`stage ${name}.${stage} does not contain ${report.sampling.samples} samples`);
    }
    for (const sample of result.samples) {
      if (!Number.isFinite(sample) || sample < 0) {
        fail(`stage ${name}.${stage} contains an invalid sample`);
      }
    }
    for (const key of ["median", "p25", "p75"]) {
      if (!Number.isFinite(result[key]) || result[key] < 0) {
        fail(`stage ${name}.${stage} has an invalid ${key}`);
      }
    }
  }
  if (!fixture.nodeCounts || Object.keys(fixture.nodeCounts).length === 0) {
    fail(`fixture ${name} has no node counts`);
  }
}
const degraded = byName.get("expand-degraded");
if (!degraded || degraded.degraded !== true) {
  fail("degraded fixture must be marked explicitly");
}
if (!report.fixtures.some((fixture) => fixture.degraded === false)) {
  fail("no successful fixture recorded");
}

try {
  readFileSync(SUMMARY, "utf8");
} catch {
  fail("missing summary.md");
}

console.log(
  `Benchmark report valid: ${report.fixtures.length} fixtures, ${report.sampling.samples} samples, node ${report.environment.node}.`,
);
