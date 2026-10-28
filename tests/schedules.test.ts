import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Scheduler, nextOccurrence } from "../src/session/schedules";
import { AppError } from "../src/session/types";

const rule = { name: "Daily", meetingUrl: "https://zoom.us/j/12345678901?pwd=private",
  weekdays: [1, 2, 4, 5], time: "10:00", timeZone: "Europe/Moscow", recordingMode: "audio" as const };
function setup(launch?: (input: any) => Promise<{ id: string }>) {
  const root = mkdtempSync(join(tmpdir(), "ea-schedule-"));
  let clock = new Date("2026-10-26T06:59:00Z");
  const calls: any[] = [];
  const controller = {
    settings: () => ({ botName: "Notes", recordingMode: "video" as const }),
    startSession: async (input: any) => { calls.push(input); return launch ? launch(input) : { id: "session-1" }; },
  };
  const scheduler = new Scheduler(root, controller, () => clock);
  return { root, scheduler, controller, calls, setTime: (time: string) => { clock = new Date(time); }, now: () => clock };
}

test("next occurrence respects selected weekdays, wall time and zone, independently of server zone", () => {
  assert.equal(nextOccurrence(rule, new Date("2026-10-26T06:59:00Z")), "2026-10-26T07:00:00.000Z");
  assert.equal(nextOccurrence(rule, new Date("2026-10-27T07:00:00Z")), "2026-10-29T07:00:00.000Z");
  assert.equal(nextOccurrence({ ...rule, weekdays: [7], time: "00:05", timeZone: "Asia/Tokyo" }, new Date("2026-10-24T14:00:00Z")), "2026-10-24T15:05:00.000Z");
});

test("DST gaps are skipped and ambiguous local times occur only once per local date", () => {
  const dst = { ...rule, weekdays: [7], time: "02:30", timeZone: "America/New_York" };
  assert.equal(nextOccurrence(dst, new Date("2026-03-08T00:00:00Z")), "2026-03-15T06:30:00.000Z");
  const ambiguous = { ...dst, time: "01:30" };
  assert.equal(nextOccurrence(ambiguous, new Date("2026-11-01T00:00:00Z")), "2026-11-01T05:30:00.000Z");
  assert.equal(nextOccurrence(ambiguous, new Date("2026-11-01T05:31:00Z")), "2026-11-08T06:30:00.000Z");
});

test("rules validate inputs, persist edits, pause and delete without exposing mutable state", () => {
  const a = setup();
  for (const patch of [{ weekdays: [] }, { weekdays: [0] }, { weekdays: [8] }, { weekdays: [1.5] },
    { time: "24:00" }, { time: "9:00" }, { timeZone: "Unknown/Zone" }, { meetingUrl: "https://evil.test" },
    { name: " " }, { recordingMode: "bad" }, { enabled: "yes" }]) {
    assert.throws(() => a.scheduler.create({ ...rule, ...patch } as any), (e: any) => e.status === 400);
  }
  const created = a.scheduler.create(rule);
  assert.equal(created.nextRunAt, "2026-10-26T07:00:00.000Z");
  created.weekdays.push(3);
  assert.deepEqual(a.scheduler.list()[0].weekdays, [1, 2, 4, 5]);
  a.scheduler.update(created.id, { enabled: false });
  const restored = new Scheduler(a.root, a.controller, a.now);
  assert.equal(restored.list()[0].enabled, false);
  assert.equal(restored.list()[0].nextRunAt, undefined);
  a.setTime("2026-10-26T08:00:00Z");
  const resumed = restored.update(created.id, { enabled: true, name: "New daily" });
  assert.equal(resumed.nextRunAt, "2026-10-27T07:00:00.000Z");
  restored.delete(created.id);
  assert.equal(new Scheduler(a.root, a.controller, a.now).list().length, 0);
  assert.throws(() => restored.update(created.id, {}), (e: any) => e.status === 404);
});

test("due rules launch once, preserving URL/mode and recording the session ID across restarts", async () => {
  const a = setup();
  a.scheduler.create(rule);
  a.setTime("2026-10-26T07:00:10Z");
  await a.scheduler.tick();
  await a.scheduler.tick();
  const restored = new Scheduler(a.root, a.controller, a.now);
  await restored.tick();
  assert.equal(a.calls.length, 1);
  assert.equal(a.calls[0].meetingUrl, rule.meetingUrl);
  assert.equal(a.calls[0].recordingMode, "audio");
  assert.equal(a.calls[0].botName, "Engineering Assistant");
  assert.equal(a.calls[0].meetingName, "Daily");
  assert.equal(restored.list()[0].lastRun?.status, "started");
  assert.equal(restored.list()[0].lastRun?.sessionId, "session-1");
  assert.equal(restored.list()[0].nextRunAt, "2026-10-27T07:00:00.000Z");
});

test("busy meetings are skipped without retry and overdue launches are marked missed", async () => {
  const a = setup(async () => { throw new AppError(409, "busy"); });
  a.scheduler.create(rule);
  a.setTime("2026-10-26T07:00:20Z");
  await a.scheduler.tick();
  assert.equal(a.scheduler.list()[0].lastRun?.status, "skipped");
  assert.match(a.scheduler.list()[0].lastRun!.reason!, /another meeting/i);
  await a.scheduler.tick();
  assert.equal(a.calls.length, 1);
  a.setTime("2026-10-27T07:01:00Z");
  await a.scheduler.tick();
  assert.equal(a.calls.length, 1);
  assert.match(a.scheduler.list()[0].lastRun!.reason!, /missed/i);
});

test("concurrent ticks and restart during an in-flight launch cannot start the same occurrence twice", async () => {
  let release!: () => void;
  const a = setup(async () => { await new Promise<void>(r => { release = r; }); return { id: "pending" }; });
  a.scheduler.create(rule);
  a.setTime("2026-10-26T07:00:10Z");
  const pending = a.scheduler.tick();
  const concurrent = a.scheduler.tick();
  await new Scheduler(a.root, a.controller, a.now).tick();
  assert.equal(a.calls.length, 1);
  release();
  await Promise.all([pending, concurrent]);
});

test("paused rules never launch and failed starts do not leak private links in status", async () => {
  const a = setup(async () => { throw Error(rule.meetingUrl); });
  const paused = a.scheduler.create({ ...rule, enabled: false });
  a.scheduler.create(rule);
  a.setTime("2026-10-26T07:00:10Z");
  await a.scheduler.tick();
  assert.equal(a.calls.length, 1);
  const rows = a.scheduler.list();
  assert.equal(rows.find(r => r.id === paused.id)?.lastRun, undefined);
  assert.equal(rows.find(r => r.id !== paused.id)?.lastRun?.status, "failed");
  assert.equal(JSON.stringify(rows.map(r => r.lastRun)).includes("private"), false);
});

test("a failed occurrence claim does not launch or advance the rule and the next tick can retry", async () => {
  const a = setup();
  a.scheduler.create(rule);
  a.setTime("2026-10-26T07:00:10Z");
  const blocked = join(a.root, "schedules.json.tmp");
  mkdirSync(blocked);
  await assert.rejects(a.scheduler.tick());
  assert.equal(a.calls.length, 0);
  assert.equal(a.scheduler.list()[0].nextRunAt, "2026-10-26T07:00:00.000Z");
  assert.equal(a.scheduler.list()[0].lastRun, undefined);
  rmdirSync(blocked);
  await a.scheduler.tick();
  assert.equal(a.calls.length, 1);
  assert.equal(a.scheduler.list()[0].lastRun?.status, "started");
});


test("schedule bot names are validated, trimmed, persisted and used at launch", async () => {
  const a = setup();
  for (const botName of ["", "   ", "x".repeat(101), null, 123]) {
    assert.throws(() => a.scheduler.create({ ...rule, botName } as any), (e: any) => e.status === 400);
  }
  const created = a.scheduler.create({ ...rule, botName: "  Daily assistant  " });
  assert.equal(created.botName, "Daily assistant");
  a.scheduler.update(created.id, { botName: "Team assistant" });
  const restored = new Scheduler(a.root, a.controller, a.now);
  assert.equal(restored.list()[0].botName, "Team assistant");
  a.setTime("2026-10-26T07:00:10Z");
  await restored.tick();
  assert.equal(a.calls[0].botName, "Team assistant");
});

test("old schedules without a bot name load with Engineering Assistant", async () => {
  const a = setup();
  const created = a.scheduler.create(rule);
  assert.equal(created.botName, "Engineering Assistant");
  const file = join(a.root, "schedules.json");
  const rows = JSON.parse(readFileSync(file, "utf8"));
  delete rows[0].botName;
  writeFileSync(file, JSON.stringify(rows));
  const restored = new Scheduler(a.root, a.controller, a.now);
  assert.equal(restored.list()[0].botName, "Engineering Assistant");
  a.setTime("2026-10-26T07:00:10Z");
  await restored.tick();
  assert.equal(a.calls[0].botName, "Engineering Assistant");
});
