import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { Controller } from "../src/session/controller";
const input = {
  meetingUrl: "https://zoom.us/j/12345678901?pwd=secret",
  botName: "Engineering Assistant",
};
function setup() {
  const root = mkdtempSync(join(tmpdir(), "ea-test-"));
  const workers: any[] = [];
  const c = new Controller(root, () => {
    const w = new EventEmitter() as any;
    w.send = (m: any) => {
      if (m.type === "stop") setImmediate(() => w.emit("exit", 0, null));
    };
    w.kill = () => w.emit("exit", null, "SIGKILL");
    workers.push(w);
    return w;
  });
  return { c, root, workers };
}
test("controller admits one concurrent session and rejects a second", async () => {
  const { c } = setup();
  const results = await Promise.allSettled([
    c.startSession(input),
    c.startSession(input),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    (results.find((x) => x.status === "rejected") as PromiseRejectedResult)
      .reason.status,
    409,
  );
  await c.stopSession(c.list()[0].id);
});
test("controller stop is idempotent and waits for worker exit", async () => {
  const { c } = setup();
  const s = await c.startSession(input);
  await Promise.all([c.stopSession(s.id), c.stopSession(s.id)]);
  assert.equal(c.getSession(s.id)?.status, "interrupted");
});
test("controller persists settings and marks running state interrupted after restart", async () => {
  const { c, root } = setup();
  c.setSettings({ botName: "Notes" });
  await c.startSession(input);
  const restored = new Controller(root, () => {
    throw Error("must not respawn");
  });
  assert.equal(restored.list()[0].status, "interrupted");
  assert.equal(restored.settings().botName, "Notes");
  await c.stopSession(c.list()[0].id);
});
test("controller reports failed worker errors", async () => {
  const { c, workers } = setup();
  const s = await c.startSession(input);
  workers[0].emit("message", { type: "status", status: "recording" });
  assert.equal(c.getSession(s.id)?.status, "recording");
  workers[0].emit("message", {
    type: "done",
    files: [],
    error: "Audio unavailable",
  });
  workers[0].emit("exit", 1, null);
  assert.equal(c.getSession(s.id)?.status, "failed");
  assert.equal(c.getSession(s.id)?.error, "Audio unavailable");
});
test("controller rejects unsupported links and empty names", async () => {
  const { c } = setup();
  for (const meetingUrl of [
    "http://zoom.us/j/12345678901",
    "https://zoom.us.evil.test/j/12345678901",
    "https://localhost/j/12345678901",
    "https://zoom.us/",
  ])
    await assert.rejects(() => c.startSession({ ...input, meetingUrl }));
  await assert.rejects(() => c.startSession({ ...input, botName: " " }));
});

test("recording mode defaults to video, persists, and reaches the worker", async () => {
  const { c, root, workers } = setup();
  assert.equal(c.settings().recordingMode, "video");
  c.setSettings({ botName: "Notes", recordingMode: "screenshots" });
  const restored = new Controller(root, () => { throw Error("unused"); });
  assert.equal(restored.settings().recordingMode, "screenshots");
  let sent: any;
  const originalSpawn = (c as any).spawnWorker;
  (c as any).spawnWorker = (dir: string) => {
    const worker = originalSpawn(dir);
    const send = worker.send;
    worker.send = (m: any) => { if (m.type === "start") sent = m; return send(m); };
    return worker;
  };
  const session = await c.startSession(input);
  assert.equal(session.recordingMode, "screenshots");
  assert.equal(sent.input.recordingMode, "screenshots");
  c.setSettings({ botName: "Notes", recordingMode: "video" });
  assert.equal(c.getSession(session.id)?.recordingMode, "screenshots");
  await c.stopSession(session.id);
});
test("invalid recording modes are rejected", async () => {
  const { c } = setup();
  assert.throws(() => c.setSettings({ botName: "Notes", recordingMode: "bad" } as any));
  await assert.rejects(() => c.startSession({ ...input, recordingMode: "bad" } as any));
});
