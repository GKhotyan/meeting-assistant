import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForZoomMeetingAdmission } from "../vendor/vexa/join/zoom/admission";
import { AdmissionError } from "../vendor/vexa/join/shared/admission";
function page(text: string): any {
  const locator: any = { first: () => locator, isVisible: async () => false, count: async () => 0 };
  return {
    locator: () => locator,
    evaluate: async (fn: any, arg: any) => {
      (globalThis as any).document = { body: { innerText: text } };
      try { return fn(arg); } finally { delete (globalThis as any).document; }
    },
    waitForTimeout: async () => {},
  };
}
test("sign-in-only admission gate is authentication, not a retryable bot block", async () => {
  await assert.rejects(waitForZoomMeetingAdmission(page("Sign in to join"), 0, {}),
    (error: any) => error instanceof AdmissionError && error.outcome === "auth_session_missing");
});
test("actual bot warning with a sign-in option still reports the bot-block reason", async () => {
  await assert.rejects(waitForZoomMeetingAdmission(page("Automated bots aren't allowed. Sign in to join"), 0, {}),
    (error: any) => error instanceof AdmissionError && error.outcome === "denial" && /zoom_requires_rtms/.test(error.message));
});
