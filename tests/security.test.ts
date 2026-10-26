import { test } from "node:test";
import assert from "node:assert/strict";
import { redact } from "../src/session/security";
test("logs remove Zoom passcodes and bearer credentials", () => {
  const result = redact(
    "Join https://zoom.us/j/12345678901?pwd=abcSecret&other=1 Authorization: Bearer keySecret",
  );
  assert.ok(!result.includes("abcSecret"));
  assert.ok(!result.includes("keySecret"));
  assert.ok(result.includes("12345678901"));
});
