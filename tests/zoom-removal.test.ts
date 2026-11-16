import { test } from "node:test";
import assert from "node:assert/strict";
import { startZoomRemovalMonitor } from "../vendor/vexa/join/zoom/removal";

// The browser boundary exposes the observed modal, body text and still-visible Leave button.
function page(text: string, modal: boolean): any {
  return {
    on() {}, off() {}, isClosed: () => false,
    url: () => "https://app.zoom.us/wc/123456789/meeting",
    title: async () => "Zoom Meeting",
    locator(selector: string) {
      const locator: any = {
        first: () => locator,
        count: async () => 0,
        isVisible: async () => selector === ".zm-modal-body-title" ? modal : selector === 'button[aria-label="Leave"]',
        textContent: async () => text,
      };
      return locator;
    },
    evaluate: async (fn: any, arg: any) => {
      (globalThis as any).document = { body: { innerText: text } };
      try { return fn(arg); } finally { delete (globalThis as any).document; }
    },
  };
}
for (const modal of [true, false]) {
  test(`Zoom connection timeout stops recording with an error (${modal ? "modal" : "body"})`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const reasons: unknown[] = [];
    const stop = startZoomRemovalMonitor(page("Joining Meeting Timeout or Browser restriction", modal), reason => { reasons.push(reason); });
    try {
      t.mock.timers.tick(3000);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(reasons.length, 1);
      assert.match(String(reasons[0]), /Joining Meeting Timeout or Browser restriction/);
      t.mock.timers.tick(30000);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(reasons.length, 1);
    } finally { stop(); }
  });
}
for (const [text, expected] of [["This meeting has been ended by host", 1], ["Your microphone is muted", 0]] as const) {
  test(`removal monitor preserves behavior for: ${text}`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const reasons: unknown[] = [];
    const stop = startZoomRemovalMonitor(page(text, true), reason => { reasons.push(reason); });
    try {
      t.mock.timers.tick(3000);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(reasons.length, expected);
      if (expected) assert.equal(reasons[0], undefined);
    } finally { stop(); }
  });
}
