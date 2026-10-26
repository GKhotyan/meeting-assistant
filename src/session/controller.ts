import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { Session, Status, StartInput, AppError, terminal, RecordingMode } from "./types";
export interface Worker extends EventEmitter {
  send(message: unknown): unknown;
  kill(signal?: NodeJS.Signals): unknown;
}
function recordingMode(value: unknown): RecordingMode {
  if (value === undefined) return "video";
  if (value === "video" || value === "screenshots") return value;
  throw new AppError(400, "Choose video or screenshots");
}
export function validateInput(input: StartInput): StartInput {
  if (
    typeof input?.botName !== "string" ||
    !input.botName.trim() ||
    input.botName.trim().length > 100
  )
    throw new AppError(400, "Bot name must contain 1 to 100 characters");
  let url: URL;
  try {
    url = new URL(input.meetingUrl);
  } catch {
    throw new AppError(400, "A Zoom meeting link is required");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !(url.hostname === "zoom.us" || url.hostname.endsWith(".zoom.us")) ||
    !/^\/(?:j\/\d{9,11}|wc\/(?:join\/)?\d{9,11}(?:\/join)?)\/?$/.test(
      url.pathname,
    )
  )
    throw new AppError(
      400,
      "Use a standard HTTPS meeting link on zoom.us",
    );
  return { meetingUrl: url.href, botName: input.botName.trim(), recordingMode: recordingMode(input.recordingMode) };
}
export class Controller {
  private sessions = new Map<string, Session>();
  private active?: {
    id: string;
    worker: Worker;
    done: boolean;
    stopping?: Promise<void>;
  };
  private config = { botName: "Engineering Assistant", recordingMode: "video" as RecordingMode };
  constructor(
    readonly root: string,
    private spawnWorker: (dir: string) => Worker,
  ) {
    mkdirSync(join(root, "recordings"), { recursive: true });
    if (existsSync(join(root, "settings.json")))
      this.config = JSON.parse(
        readFileSync(join(root, "settings.json"), "utf8"),
      );
    this.config.recordingMode = recordingMode(this.config.recordingMode);
    for (const dir of readdirSync(join(root, "recordings"))) {
      const file = join(root, "recordings", dir, "session.json");
      if (!existsSync(file)) continue;
      const s = JSON.parse(readFileSync(file, "utf8")) as Session;
      if (!terminal(s.status)) {
        s.status = "interrupted";
        s.error = "The worker exited before recording finished";
        this.save(s);
      }
      this.sessions.set(s.id, s);
    }
  }
  private atomic(path: string, value: unknown) {
    writeFileSync(path + ".tmp", JSON.stringify(value, null, 2), {
      mode: 0o600,
    });
    renameSync(path + ".tmp", path);
  }
  private save(s: Session) {
    this.atomic(join(this.root, "recordings", s.id, "session.json"), s);
  }
  settings() {
    return { ...this.config };
  }
  setSettings(value: { botName: string; recordingMode?: RecordingMode }) {
    const botName = validateInput({
      meetingUrl: "https://zoom.us/j/12345678901",
      botName: value?.botName,
    }).botName;
    this.config = { botName, recordingMode: recordingMode(value.recordingMode ?? this.config.recordingMode) };
    this.atomic(join(this.root, "settings.json"), this.config);
    return this.settings();
  }
  list() {
    return [...this.sessions.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => structuredClone(s));
  }
  getSession(id: string) {
    const s = this.sessions.get(id);
    return s ? structuredClone(s) : undefined;
  }
  async startSession(raw: StartInput) {
    const input = validateInput({ ...raw, recordingMode: raw?.recordingMode ?? this.config.recordingMode });
    if (this.active)
      throw new AppError(409, "A meeting is already running. Stop it first.");
    const s: Session = {
      id: randomUUID(),
      botName: input.botName,
      recordingMode: input.recordingMode,
      createdAt: new Date().toISOString(),
      status: "queued",
      files: [],
    };
    const dir = join(this.root, "recordings", s.id);
    mkdirSync(dir, { recursive: true });
    this.sessions.set(s.id, s);
    this.save(s);
    let worker: Worker;
    try {
      worker = this.spawnWorker(dir);
    } catch (e) {
      s.status = "failed";
      s.error = "Could not start the bot worker";
      this.save(s);
      throw e;
    }
    const active = { id: s.id, worker, done: false } as NonNullable<
      Controller["active"]
    >;
    this.active = active;
    worker.on("message", (m: any) => {
      if (active.done) return;
      if (
        m?.type === "status" &&
        ["joining", "waiting", "recording", "stopping"].includes(m.status)
      ) {
        if (s.status !== "stopping") s.status = m.status as Status;
        if (typeof m.detail === "string") s.error = m.detail;
      } else if (m?.type === "done") {
        active.done = true;
        s.files = Array.isArray(m.files) ? m.files : [];
        s.error = m.error;
        s.status = m.error ? "failed" : "completed";
        s.endedAt = new Date().toISOString();
      }
      this.save(s);
    });
    worker.on("exit", () => {
      if (!active.done) {
        s.status = "interrupted";
        s.error = "The worker exited before confirming completion";
        s.endedAt = new Date().toISOString();
        this.save(s);
      }
      if (this.active === active) this.active = undefined;
    });
    worker.on("error", () => {
      s.status = "failed";
      s.error = "Bot worker error";
      active.done = true;
      this.save(s);
      worker.kill("SIGTERM");
    });
    worker.send({ type: "start", input, sessionId: s.id, sessionDir: dir });
    return structuredClone(s);
  }
  async stopSession(id: string) {
    const s = this.sessions.get(id);
    if (!s) throw new AppError(404, "Session not found");
    const a = this.active;
    if (!a || a.id !== id) return;
    if (a.stopping) return a.stopping;
    s.status = "stopping";
    this.save(s);
    a.stopping = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => a.worker.kill("SIGKILL"), 55000);
      timeout.unref();
      a.worker.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      try {
        a.worker.send({ type: "stop" });
      } catch {
        a.worker.kill("SIGTERM");
      }
    });
    return a.stopping;
  }
  async shutdown() {
    if (this.active) await this.stopSession(this.active.id);
  }
}
