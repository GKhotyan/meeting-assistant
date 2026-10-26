import type { Page, BrowserContext } from "playwright";
export function watchBrowser(
  page: Page,
  context: BrowserContext,
  onFailure: () => void,
) {
  let fired = false;
  const fail = () => {
    if (fired) return;
    fired = true;
    onFailure();
  };
  page.on("crash", fail);
  page.on("close", fail);
  context.on("close", fail);
  return () => {
    page.off("crash", fail);
    page.off("close", fail);
    context.off("close", fail);
  };
}
