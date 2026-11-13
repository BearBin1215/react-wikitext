import { expect, test, type Page } from "@playwright/test";

function collectDiagnostics(page: Page) {
  const externalRequests: string[] = [];
  const consoleErrors: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname) && !url.protocol.startsWith("data")) {
      externalRequests.push(request.url());
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  return { externalRequests, consoleErrors };
}

const app = (page: Page) => page.getByTestId("pg-app");
const sourceItem = (page: Page, id: string) =>
  page.locator(`[data-testid="pg-source-item"][data-source-id="${id}"]`);

async function open(page: Page, params: Record<string, string> = {}) {
  const search = new URLSearchParams(params).toString();
  await page.goto(search ? `/?${search}` : "/");
  await expect(app(page)).toHaveAttribute("data-parsing", "false");
}

test("loads the default source through the worker without external requests", async ({ page }) => {
  const { externalRequests, consoleErrors } = collectDiagnostics(page);
  await open(page, { source: "basic" });
  await expect(app(page)).toHaveAttribute("data-source-id", "basic");
  await expect(app(page)).toHaveAttribute("data-worker", "true");
  await expect(app(page)).toHaveAttribute("data-config", "mediawiki");
  await expect(app(page)).toHaveAttribute("data-mode", "source");
  await expect(page.getByTestId("pg-status")).toContainText("Worker");
  await expect(page.locator(".wikitext-tree")).toContainText("root");
  expect(Number(await app(page).getAttribute("data-node-count"))).toBeGreaterThan(0);
  expect(Number(await app(page).getAttribute("data-duration"))).toBeGreaterThanOrEqual(0);
  // 解析完成说明首屏资源请求已全部发出，无需额外的固定等待。
  expect(externalRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("loads the shared sample corpus", async ({ page }) => {
  await open(page, { source: "tables-templates" });
  await expect(app(page)).toHaveAttribute("data-source-group", "corpus");
  await expect(app(page)).toHaveAttribute("data-parsing", "false");
  expect(Number(await app(page).getAttribute("data-node-count"))).toBeGreaterThan(0);
  await expect(page.locator(".wikitext-view")).toBeVisible();
});

test("keeps the sample corpus collapsed until opened", async ({ page }) => {
  await open(page, { source: "basic" });
  await expect(sourceItem(page, "tables-templates")).toHaveCount(0);

  await page.getByTestId("pg-corpus-toggle").click();
  await expect(sourceItem(page, "tables-templates")).toBeVisible();

  await page.getByTestId("pg-corpus-toggle").click();
  await expect(sourceItem(page, "tables-templates")).toHaveCount(0);
});

test("switches scenes and intercepts unsafe links and attributes", async ({ page }) => {
  const { externalRequests } = collectDiagnostics(page);
  await open(page, { source: "basic" });
  await expect(page.locator(".wikitext-view h2").first()).toHaveText("示例条目");
  await sourceItem(page, "security").click();
  await expect(app(page)).toHaveAttribute("data-source-id", "security");
  await expect(app(page)).toHaveAttribute("data-parsing", "false");
  await expect(page.locator(".wikitext-view")).not.toContainText("示例条目");
  await expect(page.locator(".wikitext-link--blocked")).toHaveText("被拒绝的 FTP 链接");

  const safeLink = page.locator(".wikitext-ext-link").first();
  await expect(safeLink).toHaveAttribute("target", "_blank");
  const rel = (await safeLink.getAttribute("rel"))?.split(/\s+/u) ?? [];
  expect(new Set(rel)).toEqual(new Set(["nofollow", "noopener", "noreferrer"]));
  await expect(page.locator(".wikitext-ext-link").nth(1)).toHaveAttribute(
    "href",
    "https://example.com/",
  );

  const div = page.locator(".wikitext-html-div");
  await expect(div).toHaveAttribute("title", "保留 class/title");
  expect(await div.getAttribute("class")).toContain("safe");
  expect(await div.getAttribute("id")).toBeNull();
  // 白名单声明保留；未知属性与含 url() 的声明整条丢弃，不会触发远程请求。
  const style = await div.getAttribute("style");
  expect(style).toContain("color");
  expect(style).not.toContain("position");
  expect(style).not.toContain("url(");
  expect(await div.getAttribute("onclick")).toBeNull();
  expect(externalRequests).toEqual([]);

  const span = page.locator('.wikitext-paragraph span[lang="zh"]');
  await expect(span).toHaveAttribute("dir", "rtl");
  expect(await span.getAttribute("id")).toBeNull();
  expect(await span.getAttribute("style")).toBeNull();
});

test("selecting a tree node selects the source range", async ({ page }) => {
  await open(page, { source: "basic" });
  await page.locator(".wikitext-tree__label").filter({ hasText: "heading" }).first().click();
  await expect(app(page)).toHaveAttribute("data-selected-type", "heading");
  const range = await app(page).getAttribute("data-selected-range");
  expect(range).toMatch(/^\d+,\d+$/u);
  await expect(page.locator(".wikitext-tree__row.is-selected")).toHaveCount(1);
  await expect(page.getByTestId("pg-editor")).toHaveAttribute("data-selection", range!);
});

test("moving the editor cursor selects the tree node", async ({ page }) => {
  await open(page, { source: "basic" });
  await page
    .locator(".cm-line")
    .nth(2)
    .click({ position: { x: 120, y: 8 } });
  await expect(app(page)).not.toHaveAttribute("data-selected-id", "");
  await expect(page.locator(".wikitext-tree__row.is-selected")).toHaveCount(1);
  expect(await app(page).getAttribute("data-selected-type")).toBeTruthy();
});

test("typing updates the preview after debounce and marks the source dirty", async ({ page }) => {
  await open(page, { source: "basic" });
  await page.getByTestId("pg-editor").locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n\n新增段落 MARKER42");
  await expect(page.locator(".wikitext-view")).toContainText("MARKER42", { timeout: 10_000 });
  await expect(app(page)).toHaveAttribute("data-parsing", "false");
  await expect(app(page)).toHaveAttribute("data-dirty", "true");
  await expect(page.locator(".pg-pane__meta--dirty")).toContainText("已修改");
});

test("searches the AST and inspects a node", async ({ page }) => {
  await open(page, { source: "basic" });
  await page.getByLabel("搜索节点").fill("template");
  const result = page.locator(".wikitext-tree__result").first();
  await expect(result).toContainText("template");
  await result.click();
  await expect(app(page)).toHaveAttribute("data-selected-type", "template");
  await expect(page.locator(".wikitext-inspector")).toContainText("{{Infobox");
});

test("navigates and selects with the keyboard in the AST tree", async ({ page }) => {
  await open(page, { source: "basic" });
  const tree = page.locator(".wikitext-tree");
  const tabStop = tree.locator('[role="treeitem"][tabindex="0"]').first();
  await tabStop.focus();
  const startId = await tabStop.getAttribute("data-tree-node-id");

  await page.keyboard.press("ArrowDown");
  const focusedItem = page.locator('.wikitext-tree [role="treeitem"]:focus');
  await expect(focusedItem).toHaveCount(1);
  expect(await focusedItem.getAttribute("data-tree-node-id")).not.toBe(startId);
  await expect(focusedItem.locator(".wikitext-tree__row").first()).toHaveCSS(
    "outline-style",
    "solid",
  );

  await page.keyboard.press("Enter");
  await expect(app(page)).toHaveAttribute("data-selected-type", "heading");

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect(app(page)).toHaveAttribute("data-selected-type", "text");

  const search = page.getByLabel("搜索节点");
  await search.fill("template");
  await expect(page.locator(".wikitext-tree__result").first()).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".wikitext-tree__result:focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
});

test("expands mock templates, reports records, and falls back on demand", async ({ page }) => {
  await open(page, { source: "templates", expand: "1" });
  await expect(app(page)).toHaveAttribute("data-expansion", "partial");
  const view = page.locator(".wikitext-view");
  await expect(view).toContainText("条件为真");
  await expect(view).toContainText("带 | 分隔符");
  await expect(view).not.toContainText("模板未展开: Demo/Box");

  await page.getByTestId("pg-tab-diagnostics").click();
  const diagnostics = page.getByTestId("pg-diagnostics");
  await expect(diagnostics).toContainText("展开记录");
  await expect(diagnostics).toContainText("TEMPLATE_NOT_FOUND");
  await expect(diagnostics).toContainText("TEMPLATE_LOOP");
  await expect(diagnostics).toContainText("展开诊断（真实来源）");

  await page.getByLabel("模拟最终解析失败").check();
  await expect(app(page)).toHaveAttribute("data-expansion", "fallback");
  await expect(page.getByTestId("pg-status")).toContainText("展开 fallback");
  await expect(diagnostics).toContainText("FINAL_PARSE_FALLBACK");

  await page.getByTestId("pg-tab-preview").click();
  await expect(page.locator(".wikitext-view")).toContainText("模板未展开: Demo/Box");
});

test("reports complete expansion for a successful mock template", async ({ page }) => {
  await open(page, { source: "freeform", expand: "1" });
  await page.getByTestId("pg-editor").locator(".cm-content").click();
  await page.keyboard.type("{{Demo/Echo|ok}}");
  await expect(page.locator(".wikitext-view")).toContainText("ok", { timeout: 10_000 });
  await expect(app(page)).toHaveAttribute("data-parsing", "false");
  await expect(app(page)).toHaveAttribute("data-expansion", "complete");
});

test("toggles resolvers inside the resolver scene", async ({ page }) => {
  await open(page, { source: "resolvers" });
  const linkToggle = page.getByLabel("链接 resolver");
  const imageToggle = page.getByLabel("图片 resolver");
  await expect(linkToggle).toBeChecked();
  await expect(imageToggle).toBeChecked();
  await expect(page.locator(".wikitext-link--resolved").first()).toHaveAttribute(
    "href",
    /^\/wiki\//u,
  );
  const image = page.locator(".wikitext-file__image").first();
  await expect(image).toHaveAttribute("src", /\/sample-image\.svg$/u);
  await expect(image).toHaveAttribute("loading", "lazy");

  await linkToggle.uncheck();
  await expect(page.locator(".wikitext-link--resolved")).toHaveCount(0);
  await linkToggle.check();
  await expect(page.locator(".wikitext-link--resolved").first()).toHaveAttribute(
    "href",
    /^\/wiki\//u,
  );
});

test("applies global render settings from the top bar", async ({ page }) => {
  await open(page, { source: "basic" });
  await page.getByLabel("占位文案").selectOption("en");
  await expect(page.locator(".wikitext-template").first()).toContainText("Template not expanded");

  await page.getByLabel("dir").selectOption("rtl");
  await expect(page.locator(".wikitext-view")).toHaveAttribute("dir", "rtl");
});

test("adjusts render policy and heading ids from advanced diagnostics", async ({ page }) => {
  await open(page, { source: "basic" });
  await page.getByTestId("pg-tab-diagnostics").click();
  await page.locator("summary", { hasText: "高级选项" }).click();
  await page.getByLabel("外链窗口").selectOption("_self");
  await page.getByLabel("headingIdStrategy").selectOption("instance");
  await page.getByLabel("headingIdPrefix").fill("pg-heading-");

  await page.getByTestId("pg-tab-preview").click();
  await expect(page.locator(".wikitext-ext-link").first()).toHaveAttribute("target", "_self");
  await expect(page.locator(".wikitext-view h2 .mw-headline").first()).toHaveAttribute(
    "id",
    "pg-heading-示例条目",
  );
});

test("shows diagnostics and reparses with another parser config", async ({ page }) => {
  await open(page, { source: "basic" });
  await page.getByTestId("pg-tab-diagnostics").click();
  const diagnostics = page.getByTestId("pg-diagnostics");
  await expect(diagnostics).toContainText("wikiparser-node");
  await expect(diagnostics).toContainText("1.48.2");
  await expect(diagnostics).toContainText("Web Worker");
  await expect(diagnostics).toContainText("mediawiki");
  await expect(diagnostics).toContainText("source");

  await page.getByLabel("配置").selectOption("minimum");
  await expect(app(page)).toHaveAttribute("data-config", "minimum");
  await expect(app(page)).toHaveAttribute("data-parsing", "false");
  await expect(diagnostics).toContainText("minimum");
  expect(Number(await app(page).getAttribute("data-node-count"))).toBeGreaterThan(0);
});

test("reports parse limits and clears the error after switching sources", async ({ page }) => {
  await open(page, { source: "limits", maxSource: "800" });
  await expect(app(page)).toHaveAttribute("data-error-code", "SOURCE_TOO_LONG");
  await expect(page.locator(".wikitext-view")).toHaveCount(0);
  await expect(page.getByTestId("pg-preview")).toContainText("SOURCE_TOO_LONG");
  await page.getByTestId("pg-tab-diagnostics").click();
  await expect(page.getByTestId("pg-diagnostics")).toContainText("800");
  await page.getByTestId("pg-tab-repro").click();
  await expect(page.getByTestId("pg-repro-test")).toContainText(
    "reproduces the recorded parse error",
  );

  await sourceItem(page, "basic").click();
  await expect(app(page)).toHaveAttribute("data-source-id", "basic");
  await expect(app(page)).toHaveAttribute("data-parsing", "false");
  await expect(app(page)).toHaveAttribute("data-error-code", "");
  await page.getByTestId("pg-tab-preview").click();
  await expect(page.locator(".wikitext-view h2").first()).toHaveText("示例条目");
});

test("overrides placeholders with custom components", async ({ page }) => {
  await open(page, { source: "components", components: "demo" });
  await expect(page.locator('[data-pg-component="Template"]')).toBeVisible();
  await expect(page.locator('[data-pg-component="File"]')).toBeVisible();
  await expect(page.locator('[data-pg-component="Extension"]')).toBeVisible();
  await expect(page.locator('[data-pg-component="Unknown"]')).toBeVisible();

  await page.getByLabel("自定义组件").selectOption("none");
  await expect(page.locator("[data-pg-component]")).toHaveCount(0);
  await expect(page.locator(".wikitext-template")).toHaveCount(1);
  await expect(page.locator(".wikitext-unknown--block")).toHaveCount(1);
  await expect(page.locator(".wikitext-unknown--inline")).toHaveCount(1);
});

test("isolates a throwing custom component in the render error boundary", async ({ page }) => {
  await open(page, { source: "render-error" });
  await expect(page.getByLabel("自定义组件")).toHaveValue("throwing");
  const boundary = page.locator(".wikitext-render-error");
  await expect(boundary).toContainText("渲染失败");
  await expect(boundary).toContainText("{{Boom");
  await expect(page.locator(".wikitext-view")).toContainText("后续段落仍然渲染");
});

test("resets scene options when switching to a scene without them", async ({ page }) => {
  await open(page, { source: "render-error" });
  await expect(page.locator(".wikitext-render-error")).toHaveCount(1);

  await sourceItem(page, "basic").click();
  await expect(app(page)).toHaveAttribute("data-source-id", "basic");
  await expect(page.locator(".wikitext-render-error")).toHaveCount(0);
  await expect(page.locator(".wikitext-template")).toContainText("模板未展开");
});

test("exposes headings and selected node helpers in the API panel", async ({ page }) => {
  await open(page, { source: "basic", panel: "api" });
  const api = page.getByTestId("pg-api");
  await expect(api).toContainText("prepared.headings");
  await expect(api).toContainText("示例条目");

  await page.locator(".wikitext-tree__label").filter({ hasText: "template" }).first().click();
  await expect(app(page)).toHaveAttribute("data-selected-type", "template");
  await expect(page.getByTestId("pg-api-json")).toContainText("getTemplateParameters");
  await expect(page.getByTestId("pg-api-json")).toContainText("Infobox");
  await expect(page.getByTestId("pg-api-json")).toContainText("示例");

  await page.locator(".wikitext-tree__label").filter({ hasText: "file" }).first().click();
  await expect(page.getByTestId("pg-api-json")).toContainText("getFileParameters");
  await expect(page.getByTestId("pg-api-json")).toContainText("Example.png");
});

test("exports a repro and a Vitest snippet", async ({ page }) => {
  await open(page, { source: "basic" });
  await page.getByTestId("pg-tab-repro").click();
  const repro = page.getByTestId("pg-repro");
  await expect(repro).toContainText("createWikiparser");
  await expect(repro).toContainText("示例条目");
  await expect(repro).toContainText("wikiparser-node 1.48.2");
  await expect(repro).toContainText('describe("wikitext repro"');
});

test("normalizes CRLF sources and keeps ranges aligned", async ({ page }) => {
  await open(page, { source: "crlf" });
  await expect(app(page)).toHaveAttribute("data-normalized", "true");
  await expect(page.locator(".wikitext-view h2").first()).toHaveText("CRLF 归一化");
  await page.locator(".wikitext-tree__label").filter({ hasText: "heading" }).first().click();
  const range = await app(page).getAttribute("data-selected-range");
  expect(range).toMatch(/^\d+,\d+$/u);
  await expect(page.getByTestId("pg-editor")).toHaveAttribute("data-selection", range!);
});

test("restores URL state and keeps drafts across reloads", async ({ page }) => {
  await open(page, {
    source: "resolvers",
    panel: "api",
    config: "minimum",
    labels: "en",
    heading: "instance",
    prefix: "pg-",
    depth: "1",
    link: "1",
  });
  await expect(app(page)).toHaveAttribute("data-source-id", "resolvers");
  await expect(app(page)).toHaveAttribute("data-panel", "api");
  await expect(app(page)).toHaveAttribute("data-config", "minimum");
  await expect(page.getByLabel("占位文案")).toHaveValue("en");
  await expect(page.getByLabel("链接 resolver")).toBeChecked();
  await expect(page.getByLabel("默认展开深度")).toHaveValue("1");

  await page.getByTestId("pg-editor").locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n\nDRAFT-MARKER");
  await expect(app(page)).toHaveAttribute("data-dirty", "true");
  await expect(page.getByTestId("pg-editor")).toContainText("DRAFT-MARKER");

  await page.reload();
  await expect(app(page)).toHaveAttribute("data-parsing", "false");
  await expect(app(page)).toHaveAttribute("data-panel", "api");
  await expect(app(page)).toHaveAttribute("data-dirty", "true");
  await expect(page.getByTestId("pg-editor")).toContainText("DRAFT-MARKER");
  await expect(page.getByLabel("占位文案")).toHaveValue("en");

  await page.getByTestId("pg-tab-diagnostics").click();
  await page.locator("summary", { hasText: "高级选项" }).click();
  await expect(page.getByLabel("headingIdPrefix")).toHaveValue("pg-");

  await page.getByTestId("pg-reset-source").click();
  await expect(app(page)).toHaveAttribute("data-dirty", "false");
  await expect(page.getByTestId("pg-editor")).not.toContainText("DRAFT-MARKER");
});

test("filters scenes", async ({ page }) => {
  await open(page, { source: "basic" });
  const search = page.getByTestId("pg-source-search");
  await search.fill("crlf");
  await expect(sourceItem(page, "crlf")).toBeVisible();
  await expect(sourceItem(page, "security")).toHaveCount(0);
  await search.fill("no-such-source");
  await expect(page.getByTestId("pg-source-list")).toContainText("没有匹配的场景");
});

test("follows the system color scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await open(page, { source: "basic" });
  await expect(app(page)).toHaveAttribute("data-wikitext-theme", "dark");
  const background = await app(page).evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(background).toBe("rgb(13, 17, 23)");

  await page.emulateMedia({ colorScheme: "light" });
  await expect(app(page)).toHaveAttribute("data-wikitext-theme", "light");
});
