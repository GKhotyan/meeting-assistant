import type { Page } from "playwright";
import { dismissZoomMicrophoneWarning } from "../../vendor/vexa/join/zoom/leave";

// Playwright 1.56 checks this in screenshotter.js. Capture the currently visible
// meeting without waiting for web fonts; recheck this internal flag on upgrades.
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = "1";

type Rect = { x: number; y: number; width: number; height: number };

export function clipToViewport(rect: Rect, viewport: { width: number; height: number }): Rect | undefined {
  const x = Math.ceil(Math.max(0, rect.x));
  const y = Math.ceil(Math.max(0, rect.y));
  const right = Math.floor(Math.min(viewport.width, rect.x + rect.width));
  const bottom = Math.floor(Math.min(viewport.height, rect.y + rect.height));
  if (![x, y, right, bottom].every(Number.isFinite) || right <= x || bottom <= y) return;
  return { x, y, width: right - x, height: bottom - y };
}

export async function captureMeetingScreenshot(page: Page, path: string) {
  await dismissZoomMicrophoneWarning(page);
  // Query before every capture: Zoom moves/resizes this element as the layout changes.
  const bounds = await page.evaluate(() => {
    const elements = document.querySelectorAll("#sharee-container .sharee-container__viewport");
    for (const element of elements) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.visibility === "hidden" || style.display === "none" || rect.width <= 0 || rect.height <= 0) continue;
      return {
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        viewport: { width: innerWidth, height: innerHeight },
      };
    }
    return null;
  });
  const clip = bounds ? clipToViewport(bounds.rect, bounds.viewport) : undefined;
  return page.screenshot({ path, type: "jpeg", quality: 75, timeout: 10000, ...(clip ? { clip } : {}) });
}
