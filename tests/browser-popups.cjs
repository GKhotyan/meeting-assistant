// Run with the project mounted at /work in the Playwright Docker image.
const assert = require("node:assert/strict");
const { chromium } = require("/app/node_modules/playwright");
const { dismissZoomPopups } = require("../dist/vendor/vexa/join/zoom/leave");
const { captureMeetingScreenshot } = require("../dist/src/worker/share-capture");

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div role="alert" id="other">Other notification<button aria-label="Close">×</button></div>
      <div class="notification" id="microphone">
        Cannot detect your microphone, please check the device and connection and try again.
        <a href="#help" onclick="window.helpClicked = true">Learn more</a>
        <button aria-label="Close" onclick="this.parentElement.remove()">×</button>
      </div>`);
    const fixture = await page.locator("#microphone").evaluate(el => el.outerHTML);
    await dismissZoomPopups(page);
    assert.equal(await page.locator("#microphone").count(), 0, "startup must dismiss microphone warning");
    // A warning that returns between timer ticks must be gone before the next capture.
    await page.locator("body").evaluate((el, html) => el.insertAdjacentHTML("beforeend", html), fixture);
    const screenshot = page.screenshot.bind(page);
    page.screenshot = async options => {
      assert.equal(await page.locator("#microphone").count(), 0, "warning must disappear before capture");
      return screenshot(options);
    };
    await captureMeetingScreenshot(page, "/tmp/microphone-popup-test.jpg");
    await dismissZoomPopups(page);
    assert.equal(await page.locator("#other").count(), 1, "unrelated notifications must remain");
    assert.equal(await page.evaluate(() => Boolean(window.helpClicked)), false);
    await page.route("https://fonts.test/stalled.woff2", () => {});
    await page.setContent(`<style>
      @font-face { font-family: Stalled; src: url(https://fonts.test/stalled.woff2); }
      body { font-family: Stalled, sans-serif; }
      </style><p>The meeting remains visible while a font is loading.</p>`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.fonts.status === "loading");
    let deadline;
    try {
      const image = await Promise.race([
        captureMeetingScreenshot(page, "/tmp/stalled-font-test.jpg"),
        new Promise((_, reject) => { deadline = setTimeout(() => reject(Error("Capture waited for stalled fonts")), 2000); }),
      ]);
      assert.ok(image.length > 0);
      assert.equal(await page.evaluate(() => document.fonts.status), "loading");
    } finally { clearTimeout(deadline); }
    console.log("POPUP_CAPTURE_PASS");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
