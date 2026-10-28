import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RecordingFile } from "../session/types";

export async function recordScreenshots(
  dir: string,
  capture: (path: string) => Promise<unknown>,
  options: { intervalMs?: number; audioStartedAtMs?: number; onFault?: (error: Error) => void } = {},
) {
  const files: RecordingFile[] = [];
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> = Promise.resolve();
  async function take() {
    const startedAtMs = Date.now();
    const id = `screenshot-${String(files.length).padStart(6, "0")}`;
    const name = `${id}-${startedAtMs}.jpg`;
    try {
      await capture(join(dir, name));
    } catch (error) {
      // Font loading can stall while Zoom itself and audio remain healthy.
      // Skip only this capture; the normal interval will retry without overlap.
      if (error instanceof Error && error.name === "TimeoutError" &&
          error.message.includes("page.screenshot:") &&
          error.message.includes("waiting for fonts to load")) {
        console.warn("Screenshot skipped: font loading timed out; retrying at the next interval");
        return;
      }
      throw error;
    }
    const endedAtMs = Date.now();
    const audioOffsetMs = options.audioStartedAtMs === undefined ? undefined : startedAtMs - options.audioStartedAtMs;
    writeFileSync(join(dir, name + ".json"), JSON.stringify({
      screenshot: name,
      capturedAt: new Date(startedAtMs).toISOString(),
      capturedAtMs: startedAtMs,
      captureCompletedAtMs: endedAtMs,
      audioStartedAtMs: options.audioStartedAtMs,
      audioOffsetMs,
    }, null, 2), { flag: "wx", mode: 0o600 });
    files.push({ id, name, kind: "screenshot", status: "ready", startedAtMs,
      endedAtMs, audioOffsetMs, bytes: statSync(join(dir, name)).size });
  }
  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => {
      pending = take().then(schedule).catch((error: Error) => {
        stopped = true;
        options.onFault?.(error);
      });
    }, options.intervalMs ?? 15000);
  }
  await take();
  schedule();
  return {
    async stop(): Promise<RecordingFile[]> {
      stopped = true;
      clearTimeout(timer);
      await pending;
      return [...files];
    },
  };
}
