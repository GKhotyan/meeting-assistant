// Run in the application's Playwright image with the repository mounted at /work.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { chromium } = require("/app/node_modules/playwright");

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const sessions = Array.from({ length: 12 }, (_, i) => ({
      id: `meeting-${i}`, meetingName: `Meeting ${i}`, botName: "Assistant",
      createdAt: "2026-10-27T12:00:00Z", status: "completed",
      files: [{ id: "audio", kind: "audio", bytes: 1048576 },
        ...Array.from({ length: 30 }, (_, n) => ({ id: `shot-${n}`, kind: "screenshot", bytes: 1024, startedAtMs: 1793103679684 + n * 5000 }))],
    }));
    await page.route("http://scroll.test/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith("/api/")) return route.fulfill({ json: path === "/api/sessions" ? { sessions } : path === "/api/schedules" ? { schedules: [] } : {} });
      const file = path === "/" ? "index.html" : path.slice(1);
      return route.fulfill({ body: readFileSync("/work/public/" + file), contentType: file.endsWith("js") ? "text/javascript" : file.endsWith("css") ? "text/css" : "text/html" });
    });
    await page.goto("http://scroll.test/");
    await page.locator("#sessions article").first().waitFor();
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight - 1000));
      for (let i = 0; i < 28; i++) {
        const before = await page.evaluate(() => { scrollBy(0, 3); return scrollY; });
        await page.waitForTimeout(100);
        assert.ok(Math.abs(await page.evaluate(() => scrollY) - before) <= 1, "polling moved the page during slow scrolling");
      }
      // Force a changed response too: a new screenshot should not jump the page.
      const before = await page.evaluate(() => scrollY);
      sessions[0].files.push({ id: `new-${width}`, kind: "screenshot", bytes: 1024, startedAtMs: Date.now() });
      await page.evaluate(() => refresh());
      assert.ok(Math.abs(await page.evaluate(() => scrollY) - before) <= 1, "changed meeting data moved the page");
      await page.locator("#sessions article").last().locator("summary").click();
      await page.locator("#sessions article").last().locator(".screenshot-list").evaluate(el => { el.scrollTop = 160; });
      await page.evaluate(() => refresh());
      assert.equal(await page.locator("#sessions article").last().locator(".screenshot-list").evaluate(el => el.scrollTop), 160);
    }
    console.log("SCROLL_PASS: slow scrolling across polls, changed data, nested scroll, desktop and mobile");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
