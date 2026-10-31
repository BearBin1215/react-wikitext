import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

interface SampleCorpusFixture {
  file: string;
  title: string;
  notes: string;
  text: string;
}

interface ManifestEntry {
  file: string;
  title: string;
  notes: string;
}

const fixtureDir = fileURLToPath(new URL("../fixtures/samples/", import.meta.url));

export function loadSampleCorpusFixtures(): SampleCorpusFixture[] {
  const manifest = JSON.parse(
    readFileSync(join(fixtureDir, "manifest.json"), "utf8"),
  ) as ManifestEntry[];
  return manifest.map((entry) => ({
    file: entry.file,
    title: entry.title,
    notes: entry.notes,
    text: readFileSync(join(fixtureDir, entry.file), "utf8"),
  }));
}
