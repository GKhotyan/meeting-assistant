import type { Page } from "playwright";
import { performance } from "node:perf_hooks";

export async function readZoomParticipantCount(page: Page): Promise<number | undefined> {
  // Count the whole meeting, including the recorder, rather than visible video tiles.
  const counts = await page.locator(
    '#participant .footer-button__number, button[aria-label*="Participants"] .footer-button__number, button[aria-label*="participants"] .footer-button__number',
  ).allTextContents();
  const values = counts.map(text => text.trim()).filter(text => /^\d+$/.test(text));
  if (!values.length) return undefined;
  const unique = new Set(values.map(Number));
  const count = Number(values[0]);
  return unique.size === 1 && Number.isSafeInteger(count) && count >= 1 ? count : undefined;
}

export function watchEmptyMeeting(
  readCount: () => Promise<number | undefined>,
  onEmpty: () => void,
  options: { now?: () => number; pollMs?: number } = {},
) {
  const now = options.now ?? (() => performance.now());
  let aloneSince: number | undefined;
  let stopped = false, checking = false;
  async function check() {
    if (stopped || checking) return;
    checking = true;
    try {
      const count = await readCount();
      if (stopped) return;
      if (count !== 1) {
        aloneSince = undefined;
        return;
      }
      const time = now();
      aloneSince ??= time;
      if (time - aloneSince >= 120_000) {
        stop();
        onEmpty();
      }
    } catch {
      aloneSince = undefined;
    } finally {
      checking = false;
    }
  }
  const timer = setInterval(() => void check(), options.pollMs ?? 5000);
  function stop() {
    stopped = true;
    clearInterval(timer);
  }
  return { check, stop };
}
