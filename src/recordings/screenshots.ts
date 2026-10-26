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
    await capture(join(dir, name));
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
    }, options.intervalMs ?? 5000);
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
