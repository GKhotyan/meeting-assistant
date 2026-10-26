import type { Page } from "playwright";
export async function maximizeZoomWindow(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "normal" },
    });
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { left: 0, top: 0, width: 1920, height: 1080 },
    });
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "fullscreen" },
    });
    await page.waitForFunction(
      () => innerWidth >= 1900 && innerHeight >= 900,
      {},
      { timeout: 5000 },
    );
  } finally {
    await cdp.detach();
  }
}
