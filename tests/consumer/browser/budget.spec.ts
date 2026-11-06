import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const OUT = resolve("test-results/budget");

test.describe("@budget", () => {
  test("omitted fillers keep real content and avoid horizontal overflow", async ({ page }) => {
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

    await page.goto("/budget/");
    await expect(page.locator("table").first()).toBeVisible();

    const layout = await page.evaluate(() => {
      const tables = [...document.querySelectorAll("table")];
      const first = tables[0];
      const rows = first ? [...first.querySelectorAll(":scope > tbody > tr")] : [];
      return {
        tables: tables.length,
        fillerCells: document.querySelectorAll("td.wikitext-table__cell--filler").length,
        realCells: document.querySelectorAll("td.wikitext-table__cell").length,
        firstRowCells: rows[0]?.querySelectorAll(":scope > td, :scope > th").length ?? 0,
        secondRowCells: rows[1]?.querySelectorAll(":scope > td, :scope > th").length ?? 0,
        text: first?.textContent?.includes("y") ?? false,
        horizontalOverflow:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
        hostScrolls: (() => {
          const main = document.querySelector("main");
          return main ? main.scrollWidth > main.clientWidth : false;
        })(),
      };
    });

    expect(layout.tables).toBe(45);
    expect(layout.fillerCells).toBe(0);
    expect(layout.realCells).toBeGreaterThan(0);
    expect(layout.firstRowCells).toBe(100);
    expect(layout.secondRowCells).toBe(1);
    expect(layout.text).toBe(true);
    // 100 列的稀疏表仍然很宽；由宿主容器横向滚动，页面本身不产生横向滚动。
    expect(layout.horizontalOverflow).toBe(false);
    expect(layout.hostScrolls).toBe(true);

    mkdirSync(OUT, { recursive: true });
    writeFileSync(resolve(OUT, "dom.json"), `${JSON.stringify(layout, null, 2)}\n`);
    await page.screenshot({ path: resolve(OUT, "layout.png"), fullPage: true });
    expect(errors).toEqual([]);
  });
});
