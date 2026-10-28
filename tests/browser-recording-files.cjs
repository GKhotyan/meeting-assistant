// Run in the application's Playwright image with the repository mounted at /work.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { chromium } = require("/app/node_modules/playwright");

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
    let polls = 0;
    const files = [
      { id: "audio", kind: "audio", bytes: 1048576 },
      { id: "screen", kind: "screen", bytes: 2097152 },
      ...Array.from({ length: 419 }, (_, i) => ({ id: `shot-${i}`, kind: "screenshot", bytes: 102400, startedAtMs: 1793103679684 + i * 5000 })),
    ];
    await page.route("http://recordings.test/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith("/api/")) {
        const data = path === "/api/sessions" ? { sessions: [{ id: "fixture", meetingName: "Design meeting", botName: "Assistant", createdAt: "2026-10-27T12:21:08Z", status: "completed", files }] }
          : path === "/api/schedules" ? { schedules: [] } : { botName: "Assistant", recordingMode: "screenshots" };
        if (path === "/api/sessions") polls++;
        return route.fulfill({ json: data });
      }
      const file = path === "/" ? "index.html" : path.slice(1);
      await route.fulfill({ body: readFileSync("/work/public/" + file), contentType: file.endsWith("css") ? "text/css" : file.endsWith("js") ? "text/javascript" : "text/html" });
    });
    await page.goto("http://recordings.test/");
    const card = page.locator("#sessions article");
    const details = card.locator("details");
    await details.waitFor();
    assert.match(await details.locator("summary").innerText(), /419/);
    assert.equal(await details.getAttribute("open"), null);
    assert.equal(await card.getByRole("link").count(), 2);
    assert.match(await card.getByRole("link", { name: /Audio/ }).getAttribute("href"), /\/files\/audio$/);
    assert.match(await card.getByRole("link", { name: /video/i }).getAttribute("href"), /\/files\/screen$/);
    await page.screenshot({ path: "/output/files-collapsed.png", fullPage: true });
    await details.locator("summary").click();
    assert.equal(await card.getByRole("link").count(), 421);
    assert.match(await details.getByRole("link").first().getAttribute("href"), /\/files\/shot-0$/);
    const before = polls;
    await page.waitForTimeout(2300);
    assert.ok(polls > before);
    assert.notEqual(await details.getAttribute("open"), null, "polling must keep the list expanded");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "/output/files-mobile.png", fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await details.locator("summary").click();
    await page.waitForTimeout(2300);
    assert.equal(await details.getAttribute("open"), null);
    console.log("RECORDING_FILES_PASS: grouped downloads, collapsed count, expansion, polling, mobile layout");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
