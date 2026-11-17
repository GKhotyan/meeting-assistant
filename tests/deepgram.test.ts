import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeepgramSettings, checkDeepgram } from "../src/integrations/deepgram";

const root = () => mkdtempSync(join(tmpdir(), "deepgram-"));
test("credentials survive restart encrypted with private permissions and can be removed", () => {
  const dir = root(), settings = new DeepgramSettings(dir);
  assert.deepEqual(settings.metadata(), { configured: false });
  settings.save("  fixture-secret  ");
  assert.equal(new DeepgramSettings(dir).key(), "fixture-secret");
  assert.equal(readFileSync(join(dir, "settings/api-keys.json"), "utf8").includes("fixture-secret"), false);
  for (const path of ["settings/api-keys.json", "secrets/master.key"])
    assert.equal(statSync(join(dir, path)).mode & 0o777, 0o600);
  for (const path of ["settings", "secrets"])
    assert.equal(statSync(join(dir, path)).mode & 0o777, 0o700);
  settings.remove();
  assert.deepEqual(new DeepgramSettings(dir).metadata(), { configured: false });
});
test("missing master key and tampered ciphertext fail closed without replacing data", () => {
  for (const kind of ["missing", "tampered"]) {
    const dir = root(), settings = new DeepgramSettings(dir);
    settings.save("fixture-secret");
    if (kind === "missing") unlinkSync(join(dir, "secrets/master.key"));
    else writeFileSync(join(dir, "secrets/master.key"), Buffer.alloc(32));
    const before = readFileSync(join(dir, "settings/api-keys.json"), "utf8");
    assert.throws(() => new DeepgramSettings(dir).save("replacement"), /decrypt|encryption/i);
    assert.equal(readFileSync(join(dir, "settings/api-keys.json"), "utf8"), before);
  }
});
test("invalid keys cannot overwrite credentials", () => {
  const settings = new DeepgramSettings(root());
  settings.save("original");
  for (const invalid of [null, {}, "", "  ", "a\nb", "ключ", "a".repeat(513)])
    assert.throws(() => settings.save(invalid));
  assert.equal(settings.key(), "original");
});
test("check uses only auth endpoint and does not expose provider bodies", async () => {
  let calls = 0;
  const transport: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://api.deepgram.com/v1/auth/token");
    assert.equal((options?.headers as Record<string,string>).Authorization, "Token fixture-secret");
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal);
    assert.equal(options?.body, undefined);
    return Response.json({ subject: "user", accessor: "key" });
  };
  assert.equal((await checkDeepgram("fixture-secret", transport)).valid, true);
  assert.equal(calls, 1);
  for (const status of [401, 403, 429, 500]) {
    const result = await checkDeepgram("fixture-secret", async () => new Response("fixture-secret", {status}));
    assert.equal(result.valid, false);
    assert.equal(JSON.stringify(result).includes("fixture-secret"), false);
  }
  for (const transport of [async () => Response.json({}), async () => { throw Error("fixture-secret"); },
    async () => new Response("not json"), async () => new Response("x".repeat(65537))])
    assert.equal((await checkDeepgram("fixture-secret", transport)).valid, false);
});
