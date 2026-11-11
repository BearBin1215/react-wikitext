import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

function fixture(): string {
  const tokens = readFileSync(resolve("dist/tokens.css"), "utf8");
  const styles = readFileSync(resolve("dist/styles.css"), "utf8").replace(
    '@import "./tokens.css";',
    tokens,
  );
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><style>${styles}</style></head>
  <body>
    <div class="wikitext-view">
      <span id="accent" style="color: var(--wikitext-accent)"></span>
      <details class="wikitext-magic-word wikitext-magic-word--block" id="magic">
        <summary class="wikitext-template__summary">Parser function not evaluated: if</summary>
      </details>
      <div class="wikitext-redirect">
        <ul class="wikitext-redirect__list">
          <li><a class="wikitext-redirect__target" id="redirect" href="#target">Target</a></li>
        </ul>
      </div>
      <section class="wikitext-table--degraded">
        <pre class="wikitext-unknown__source" id="degraded-source">source</pre>
      </section>
      <figure class="wikitext-file wikitext-file--block wikitext-file--media" typeof="mw:File/Thumb" id="ltr-figure">
        <a class="mw-file-description wikitext-file__link" href="#target"><img class="wikitext-file__image mw-file-element" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="10" height="10" alt="" /></a>
        <figcaption class="wikitext-file__caption">Caption</figcaption>
      </figure>
    </div>
    <div class="wikitext-view" dir="rtl">
      <figure class="wikitext-file wikitext-file--block wikitext-file--media" typeof="mw:File/Thumb" id="rtl-figure">
        <a class="mw-file-description wikitext-file__link" href="#target"><img class="wikitext-file__image mw-file-element" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="10" height="10" alt="" /></a>
        <figcaption class="wikitext-file__caption">Caption</figcaption>
      </figure>
    </div>
  </body>
</html>`;
}

test.describe("@consumer styles", () => {
  test("keeps fixed block, redirect, degraded-source and RTL styles", async ({ page }) => {
    await page.setContent(fixture(), { waitUntil: "load" });

    const magic = page.locator("#magic");
    await expect(magic).toHaveCSS("display", "block");
    await expect(magic).toHaveCSS("border-top-style", "solid");

    const accent = await page
      .locator("#accent")
      .evaluate((element) => getComputedStyle(element).color);
    const redirect = page.locator("#redirect");
    await expect(redirect).toHaveCSS("color", accent);
    await expect(redirect).toHaveCSS("text-decoration-line", "none");
    await redirect.hover();
    await expect(redirect).toHaveCSS("text-decoration-line", "underline");

    const source = page.locator("#degraded-source");
    await expect(source).toHaveCSS("white-space", "pre-wrap");
    await expect(source).toHaveCSS("overflow", "auto");

    await expect(page.locator("#ltr-figure")).toHaveCSS("float", "right");
    await expect(page.locator("#rtl-figure")).toHaveCSS("float", "left");
  });
});
