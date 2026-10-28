import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { AudioWriter, recordScreen } from "../src/recordings/writer";
const dir = () => mkdtempSync(join(tmpdir(), "ea-audio-"));
function fixture(root: string) {
  const p = join(root, "fixture.webm");
  execFileSync("ffmpeg", [
    "-nostdin",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-c:a",
    "libopus",
    p,
  ]);
  return readFileSync(p);
}
test("audio finalization preserves ordered chunks including the final short tail", async () => {
  const root = dir(),
    data = fixture(root),
    w = new AudioWriter(root);
  w.append(0, data.subarray(0, 200));
  w.append(1, data.subarray(200, -50));
  w.append(2, data.subarray(-50));
  w.append(3, Buffer.alloc(0));
  const out = await w.finalize();
  assert.equal(out.name, "audio.webm");
  assert.equal(out.status, "ready");
  assert.equal(existsSync(join(root, "audio-stream.partial.webm")), false);
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type",
        "-of",
        "json",
        join(root, out.name),
      ],
      { encoding: "utf8" },
    ),
  );
  assert.ok(Number(probe.format.duration) > 0.99);
  assert.equal(probe.streams.length, 1);
  assert.equal(probe.streams[0].codec_type, "audio");
});
test("audio rejects missing chunks and leaves recoverable parts intact", async () => {
  const root = dir(),
    data = fixture(root),
    w = new AudioWriter(root);
  w.append(1, data);
  await assert.rejects(() => w.finalize(), /sequence/);
  assert.ok(existsSync(join(root, "audio-parts", "000001.webm")));
  assert.equal(existsSync(join(root, "audio.webm")), false);
});
test("audio rejects empty or invalid recording without publishing ready file", async () => {
  const root = dir(),
    w = new AudioWriter(root);
  await assert.rejects(() => w.finalize());
  w.append(0, Buffer.from("invalid"));
  await assert.rejects(() => w.finalize());
  assert.equal(existsSync(join(root, "audio.webm")), false);
  assert.equal(readFileSync(join(root, "audio-stream.partial.webm"), "utf8"), "invalid");
});
test("audio disk write failure propagates instead of losing a chunk silently", () => {
  const root = dir();
  writeFileSync(join(root, "audio-parts"), "blocked");
  assert.throws(() => new AudioWriter(root));
});
test("screen recorder stops gracefully with a playable silent MP4", async () => {
  const root = dir();
  const r = await recordScreen(root, {
    inputArgs: ["-re", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15"],
  });
  await new Promise((r) => setTimeout(r, 550));
  const out = await r.stop();
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type:format=duration",
        "-of",
        "json",
        join(root, out.name),
      ],
      { encoding: "utf8" },
    ),
  );
  assert.equal(out.status, "ready");
  assert.deepEqual(
    probe.streams.map((s: any) => s.codec_type),
    ["video"],
  );
  assert.ok(Number(probe.format.duration) > 0);
});
