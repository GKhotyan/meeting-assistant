import { test } from "node:test";
import assert from "node:assert/strict";
import { connectWithRetries } from "../src/worker/connect";
import { AdmissionError } from "../vendor/vexa/join/shared/admission";

function fixture(errors: unknown[] = []) {
  const abort = new AbortController();
  const events: any[] = [], order: string[] = [], delays: number[] = [];
  let opened = 0;
  const options = {
    signal: abort.signal,
    open: async () => { order.push(`open${++opened}`); return opened; },
    connect: async (id: number) => { order.push(`connect${id}`); if (id <= errors.length) throw errors[id - 1]; },
    close: async (id: number) => { order.push(`close${id}`); },
    onChange: (state: any) => events.push(structuredClone(state)),
    now: () => 1000,
    wait: async (ms: number, _signal: AbortSignal) => { delays.push(ms); order.push(`wait${ms}`); },
  };
  return { options, abort, events, order, delays, opened: () => opened };
}
const block = () => new AdmissionError("denial", "[Zoom Web] zoom_requires_rtms: automated bots aren't allowed");

test("four blocked attempts close each browser before 10s, 10s, 60s delays and then fail", async () => {
  const f = fixture([block(), block(), block(), block()]);
  await assert.rejects(connectWithRetries(f.options), /zoom_requires_rtms/);
  assert.equal(f.opened(), 4);
  assert.deepEqual(f.delays, [10000, 10000, 60000]);
  assert.deepEqual(f.order.slice(0, 5), ["open1", "connect1", "close1", "wait10000", "open2"]);
  assert.deepEqual(f.events.at(-1).attempts.map((a: any) => a.outcome), ["failed", "failed", "failed", "failed"]);
  assert.equal(f.events.at(-1).nextRetryAt, undefined);
  assert.equal(f.events.find(e => e.nextRetryAt).nextRetryAt, "1970-01-01T00:00:11.000Z");
});
test("successful recovery returns live browser with redacted failure history and no pending retry", async () => {
  const f = fixture([new Error("net::ERR_CONNECTION_RESET https://zoom.us/?pwd=secret")]);
  assert.equal(await connectWithRetries(f.options), 2);
  assert.deepEqual(f.events.at(-1).attempts.map((a: any) => a.outcome), ["failed", "connected"]);
  assert.match(f.events.at(-1).attempts[0].error, /pwd=\[redacted\]/);
  assert.equal(JSON.stringify(f.events).includes("secret"), false);
  assert.equal(f.order.includes("close2"), false);
  assert.equal(f.events.at(-1).nextRetryAt, undefined);
});
for (const error of [
  new AdmissionError("denial", "Bot was rejected from the Zoom meeting or meeting ended"),
  new AdmissionError("auth_session_missing", "auth_required"),
  new AdmissionError("lobby_timeout", "Bot not admitted within timeout"),
  new Error("incorrect passcode"), new Error("passcode_required"),
  new Error("authentication required"), new Error("Unexpected programming error"),
  new Error("Timeout 30000ms exceeded: incorrect password"),
]) test(`does not retry permanent or unknown error: ${error.message}`, async () => {
  const f = fixture([error]);
  await assert.rejects(connectWithRetries(f.options));
  assert.equal(f.opened(), 1);
  assert.deepEqual(f.delays, []);
  assert.ok(f.order.includes("close1"));
});
test("browser launch failure can recover without closing nonexistent resource", async () => {
  const f = fixture(); let calls = 0;
  f.options.open = async () => { if (++calls === 1) throw new Error("browserType.launch: Target page, context or browser has been closed"); return 2; };
  assert.equal(await connectWithRetries(f.options), 2);
  assert.equal(calls, 2);
  assert.equal(f.order.some(s => s.startsWith("close")), false);
});
test("stop during retry delay prevents all further attempts", async () => {
  const f = fixture([block()]);
  f.options.wait = async () => { f.abort.abort(); };
  await assert.rejects(connectWithRetries(f.options), { name: "AbortError" });
  assert.equal(f.opened(), 1);
  assert.equal(f.events.at(-1).nextRetryAt, undefined);
});
test("stop interrupts a hanging admission operation and closes the browser once", async () => {
  const f = fixture();
  f.options.connect = async () => { queueMicrotask(() => f.abort.abort()); return new Promise(() => {}); };
  await assert.rejects(connectWithRetries(f.options), { name: "AbortError" });
  assert.deepEqual(f.order, ["open1", "close1"]);
  assert.equal(f.events.at(-1).attempts[0].outcome, "cancelled");
});
test("stop during launch closes its eventual browser before returning", async () => {
  const f = fixture();
  f.options.open = async () => { f.abort.abort(); return 1; };
  await assert.rejects(connectWithRetries(f.options), { name: "AbortError" });
  assert.deepEqual(f.order, ["close1"]);
  assert.equal(f.events.at(-1).attempts[0].outcome, "cancelled");
});
test("stop before first attempt launches nothing", async () => {
  const f = fixture(); f.abort.abort();
  await assert.rejects(connectWithRetries(f.options), { name: "AbortError" });
  assert.equal(f.opened(), 0);
});
test("cleanup failure stops retries to avoid overlapping browsers", async () => {
  const f = fixture([block()]);
  f.options.close = async () => { throw Error("browser close failed"); };
  await assert.rejects(connectWithRetries(f.options), /browser close failed/);
  assert.equal(f.opened(), 1);
  assert.deepEqual(f.delays, []);
  assert.match(f.events.at(-1).attempts[0].error, /zoom_requires_rtms/);
  assert.match(f.events.at(-1).attempts[0].error, /browser close failed/);
});
test("default delay is abortable", async () => {
  const f = fixture([block()]);
  const { wait, ...options } = f.options;
  options.onChange = state => { f.events.push(state); if (state.nextRetryAt) setImmediate(() => f.abort.abort()); };
  await assert.rejects(connectWithRetries(options), { name: "AbortError" });
  assert.equal(f.opened(), 1);
});
test("synchronous cancellation inside connect observes its rejected operation", async () => {
  const f = fixture();
  f.options.connect = async () => { f.abort.abort(); throw Error("closed during stop"); };
  await assert.rejects(connectWithRetries(f.options), { name: "AbortError" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.events.at(-1).attempts[0].outcome, "cancelled");
});
for (const credential of ["password123", "passcode", "rejected", "removed"]) test(`URL data ${credential} cannot suppress a transient network retry`, async () => {
  const f = fixture([new Error(`page.goto: net::ERR_CONNECTION_RESET at https://app.zoom.us/wc/12345678901/join?pwd=${credential}`)]);
  assert.equal(await connectWithRetries(f.options), 2);
  assert.deepEqual(f.events.at(-1).attempts.map((a: any) => a.outcome), ["failed", "connected"]);
});
