// HTML → PDF via Playwright/Chromium.
//
// Single shared browser instance — launched lazily on the first
// /api/pdf request, reused for the lifetime of the process. Costs
// ~150-200 MB resident; reusing it avoids the 1-2s cold-start per
// PDF that fresh launches add.

import { chromium } from "playwright";

let _browser = null;
let _launching = null;

async function getBrowser() {
  if (_browser) return _browser;
  if (_launching) return _launching;
  _launching = chromium.launch({
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
    headless: true,
  }).then((b) => {
    _browser = b;
    _launching = null;
    // Clean up on process exit so systemd restarts don't leak.
    process.on("exit", () => b.close().catch(() => {}));
    return b;
  }).catch((e) => {
    _launching = null;
    throw e;
  });
  return _launching;
}

export async function htmlToPdf(html) {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    // Inline @page CSS handles size; we just print to PDF buffer.
    const buf = await page.pdf({
      format: "Letter",
      printBackground: true,
      preferCSSPageSize: true,
    });
    return buf;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}
