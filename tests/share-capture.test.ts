import { test } from "node:test";
import assert from "node:assert/strict";
import { captureMeetingScreenshot, clipToViewport } from "../src/worker/share-capture";

test("share rectangle is clipped to visible viewport with integer boundaries", () => {
  assert.deepEqual(clipToViewport({ x: -10, y: 20.2, width: 300, height: 500 }, { width: 200, height: 150 }), { x: 0, y: 21, width: 200, height: 129 });
  assert.equal(clipToViewport({ x: 220, y: 0, width: 100, height: 20 }, { width: 200, height: 150 }), undefined);
});
test("each screenshot queries current share bounds and falls back when absent", async () => {
  const clips = [{ x: 20, y: 0, width: 1800, height: 1000 }, { x: 100, y: 30, width: 1600, height: 900 }, undefined];
  const calls: any[] = [];
  const page = {
    evaluate: async () => { const rect = clips.shift(); return rect ? { rect, viewport: { width: 1920, height: 1080 } } : null; },
    screenshot: async (options: any) => { calls.push(options); return Buffer.alloc(0); },
  };
  await captureMeetingScreenshot(page as any, "first.jpg");
  await captureMeetingScreenshot(page as any, "second.jpg");
  await captureMeetingScreenshot(page as any, "fallback.jpg");
  assert.equal(calls[0].clip.width, 1800);
  assert.equal(calls[1].clip.width, 1600);
  assert.equal(calls[2].clip, undefined);
  assert.equal(calls[0].type, "jpeg");
  assert.equal(calls[2].path, "fallback.jpg");
});
