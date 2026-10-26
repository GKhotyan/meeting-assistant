import type { Page } from "playwright";
import { join } from "node:path";
import { AudioWriter } from "../recordings/writer";
export async function createAudioRecorder(
  page: Page,
  dir: string,
  onFault: (e: Error) => void,
) {
  const writer = new AudioWriter(dir);
  let writeError: Error | undefined;
  await page.exposeFunction(
    "__eaChunk",
    (chunk: { chunkSeq: number; base64: string }) => {
      try {
        writer.append(chunk.chunkSeq, Buffer.from(chunk.base64, "base64"));
        return true;
      } catch (e) {
        writeError = e as Error;
        onFault(writeError);
        return false;
      }
    },
  );
  await page.addScriptTag({ path: join(process.cwd(), "dist/capture.js") });
  await page.evaluate(async () => {
    const w = window as any;
    w.__eaAudioTracks = new Map();
    const ctx = new AudioContext();
    await ctx.resume();
    const dest = ctx.createMediaStreamDestination();
    const seen = new Set();
    const sources: any[] = [];
    const clock = ctx.createOscillator(),
      silent = ctx.createGain();
    silent.gain.value = 0;
    clock.connect(silent);
    silent.connect(dest);
    clock.start();
    w.__eaSilentClock = clock;
    function attach() {
      for (const el of document.querySelectorAll("audio,video")) {
        const stream = (el as HTMLMediaElement).srcObject;
        if (stream instanceof MediaStream)
          for (const track of stream.getAudioTracks())
            w.__eaAudioTracks.set(track.id, track);
      }
      for (const track of w.__eaAudioTracks.values()) {
        if (seen.has(track.id) || track.readyState === "ended") continue;
        const source = ctx.createMediaStreamSource(new MediaStream([track]));
        source.connect(dest);
        sources.push(source);
        seen.add(track.id);
      }
    }
    attach();
    for (let i = 0; ctx.currentTime < 0.1 && i < 100; i++)
      await new Promise((r) => setTimeout(r, 25));
    if (ctx.currentTime < 0.1) throw Error("Аудиочасы браузера не запустились");
    w.__eaAudioTimer = setInterval(attach, 500);
    w.__eaAudioContext = ctx;
    w.__eaRecorder = new w.EngineeringCapture.MediaRecorderChunker({
      stream: dest.stream,
      timesliceMs: 2000,
      onChunk: (c: any) => w.__eaChunk(c),
    });
    await w.__eaRecorder.start();
    if (!w.__eaRecorder.getMediaRecorder())
      throw Error("Не удалось запустить MediaRecorder");
  });
  writer.startedAtMs = Date.now();
  return {
    startedAtMs: writer.startedAtMs,
    async stop() {
      if (!page.isClosed())
        await page.evaluate(async () => {
          const w = window as any;
          clearInterval(w.__eaAudioTimer);
          await w.__eaRecorder?.stop();
          w.__eaSilentClock?.stop();
          await w.__eaAudioContext?.close();
        });
      if (writeError) throw writeError;
      return writer.finalize();
    },
  };
}
