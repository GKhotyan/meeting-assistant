import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { join } from "node:path";
async function run(scenario: string, action: (message: any, child: ReturnType<typeof fork>) => void) {
  const child = fork(join(__dirname, "fixtures/worker-connection.cjs"), [], {
    execArgv: ["--require", "tsx/cjs"],
    env: { ...process.env, CONNECTION_SCENARIO: scenario },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const messages: any[] = []; let stderr = "";
  child.stderr!.on("data", chunk => stderr += chunk);
  const exit = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", () => resolve());
  });
  child.on("message", (m: any) => { messages.push(m); action(m, child); });
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    child.send({ type: "start", input: { meetingUrl: "https://zoom.us/j/12345678901", botName: "Bot", recordingMode: "audio" }, sessionDir: "/tmp" });
    await exit;
    assert.equal(stderr, "");
    assert.ok(messages.some(m => m.type === "done"), "worker must confirm completion instead of timing out");
    return messages;
  } finally { clearTimeout(watchdog); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
}
for (const scenario of ["retry", "crash-connect", "screenshot-failure"]) test(`real worker recovers from ${scenario} and records only after admission`, async () => {
  const messages = await run(scenario, (m, child) => {
    if (m.type === "status" && m.status === "recording") child.send({ type: "stop" });
  });
  const events = messages.filter(m => m.type === "probe").map(m => m.event + (m.number || ""));
  assert.ok(events.indexOf("closed1") < events.indexOf("launching2"));
  assert.equal(events.filter(e => e.startsWith("launching")).length, 2);
  assert.equal(events.filter(e => e === "closed2").length, 1);
  assert.equal(messages.at(-1).error, undefined);
  assert.deepEqual(messages.filter(m => m.type === "attempts").at(-1).attempts.map((a: any) => a.outcome), ["failed", "connected"]);
  const captures = messages.filter(m => m.event === "diagnostic-screenshot");
  assert.equal(captures.length, 1, "capture only the failed attempt");
  assert.equal(captures[0].options.path, "/tmp/connection-attempt-1-error.png");
  assert.ok(captures[0].options.timeout <= 5000);
  assert.ok(events.indexOf("diagnostic-screenshot1") < events.indexOf("closed1"));
});
for (const scenario of ["stop-launch", "stop-admission", "stop-delay"]) test(`real worker cancels ${scenario} and closes its browser before done`, async () => {
  let stopped = false;
  const messages = await run(scenario, (m, child) => {
    if (!stopped && ((scenario === "stop-launch" && m.event === "launching") ||
        (scenario === "stop-admission" && m.event === "admitting") ||
        (scenario === "stop-delay" && m.type === "attempts" && m.nextRetryAt))) {
      stopped = true; child.send({ type: "stop" });
    }
  });
  assert.equal(messages.filter(m => m.event === "launching").length, 1);
  assert.equal(messages.filter(m => m.event === "closed").length, 1);
  assert.equal(messages.some(m => m.status === "recording"), false);
  // stop-delay follows a genuine failure, already captured before the pause.
  assert.equal(messages.filter(m => m.event === "diagnostic-screenshot").length, scenario === "stop-delay" ? 1 : 0);
  assert.equal(messages.at(-1).error, undefined);
});
test("real worker never rejoins after a browser crash during recording", async () => {
  const messages = await run("crash-recording", (m, child) => {
    if (m.type === "status" && m.status === "recording") child.send({ type: "probe-crash" });
  });
  assert.equal(messages.filter(m => m.event === "launching").length, 1);
  assert.match(messages.at(-1).error, /closed unexpectedly/);
  assert.equal(messages.filter(m => m.event === "audio-stopped").length, 1);
});
