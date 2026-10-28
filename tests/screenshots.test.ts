import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordScreenshots } from "../src/recordings/screenshots";

for (const failFirst of [true, false]) {
  test(`font timeout is skipped and screenshots resume (${failFirst ? "startup" : "later"})`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "ea-shots-"));
    let calls = 0;
    const faults: Error[] = [];
    let recovered!: () => void;
    const recovery = new Promise<void>(resolve => { recovered = resolve; });
    const recorder = await recordScreenshots(dir, async path => {
      calls++;
      if (calls >= (failFirst ? 1 : 2) && calls <= 3) {
        const error = new Error("page.screenshot: Timeout 10000ms exceeded.\nCall log:\n  - taking page screenshot\n  - waiting for fonts to load...");
        error.name = "TimeoutError";
        throw error;
      }
      writeFileSync(path, "jpeg");
      if (calls === 4) recovered();
    }, { intervalMs: 5, onFault: error => { faults.push(error); } });
    try {
      await Promise.race([recovery, new Promise((_, reject) => setTimeout(() => reject(Error("screenshots did not resume")), 500))]);
    } finally {
      const files = await recorder.stop();
      assert.deepEqual(faults, []);
      assert.equal(files.length, failFirst ? 1 : 2);
      assert.ok(files.every(file => existsSync(join(dir, file.name + ".json"))));
    }
  });
}

test("other screenshot timeouts remain fatal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ea-shots-"));
  const error = new Error("page.screenshot: Timeout 10000ms exceeded. waiting for frame");
  error.name = "TimeoutError";
  await assert.rejects(recordScreenshots(dir, async () => { throw error; }), /waiting for frame/);
});

test("screenshots capture immediately, repeat, and stop without video", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ea-shots-"));
  let captures = 0;
  const recorder = await recordScreenshots(dir, async (path) => {
    captures++;
    writeFileSync(path, Buffer.from([255,216,255,217]));
  }, { intervalMs: 20 });
  await new Promise(r => setTimeout(r, 65));
  const files = await recorder.stop();
  const count = captures;
  await new Promise(r => setTimeout(r, 40));
  assert.equal(captures, count);
  assert.ok(files.length >= 2);
  assert.equal(files.length, captures);
  assert.ok(files.every(f => f.kind === "screenshot" && f.status === "ready" && existsSync(join(dir, f.name))));
  assert.equal(existsSync(join(dir, "screen.mp4")), false);
  assert.deepEqual(await recorder.stop(), files);
});
test("screenshot startup errors propagate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ea-shots-"));
  await assert.rejects(() => recordScreenshots(dir, async () => { throw Error("capture failed"); }), /capture failed/);
});

test("stop waits for in-flight screenshot and captures never overlap", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ea-shots-"));
  let calls = 0;
  let release: (() => void) | undefined;
  const recorder = await recordScreenshots(dir, async path => {
    if (++calls === 2) await new Promise<void>(resolve => { release = resolve; });
    writeFileSync(path, "jpeg");
  }, { intervalMs: 10 });
  while (!release) await new Promise(r => setTimeout(r, 5));
  let stopped = false;
  const result = recorder.stop().then(files => { stopped = true; return files; });
  await new Promise(r => setTimeout(r, 25));
  assert.equal(stopped, false);
  assert.equal(calls, 2);
  release();
  assert.equal((await result).length, 2);
});
test("later capture failure reports fault and keeps completed images", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ea-shots-"));
  let calls = 0;
  let fault: Error | undefined;
  const recorder = await recordScreenshots(dir, async path => {
    if (++calls > 1) throw Error("page closed");
    writeFileSync(path, "jpeg");
  }, { intervalMs: 10, onFault: e => { fault = e; } });
  await new Promise(r => setTimeout(r, 35));
  assert.equal(fault?.message, "page closed");
  assert.equal((await recorder.stop()).length, 1);
});

test("every screenshot immediately persists UTC timestamp and audio position", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ea-shots-"));
  const audioStartedAtMs = Date.now() - 12000;
  const recorder = await recordScreenshots(dir, async path => { writeFileSync(path, "jpeg"); }, { audioStartedAtMs });
  const [file] = await recorder.stop();
  const metadata = JSON.parse(readFileSync(join(dir, file.name + ".json"), "utf8"));
  assert.equal(metadata.screenshot, file.name);
  assert.equal(metadata.capturedAtMs, file.startedAtMs);
  assert.equal(metadata.capturedAt, new Date(file.startedAtMs).toISOString());
  assert.equal(metadata.audioOffsetMs, file.startedAtMs - audioStartedAtMs);
  assert.equal(file.audioOffsetMs, metadata.audioOffsetMs);
  assert.equal(metadata.captureCompletedAtMs, file.endedAtMs);
});
