import { expect, test, type Page } from "@playwright/test";

interface ConsumerResult {
  readonly type?: string;
  readonly message?: string;
  readonly parser?: string;
  readonly parserVersion?: string;
  readonly sourceLength?: number;
  readonly nodes?: number;
  readonly heading?: string | null;
  readonly paragraph?: string | null;
  readonly link?: { text: string; href: string | null; tag: string | null } | null;
  readonly tableCells?: readonly string[];
  readonly expansionStatus?: string;
  readonly recordCount?: number;
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("requestfailed", (request) => {
    errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ""}`);
  });
  return errors;
}

async function readResult(page: Page): Promise<ConsumerResult> {
  await page.waitForFunction(
    () => Boolean((globalThis as { consumerResult?: unknown }).consumerResult),
    undefined,
    { timeout: 30_000 },
  );
  return page.evaluate(
    () => (globalThis as { consumerResult?: ConsumerResult }).consumerResult as ConsumerResult,
  );
}

function expectParseResult(result: ConsumerResult): void {
  expect(result.parser).toBe("wikiparser-node");
  expect(result.parserVersion).toBe("1.48.2");
  expect(result.sourceLength).toBeGreaterThan(0);
  expect(result.nodes).toBeGreaterThan(0);
  expect(result.heading).toBe("Head");
  expect(result.link?.text).toBe("label");
  expect(result.tableCells).toEqual(["a", "b"]);
}

async function expectRootDom(page: Page): Promise<void> {
  await expect(page.locator("h2")).toHaveText("Head");
  await expect(page.locator(".wikitext-link").first()).toHaveText("label");
  await expect(page.locator("table td").first()).toHaveText("a");
  await expect(page.locator("table td").nth(1)).toHaveText("b");
}

function parserInitialized(page: Page): Promise<boolean> {
  return page.evaluate(() => typeof (globalThis as { Parser?: unknown }).Parser !== "undefined");
}

test.describe("@consumer vite", () => {
  test("parse-only page executes parse and prepare without the root entry", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/vite/parse.html");
    expectParseResult(await readResult(page));
    expect(await parserInitialized(page)).toBe(true);
    await expect(page.locator("#root")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("root component page renders the same fixture", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/vite/index.html");
    await expectRootDom(page);
    expect(await parserInitialized(page)).toBe(true);
    expect(errors).toEqual([]);
  });

  test("module worker parses and expands without posting functions", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/vite/worker.html");
    const result = await readResult(page);
    expect(result.type).toBe("result");
    expect(result.parser).toBe("wikiparser-node");
    expect(result.expansionStatus).toBe("complete");
    expect(result.recordCount).toBe(1);
    expect(result.heading).toBe("Worker");
    expect(result.paragraph).toContain("Hello Ada!");
    expect(result.link?.text).toBe("link");
    expect(errors).toEqual([]);
  });
});

test.describe("@consumer webpack", () => {
  test("parse-only page executes parse and prepare without the root entry", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/webpack/parse.html");
    expectParseResult(await readResult(page));
    expect(await parserInitialized(page)).toBe(true);
    await expect(page.locator("#root")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("root component page renders the same fixture", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/webpack/index.html");
    await expectRootDom(page);
    expect(await parserInitialized(page)).toBe(true);
    expect(errors).toEqual([]);
  });

  test("worker parses and expands with its own bundle", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/webpack/worker-page.html");
    const result = await readResult(page);
    expect(result.type).toBe("result");
    expect(result.parser).toBe("wikiparser-node");
    expect(result.expansionStatus).toBe("complete");
    expect(result.recordCount).toBe(1);
    expect(result.heading).toBe("Worker");
    expect(result.paragraph).toContain("Hello Ada!");
    expect(result.link?.text).toBe("link");
    expect(errors).toEqual([]);
  });
});

test.describe("@consumer view", () => {
  test("Vite view-only page renders a pre-prepared snapshot without the parser", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.goto("/view-vite/");
    await expect(page.locator("h2")).toHaveText("Head");
    await expect(page.locator(".wikitext-link").first()).toHaveText("label");
    expect(await parserInitialized(page)).toBe(false);
    expect(errors).toEqual([]);
  });

  test("webpack view-only page renders the same snapshot without the parser", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/view-webpack/");
    await expect(page.locator("h2")).toHaveText("Head");
    await expect(page.locator(".wikitext-link").first()).toHaveText("label");
    expect(await parserInitialized(page)).toBe(false);
    expect(errors).toEqual([]);
  });
});
