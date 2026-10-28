import { test } from "node:test";
import assert from "node:assert/strict";
import { readZoomParticipantCount, watchEmptyMeeting } from "../src/worker/empty-meeting";

test("participant count accepts explicit counts and treats absent or ambiguous counts as unknown", async () => {
  for (const [texts, expected] of [
    [[" 1 "], 1], [["2"], 2], [["1", "1"], 1],
    [[], undefined], [[""], undefined], [["0"], undefined],
    [["1", "2"], undefined], [["Participants"], undefined],
  ] as [string[], number | undefined][]) {
    const page = { locator: () => ({ allTextContents: async () => texts }) };
    assert.equal(await readZoomParticipantCount(page as any), expected);
  }
});

test("bot leaves once after two uninterrupted minutes alone, including an initially empty meeting", async () => {
  let now = 0, count: number | undefined = 1, leaves = 0;
  const monitor = watchEmptyMeeting(async () => count, () => { leaves++; }, {
    now: () => now, pollMs: 60_000,
  });
  try {
    await monitor.check();
    now = 119_999;
    await monitor.check();
    assert.equal(leaves, 0);
    now = 120_000;
    await monitor.check();
    await monitor.check();
    assert.equal(leaves, 1);
  } finally { monitor.stop(); }
});

test("returning participants, unavailable counts and read errors reset the alone timer", async () => {
  for (const interruption of [2, undefined, new Error("page unavailable")]) {
    let now = 0, value: number | undefined | Error = 1, leaves = 0;
    const monitor = watchEmptyMeeting(async () => {
      if (value instanceof Error) throw value;
      return value;
    }, () => { leaves++; }, { now: () => now, pollMs: 60_000 });
    try {
      await monitor.check();
      now = 119_000;
      value = interruption;
      await monitor.check();
      now = 120_000;
      value = 1;
      await monitor.check();
      now = 239_999;
      await monitor.check();
      assert.equal(leaves, 0);
      now = 240_000;
      await monitor.check();
      assert.equal(leaves, 1);
    } finally { monitor.stop(); }
  }
});

test("stopping the monitor prevents departure even with a pending participant read", async () => {
  let resolve!: (count: number) => void, leaves = 0;
  const monitor = watchEmptyMeeting(() => new Promise<number>(r => { resolve = r; }),
    () => { leaves++; });
  const pending = monitor.check();
  monitor.stop();
  resolve(1);
  await pending;
  await monitor.check();
  assert.equal(leaves, 0);
});
