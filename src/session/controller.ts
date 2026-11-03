import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { Session, Status, StartInput, AppError, terminal, RecordingMode, ConnectionAttempt } from "./types";
import { redact } from "./security";
export interface Worker extends EventEmitter {
  send(message: unknown): unknown;
  kill(signal?: NodeJS.Signals): unknown;
}
function recordingMode(value: unknown): RecordingMode {
  if (value === undefined) return "video";
  if (value === "video" || value === "screenshots" || value === "audio") return value;
  throw new AppError(400, "Choose video, screenshots, or audio only");
}
export function validateInput(input: StartInput): StartInput {
  if (
    typeof input?.botName !== "string" ||
    !input.botName.trim() ||
    input.botName.trim().length > 100
  )
    throw new AppError(400, "Bot name must contain 1 to 100 characters");
  const meetingName = input.meetingName === undefined ? "Meeting" : input.meetingName;
  if (typeof meetingName !== "string" || !meetingName.trim() || meetingName.trim().length > 100)
    throw new AppError(400, "Meeting name must contain 1 to 100 characters");
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
  return { meetingUrl: url.href, botName: input.botName.trim(), meetingName: meetingName.trim(), recordingMode: recordingMode(input.recordingMode) };
}
function folderPrefix(name: string) {
  const safe = name.normalize("NFKC").replace(/[^\p{L}\p{M}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "") || "Meeting";
  let prefix = "";
  for (const character of safe) {
    if (Buffer.byteLength(prefix + character) > 180) break;
    prefix += character;
  }
  return prefix;
}
function attemptSnapshot(value: unknown): ConnectionAttempt[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return;
  const date = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
  const result: ConnectionAttempt[] = [];
  for (const [index, attempt] of value.entries()) {
    if (!attempt || attempt.number !== index + 1 || !date(attempt.startedAt) ||
        !["connecting", "connected", "failed", "cancelled"].includes(attempt.outcome) ||
        (attempt.endedAt !== undefined && !date(attempt.endedAt)) ||
        (attempt.error !== undefined && typeof attempt.error !== "string")) return;
    result.push({ number: attempt.number, startedAt: attempt.startedAt,
      endedAt: attempt.endedAt, outcome: attempt.outcome,
      error: attempt.error === undefined ? undefined : redact(attempt.error) });
  }
  return result;
}
function finishConnectingAttempts(s: Session, outcome: "failed" | "cancelled", error?: string) {
  for (const attempt of s.attempts ?? []) {
    if (attempt.outcome !== "connecting") continue;
    attempt.outcome = outcome;
    attempt.endedAt = new Date().toISOString();
    if (error) attempt.error = redact(error);
  }
}
export class Controller {
  private sessions = new Map<string, Session>();
  private recordingDirectories = new Map<string, string>();
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
      this.recordingDirectories.set(s.id, join(root, "recordings", dir));
      s.meetingName ||= "Meeting";
      if (!terminal(s.status)) {
        delete s.nextRetryAt;
        finishConnectingAttempts(s, "cancelled");
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
    this.atomic(join(this.getSessionDirectory(s.id), "session.json"), s);
  }
  getSessionDirectory(id: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new AppError(404, "Session not found");
    return this.recordingDirectories.get(id) ?? join(this.root, "recordings", id);
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
  deleteSession(id: string) {
    const session = this.sessions.get(id);
    if (!session || !/^[a-zA-Z0-9-]+$/.test(id))
      throw new AppError(404, "Session not found");
    if (this.active?.id === id || !terminal(session.status))
      throw new AppError(409, "Stop the meeting and wait for recording to finish before deleting it.");
    rmSync(this.getSessionDirectory(id), { recursive: true, force: true });
    this.sessions.delete(id);
    this.recordingDirectories.delete(id);
  }
  async startSession(raw: StartInput) {
    const input = validateInput({ ...raw, recordingMode: raw?.recordingMode ?? this.config.recordingMode });
    if (this.active)
      throw new AppError(409, "A meeting is already running. Stop it first.");
    const s: Session = {
      id: randomUUID(),
      meetingName: input.meetingName!,
      botName: input.botName,
      recordingMode: input.recordingMode,
      createdAt: new Date().toISOString(),
      status: "queued",
      files: [],
      attempts: [],
    };
    const dir = join(this.root, "recordings", folderPrefix(s.meetingName) + "_" + s.id);
    mkdirSync(dir, { recursive: true });
    this.recordingDirectories.set(s.id, dir);
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
      if (m?.type === "attempts") {
        const attempts = attemptSnapshot(m.attempts);
        if (!attempts) return;
        s.attempts = attempts;
        delete s.nextRetryAt;
        if (s.status !== "stopping") {
          delete s.error;
          if (typeof m.nextRetryAt === "string" && Number.isFinite(Date.parse(m.nextRetryAt))) {
            s.nextRetryAt = m.nextRetryAt;
            s.status = "retrying";
          } else if (["connecting", "connected"].includes(attempts.at(-1)!.outcome)) {
            s.status = "joining";
          }
        }
      } else if (
        m?.type === "status" &&
        ["joining", "waiting", "recording", "stopping"].includes(m.status)
      ) {
        if (s.status !== "stopping") s.status = m.status as Status;
        if (typeof m.detail === "string") s.error = redact(m.detail);
        if (m.status === "recording") { delete s.error; delete s.nextRetryAt; }
      } else if (m?.type === "done") {
        active.done = true;
        s.files = Array.isArray(m.files) ? m.files : [];
        s.error = typeof m.error === "string" ? redact(m.error) : undefined;
        delete s.nextRetryAt;
        s.status = m.error ? "failed" : "completed";
        s.endedAt = new Date().toISOString();
      }
      this.save(s);
    });
    worker.on("exit", () => {
      if (!active.done) {
        delete s.nextRetryAt;
        s.status = "interrupted";
        s.error = "The worker exited before confirming completion";
        finishConnectingAttempts(s, "failed", s.error);
        s.endedAt = new Date().toISOString();
        this.save(s);
      }
      if (this.active === active) this.active = undefined;
    });
    worker.on("error", () => {
      s.status = "failed";
      s.error = "Bot worker error";
      finishConnectingAttempts(s, "failed", s.error);
      delete s.nextRetryAt;
      s.endedAt = new Date().toISOString();
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
    delete s.nextRetryAt;
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
