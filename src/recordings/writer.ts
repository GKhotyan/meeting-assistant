import {
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  statSync,
  renameSync,
  unlinkSync,
  existsSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { RecordingFile } from "../session/types";
export const ffmpeg = process.env.FFMPEG || "ffmpeg";
async function run(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err = (err + d).slice(-1500)));
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error("FFmpeg failed: " + err)),
    );
  });
}
export class AudioWriter {
  startedAtMs = Date.now();
  private parts: string;
  constructor(readonly dir: string) {
    this.parts = join(dir, "audio-parts");
    mkdirSync(this.parts, { recursive: true });
  }
  append(sequence: number, bytes: Buffer) {
    if (!Number.isSafeInteger(sequence) || sequence < 0)
      throw Error("Invalid audio sequence");
    if (!bytes.length) return;
    writeFileSync(
      join(this.parts, String(sequence).padStart(6, "0") + ".webm"),
      bytes,
      { flag: "wx" },
    );
  }
  async finalize(): Promise<RecordingFile> {
    const files = readdirSync(this.parts)
      .filter((n) => /^\d{6}\.webm$/.test(n))
      .sort();
    if (!files.length) throw Error("No audio received");
    for (let i = 0; i < files.length; i++)
      if (files[i] !== String(i).padStart(6, "0") + ".webm")
        throw Error("Missing audio sequence");
    const raw = join(this.dir, "audio-stream.partial.webm");
    const fd = openSync(raw, "w");
    try {
      for (const f of files) {
        const bytes = readFileSync(join(this.parts, f));
        require("node:fs").writeSync(fd, bytes);
      }
    } finally {
      closeSync(fd);
    }
    const out = join(this.dir, "audio-finalizing.webm");
    await run([
      "-nostdin",
      "-v",
      "error",
      "-y",
      "-i",
      raw,
      "-map",
      "0:a:0",
      "-c:a",
      "copy",
      out,
    ]);
    renameSync(out, join(this.dir, "audio.webm"));
    unlinkSync(raw);
    return {
      id: "audio",
      name: "audio.webm",
      kind: "audio",
      status: "ready",
      startedAtMs: this.startedAtMs,
      endedAtMs: Date.now(),
      bytes: statSync(join(this.dir, "audio.webm")).size,
    };
  }
}
export async function recordScreen(
  dir: string,
  options: { inputArgs?: string[]; onFault?: (error: Error) => void } = {},
) {
  const partial = join(dir, "screen.partial.mp4"),
    target = join(dir, "screen.mp4"),
    startedAtMs = Date.now();
  let stopped = false;
  let errorText = "";
  const p = spawn(
    ffmpeg,
    [
      "-hide_banner",
      "-v",
      "error",
      "-y",
      ...(options.inputArgs || [
        "-f",
        "x11grab",
        "-framerate",
        "15",
        "-video_size",
        "1920x1080",
        "-i",
        process.env.DISPLAY || ":99",
      ]),
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+frag_keyframe+empty_moov+default_base_moof",
      partial,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  p.stdin.on("error", () => {});
  p.stderr.on("data", (d) => (errorText = (errorText + d).slice(-1500)));
  const done = new Promise<void>((resolve, reject) => {
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(Error("Video recording failed: " + errorText)),
    );
  });
  done.catch((e) => {
    if (!stopped) options.onFault?.(e);
  });
  await new Promise<void>((resolve, reject) => {
    p.once("spawn", resolve);
    p.once("error", reject);
  });
  // Catch failures that occur immediately after exec (e.g. missing X display).
  await Promise.race([
    done.then(() => {
      throw Error("Video recording ended unexpectedly");
    }),
    new Promise((r) => setTimeout(r, 250)),
  ]);
  let stopping: Promise<RecordingFile> | undefined;
  return {
    stop() {
      return (stopping ??= (async () => {
        stopped = true;
        p.stdin.write("q\n");
        const timer = setTimeout(() => p.kill("SIGKILL"), 15000);
        try {
          await done;
        } finally {
          clearTimeout(timer);
        }
        if (!existsSync(partial) || statSync(partial).size === 0)
          throw Error("Video recording is empty");
        renameSync(partial, target);
        return {
          id: "screen",
          name: "screen.mp4",
          kind: "screen",
          status: "ready",
          startedAtMs,
          endedAtMs: Date.now(),
          bytes: statSync(target).size,
        } as RecordingFile;
      })());
    },
  };
}
