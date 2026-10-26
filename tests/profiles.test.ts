import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProfile } from "../src/worker/profiles";
test("browser sessions own isolated disposable profiles and cleanup does not delete another session", () => {
  const a = createProfile(),
    b = createProfile();
  assert.notEqual(a.path, b.path);
  writeFileSync(join(b.path, "keep"), "data");
  a.close();
  a.close();
  assert.equal(existsSync(a.path), false);
  assert.equal(existsSync(join(b.path, "keep")), true);
  b.close();
});
