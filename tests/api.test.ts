import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { Controller } from "../src/session/controller";
import { createApp } from "../src/server/app";
async function app(password?: string) {
  const root = mkdtempSync(join(tmpdir(), "ea-api-"));
  const c = new Controller(root, () => {
    const w = new EventEmitter() as any;
    w.send = () => {};
    w.kill = () => {};
    return w;
  });
  const server = createApp(c, {
    password,
    publicDir: join(process.cwd(), "public"),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as any;
  return {
    c,
    root,
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
