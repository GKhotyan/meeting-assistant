import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { Controller } from "../src/session/controller";
import { createApp } from "../src/server/app";
import { Scheduler } from "../src/session/schedules";
async function app(password?: string, existingRoot?: string, publicOrigin?: string) {
  const root = existingRoot ?? mkdtempSync(join(tmpdir(), "ea-api-"));
  const workers: any[] = [];
  const c = new Controller(root, () => {
    const w = new EventEmitter() as any;
    w.send = () => {};
    w.kill = () => {};
    workers.push(w);
    return w;
  });
  const server = createApp(c, {
    password,
    publicOrigin,
    publicDir: join(process.cwd(), "public"),
    scheduler: new Scheduler(root, c),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as any;
  return {
    c,
    root,
    workers,
    base: "http://127.0.0.1:" + addr.port,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
test("API stores name, rejects invalid input and concurrent launch", async () => {
  const a = await app();
  try {
    const req = (path: string, body: any) =>
      fetch(a.base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const settings = await fetch(a.base + "/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botName: "Notes" }),
    });
    assert.equal((await settings.json()).botName, "Notes");
    assert.equal(
      (
        await req("/api/sessions", {
          meetingUrl: "https://evil.test",
          botName: "A",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await req("/api/sessions", {
          meetingUrl: "https://zoom.us/j/12345678901",
          botName: "Notes",
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await req("/api/sessions", {
          meetingUrl: "https://zoom.us/j/12345678901",
          botName: "Notes",
        })
      ).status,
      409,
    );
    assert.equal(
      (await (await fetch(a.base + "/api/sessions")).json()).sessions.length,
      1,
    );
  } finally {
    await a.close();
  }
});
test("API challenges missing credentials and rejects cross-site mutation", async () => {
  const a = await app("secret");
  try {
    assert.equal((await fetch(a.base + "/api/settings")).status, 401);
    const headers = {
      Authorization:
        "Basic " + Buffer.from("assistant:secret").toString("base64"),
    };
    assert.equal(
      (await fetch(a.base + "/api/settings", { headers })).status,
      200,
    );
    assert.equal(
      (
        await fetch(a.base + "/api/settings", {
          method: "PUT",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            Origin: "https://evil.test",
          },
          body: '{"botName":"bad"}',
        })
      ).status,
      403,
    );
  } finally {
    await a.close();
  }
});
test("configured public origin allows proxy requests while rejecting other origins and spoofed forwarded hosts", async () => {
  const a = await app(undefined, undefined, "http://meeting-assistant.s.sandboxes.detmir-infra.ru/");
  try {
    const update = (origin: string) => fetch(a.base + "/api/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "X-Forwarded-Host": "evil.test",
        "X-Forwarded-Proto": "https",
      },
      body: '{"botName":"Proxy Notes"}',
    });
    const result = await update("http://meeting-assistant.s.sandboxes.detmir-infra.ru");
    assert.equal(result.status, 200);
    assert.equal((await result.json()).botName, "Proxy Notes");
    for (const origin of ["https://evil.test", "http://meeting-assistant.s.sandboxes.detmir-infra.ru.evil.test", "https://meeting-assistant.s.sandboxes.detmir-infra.ru", a.base, "null", "invalid"]) {
      assert.equal((await update(origin)).status, 403, origin);
    }
  } finally {
    await a.close();
  }
});
test("API only downloads manifest files and refuses traversal", async () => {
  const a = await app();
  try {
    const id = "session-test";
    mkdirSync(join(a.root, "recordings", id));
    writeFileSync(join(a.root, "recordings", id, "audio.webm"), "audio");
    (a.c as any).sessions.set(id, {
      id,
      status: "completed",
      botName: "A",
      createdAt: "2026",
      files: [
        {
          id: "audio",
          name: "audio.webm",
          status: "ready",
          kind: "audio",
          bytes: 5,
        },
      ],
    });
    const result = await fetch(a.base + "/api/sessions/" + id + "/files/audio");
    assert.equal(result.status, 200);
    assert.equal(await result.text(), "audio");
    assert.equal(
      (await fetch(a.base + "/api/sessions/" + id + "/files/unknown")).status,
      404,
    );
    writeFileSync(join(a.root, "recordings", id, "shot.jpg"), "jpeg");
    (a.c as any).sessions.get(id).files.push({ id: "screenshot-000000", name: "shot.jpg", kind: "screenshot", status: "ready", bytes: 4 });
    const shot = await fetch(a.base + "/api/sessions/" + id + "/files/screenshot-000000");
    assert.equal(shot.headers.get("content-type"), "image/jpeg");
    assert.equal(await shot.text(), "jpeg");
    (a.c as any).sessions.get(id).files[0].name = "../../settings.json";
    assert.equal(
      (await fetch(a.base + "/api/sessions/" + id + "/files/audio")).status,
      404,
    );
  } finally {
    await a.close();
  }
});

test("DELETE permanently removes a finished session and all its files, preserving other sessions", async () => {
  const a = await app();
  try {
    for (const id of ["delete-me", "keep-me"]) {
      const dir = join(a.root, "recordings", id);
      mkdirSync(join(dir, "audio-parts"), { recursive: true });
      for (const file of ["audio.webm", "screen.mp4", "shot.jpg", "worker.log", "audio-parts/000000.webm"])
        writeFileSync(join(dir, file), "data");
      const session = { id, status: "completed", botName: "Notes", createdAt: "2026", files: [] };
      writeFileSync(join(dir, "session.json"), JSON.stringify(session));
      (a.c as any).sessions.set(id, session);
    }
    const response = await fetch(a.base + "/api/sessions/delete-me", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
    });
    assert.equal(response.status, 200);
    assert.equal(existsSync(join(a.root, "recordings", "delete-me")), false);
    assert.equal(a.c.getSession("delete-me"), undefined);
    assert.equal(existsSync(join(a.root, "recordings", "keep-me", "audio.webm")), true);
    const restored = new Controller(a.root, () => { throw Error("unused"); });
    assert.deepEqual(restored.list().map(s => s.id), ["keep-me"]);
    assert.equal((await fetch(a.base + "/api/sessions/delete-me")).status, 404);
    assert.equal((await fetch(a.base + "/api/sessions/delete-me/files/audio")).status, 404);
  } finally { await a.close(); }
});

test("DELETE rejects active sessions and cross-site requests", async () => {
  const a = await app();
  try {
    const session = await a.c.startSession({ meetingUrl: "https://zoom.us/j/12345678901", botName: "Notes" });
    const url = a.base + "/api/sessions/" + session.id;
    const headers = { "Content-Type": "application/json" };
    assert.equal((await fetch(url, { method: "DELETE", headers })).status, 409);
    assert.equal(existsSync(join(a.root, "recordings", "Meeting_" + session.id, "session.json")), true);
    assert.equal((await fetch(url, { method: "DELETE", headers: { ...headers, Origin: "https://evil.test" } })).status, 403);
    assert.equal((await fetch(a.base + "/api/sessions/unknown", { method: "DELETE", headers })).status, 404);
  } finally { await a.close(); }
});

test("schedule API creates, lists, edits, pauses and deletes recurring meetings", async () => {
  const a = await app();
  try {
    const headers = { "Content-Type": "application/json" };
    const input = { name: "Daily", weekdays: [1, 2, 4, 5], time: "10:00", timeZone: "Europe/Moscow",
      meetingUrl: "https://zoom.us/j/12345678901", recordingMode: "audio" };
    const response = await fetch(a.base + "/api/schedules", { method: "POST", headers, body: JSON.stringify(input) });
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.equal(created.name, "Daily");
    assert.ok(created.nextRunAt);
    const list = await (await fetch(a.base + "/api/schedules")).json();
    assert.equal(list.schedules.length, 1);
    const url = a.base + "/api/schedules/" + created.id;
    const paused = await fetch(url, { method: "PUT", headers, body: JSON.stringify({ enabled: false, name: "Grooming" }) });
    assert.equal(paused.status, 200);
    assert.equal((await paused.json()).enabled, false);
    assert.equal((await fetch(url, { method: "PUT", headers, body: '{"time":"25:00"}' })).status, 400);
    assert.equal((await fetch(url, { method: "DELETE", headers })).status, 200);
    assert.equal((await (await fetch(a.base + "/api/schedules")).json()).schedules.length, 0);
    assert.equal((await fetch(url, { method: "PUT", headers, body: "{}" })).status, 404);
    assert.equal((await fetch(a.base + "/api/schedules", { method: "POST", headers, body: "null" })).status, 400);
    assert.equal((await fetch(a.base + "/api/schedules", { method: "POST", headers: { ...headers, Origin: "https://evil.test" }, body: JSON.stringify(input) })).status, 403);
  } finally { await a.close(); }
});

test("schedule API requires authentication when the app is protected", async () => {
  const a = await app("secret");
  try {
    assert.equal((await fetch(a.base + "/api/schedules")).status, 401);
    assert.equal((await fetch(a.base + "/api/schedules", { headers: {
      Authorization: "Basic " + Buffer.from("assistant:secret").toString("base64"),
    } })).status, 200);
  } finally { await a.close(); }
});

test("named folder recordings download and delete through UUID API routes after restart", async () => {
  const a = await app();
  let restored: Awaited<ReturnType<typeof app>> | undefined;
  try {
    const response = await fetch(a.base + "/api/sessions", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        botName: "Notes", meetingName: "PIM Daily", meetingUrl: "https://zoom.us/j/12345678901",
      }) });
    assert.equal(response.status, 201);
    const session = await response.json();
    const dir = join(a.root, "recordings", "PIM_Daily_" + session.id);
    writeFileSync(join(dir, "audio.webm"), "audio");
    a.workers[0].emit("message", { type: "done", files: [{ id: "audio", name: "audio.webm", status: "ready", kind: "audio", bytes: 5 }] });
    a.workers[0].emit("exit", 0, null);
    restored = await app(undefined, a.root);
    const result = await fetch(restored.base + "/api/sessions/" + session.id + "/files/audio");
    assert.equal(result.status, 200);
    assert.equal(await result.text(), "audio");
    assert.equal(restored.c.getSession(session.id)?.meetingName, "PIM Daily");
    const deletion = await fetch(restored.base + "/api/sessions/" + session.id, { method: "DELETE", headers: { "Content-Type": "application/json" } });
    assert.equal(deletion.status, 200);
    assert.equal(existsSync(dir), false);
    assert.equal(restored.c.list().length, 0);
  } finally { await restored?.close(); await a.close(); }
});
