import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const EVIDENCE_DIR = resolve("test-results/a11y");

/**
 * axe 无法自动判定、需要人工复核的项目。新增条目必须先给出理由，
 * 不允许用“忽略全部 incomplete”代替逐项归类。
 */
const CLASSIFIED_INCOMPLETE: Readonly<Record<string, string>> = {
  "color-contrast":
    "引用上标/回链只包含 [N]/↑ 等非文本字符，缩略图说明是浮动 table-caption；axe 无法可靠计算这两类前景色，人工核对沿用 token 颜色，待屏幕阅读器抽查记录。",
  "label-content-name-mismatch":
    "可见文本是 [N]，可访问名称是 Reference N；数字一致，但 [ ] 不计入文本，待人工语音控制抽查。",
};

interface Focused {
  readonly tag: string;
  readonly className: string;
  readonly text: string;
  readonly href: string | null;
  readonly outlineStyle: string;
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    // 错误边界场景会主动抛出 fixture failure；React 会把它打到 console，属于预期输入。
    if (message.type() === "error" && !message.text().includes("fixture failure")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("requestfailed", (request) => {
    errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ""}`);
  });
  return errors;
}

async function scan(page: Page, name: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    resolve(EVIDENCE_DIR, `${name}.json`),
    `${JSON.stringify(
      {
        url: page.url(),
        tags: TAGS,
        violations: results.violations,
        incomplete: results.incomplete.map((item) => ({
          id: item.id,
          impact: item.impact,
          targets: item.nodes.map((node) => node.target),
          classification: CLASSIFIED_INCOMPLETE[item.id] ?? null,
        })),
      },
      null,
      2,
    )}\n`,
  );
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
  expect(
    results.incomplete
      .filter((item) => CLASSIFIED_INCOMPLETE[item.id] === undefined)
      .map((item) => item.id),
  ).toEqual([]);
  // 例外只覆盖引用上标与浮动缩略图说明，不能扩散到其他元素。
  const classifiedTargets = results.incomplete
    .filter((item) => CLASSIFIED_INCOMPLETE[item.id] !== undefined)
    .flatMap((item) => item.nodes.map((node) => node.target.join(" ")));
  expect(
    classifiedTargets.every(
      (target) => target.includes("cite_ref") || target.includes("figcaption"),
    ),
  ).toBe(true);
}

async function focused(page: Page): Promise<Focused> {
  return page.evaluate(() => {
    const element = globalThis.document.activeElement as HTMLElement | null;
    return {
      tag: element?.tagName.toLowerCase() ?? "",
      className: typeof element?.className === "string" ? element.className : "",
      text: element?.textContent?.trim().slice(0, 80) ?? "",
      href: element instanceof HTMLAnchorElement ? element.getAttribute("href") : null,
      outlineStyle: element ? getComputedStyle(element).outlineStyle : "",
    };
  });
}

async function tabUntil(page: Page, predicate: (value: Focused) => boolean): Promise<Focused> {
  const seen: string[] = [];
  let previous = "";
  for (let index = 0; index < 250; index++) {
    // oxlint-disable-next-line no-await-in-loop -- 键盘焦点必须按顺序推进
    await page.keyboard.press("Tab");
    // oxlint-disable-next-line no-await-in-loop -- 每次读取当前焦点元素
    const value = await focused(page);
    const key = `${value.tag}.${value.className}.${value.href ?? ""}`;
    if (key === previous && value.tag !== "body") {
      throw new Error(`Focus appears trapped on ${key}`);
    }
    previous = key;
    seen.push(key);
    if (predicate(value)) {
      return value;
    }
  }
  throw new Error(`Focus target not reachable. Visited: ${seen.slice(-10).join(" | ")}`);
}

test.describe("@a11y", () => {
  test("default reading page has no WCAG 2.1 A/AA violations in light theme", async ({
    page,
  }, testInfo) => {
    const errors = collectErrors(page);
    await page.goto("/a11y/");
    await expect(page.locator(".wikitext-view").first()).toBeVisible();
    await expect(page.locator(".wikitext-toc").first()).toBeVisible();
    await expect(page.locator(".wikitext-references").first()).toBeVisible();
    await scan(page, "light");
    await testInfo.attach("a11y-light", {
      path: resolve(EVIDENCE_DIR, "light.json"),
      contentType: "application/json",
    });
    expect(errors).toEqual([]);
  });

  test("explicit dark theme has no WCAG 2.1 A/AA violations", async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await page.goto("/a11y/dark.html");
    const main = page.locator("main[data-wikitext-theme='dark']");
    await expect(main).toBeVisible();
    await expect
      .poll(() => main.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe("rgb(13, 17, 23)");
    await scan(page, "dark");
    await testInfo.attach("a11y-dark", {
      path: resolve(EVIDENCE_DIR, "dark.json"),
      contentType: "application/json",
    });
    expect(errors).toEqual([]);
  });

  test("keyboard reaches TOC, reference and backlink with visible focus", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/a11y/");
    await expect(page.locator(".wikitext-toc").first()).toBeVisible();
    const placeholder = page
      .locator(".wikitext-file")
      .filter({ has: page.locator(".wikitext-file__label") })
      .first();
    await expect(placeholder).toBeVisible();
    await expect(placeholder.locator("a, button, [role='button'], [tabindex]")).toHaveCount(0);

    const toc = await tabUntil(page, (value) => value.className.includes("wikitext-toc__link"));
    expect(toc.outlineStyle).not.toBe("none");
    expect(toc.href).toMatch(/^#/u);
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => globalThis.location.hash)).toBe(toc.href);

    const reference = await tabUntil(page, (value) =>
      value.className.includes("wikitext-ref__link"),
    );
    expect(reference.outlineStyle).not.toBe("none");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => globalThis.location.hash)).toMatch(/cite_note-/u);

    const backlink = await tabUntil(page, (value) =>
      value.className.includes("wikitext-references__backlink"),
    );
    expect(backlink.outlineStyle).not.toBe("none");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => globalThis.location.hash)).toMatch(/cite_ref-/u);

    expect(errors).toEqual([]);
  });
});
