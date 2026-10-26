const assert = require("node:assert/strict");
const { launchZoomBrowser } = require("/app/dist/src/worker/browser");
const { maximizeZoomWindow } = require("/app/dist/src/worker/window");
(async () => {
  const browser = await launchZoomBrowser();
  try {
    await maximizeZoomWindow(browser.page);
    const dimensions = await browser.page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    assert.ok(dimensions.width >= 1900, JSON.stringify(dimensions));
    assert.ok(dimensions.height >= 900, JSON.stringify(dimensions));
    console.log("FULLSCREEN_PASS", JSON.stringify(dimensions));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
