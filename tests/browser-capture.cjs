// Run inside the built image: node /tmp/browser-capture.cjs
const { chromium } = require("/app/node_modules/playwright");
const { createAudioRecorder } = require("/app/dist/src/worker/audio");
const { mkdtempSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
(async () => {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: { width: 1920, height: 1080 },
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const page = context.pages()[0];

    await page.goto("about:blank");
    const dir = mkdtempSync("/tmp/ea-browser-audio-");
    const start = Date.now();
    const recorder = await createAudioRecorder(page, dir, (e) => {
      throw e;
    });
    assert.ok(
      Date.now() - start < 5000,
      "silent meeting must start recording within 5 seconds",
    );
    await page.evaluate(async () => {
      const ctx = new AudioContext();
      await ctx.resume();
      const osc = ctx.createOscillator(),
        dest = ctx.createMediaStreamDestination();
      osc.frequency.value = 440;
      osc.connect(dest);
      osc.start();
      const el = document.createElement("audio");
      el.srcObject = dest.stream;
      document.body.append(el);
      window.testCtx = ctx;
    });
    console.log(
      "START_CLOCK",
      await page.evaluate(() => ({
        t: window.__eaAudioContext.currentTime,
        s: window.__eaAudioContext.state,
        latency: window.__eaAudioContext.baseLatency,
      })),
    );
    await page.waitForTimeout(2500);
    console.log(
      "END_CLOCK",
      await page.evaluate(() => ({
        t: window.__eaAudioContext.currentTime,
        s: window.__eaAudioContext.state,
      })),
    );
    const result = await recorder.stop();
    const file = dir + "/" + result.name;
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
          file,
        ],
        { encoding: "utf8" },
      ),
    );
    assert.ok(Number(probe.format.duration) > 2);
    const samples = execFileSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      file,
      "-f",
      "s16le",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-",
    ]);
    let energy = 0;
    for (let i = 0; i + 1 < samples.length; i += 2)
      energy += Math.abs(samples.readInt16LE(i));
    assert.ok(energy > 100000, "late-attached audio source must be audible");
    console.log(
      JSON.stringify({
        status: "PASS",
        file,
        duration: probe.format.duration,
        energy,
      }),
    );
  } finally {
    await context.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
