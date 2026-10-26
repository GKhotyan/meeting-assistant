import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { watchBrowser } from "../src/worker/lifecycle";
test("unexpected page crash or close triggers cleanup once and expected close does not", () => {
  const p = new EventEmitter(),
    c = new EventEmitter();
  let errors = 0;
  const detach = watchBrowser(p as any, c as any, () => errors++);
  p.emit("crash");
  c.emit("close");
  assert.equal(errors, 1);
  detach();
  p.emit("close");
  assert.equal(errors, 1);
  const detach2 = watchBrowser(p as any, c as any, () => errors++);
  detach2();
  c.emit("close");
  assert.equal(errors, 1);
});
