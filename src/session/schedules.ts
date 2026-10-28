import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { validateInput } from "./controller";
import type { Controller } from "./controller";
import { AppError, type RecordingMode } from "./types";

export interface ScheduleInput {
  botName?: string;
  name: string;
  meetingUrl: string;
  weekdays: number[]; // ISO weekdays: Monday=1, Sunday=7
  time: string;
  timeZone: string;
  recordingMode: RecordingMode;
  enabled?: boolean;
}
export interface Schedule extends ScheduleInput {
  botName: string;
  id: string;
  enabled: boolean;
  nextRunAt?: string;
  lastRun?: {
    scheduledAt: string;
    status: "starting" | "started" | "skipped" | "failed";
    sessionId?: string;
    reason?: string;
  };
}

function formatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
}
function localMillis(format: Intl.DateTimeFormat, date: number) {
  const parts = Object.fromEntries(format.formatToParts(date).map(p => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
}

export function nextOccurrence(
  rule: Pick<ScheduleInput, "weekdays" | "time" | "timeZone">,
  after: Date,
): string {
  const format = formatter(rule.timeZone);
  const local = new Date(localMillis(format, after.getTime()));
  const [hour, minute] = rule.time.split(":").map(Number);
  for (let day = 0; day <= 14; day++) {
    const wall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + day, hour, minute);
    if (!rule.weekdays.includes(new Date(wall).getUTCDay() || 7)) continue;
    // Sample offsets on both sides of a clock change; verify each candidate's wall time.
    const candidates = new Set<number>();
    for (const delta of [-36, 0, 36]) {
      const sample = wall + delta * 3_600_000;
      const offset = localMillis(format, sample) - sample;
      const candidate = wall - offset;
      if (localMillis(format, candidate) === wall) candidates.add(candidate);
    }
    // The first occurrence wins on a repeated DST hour, including after it has passed.
    const first = [...candidates].sort((a, b) => a - b)[0];
    if (first !== undefined && first > after.getTime()) return new Date(first).toISOString();
  }
  throw Error("Could not calculate the next weekly occurrence");
}

function validate(value: ScheduleInput): ScheduleInput & { enabled: boolean; botName: string } {
  if (typeof value?.name !== "string" || !value.name.trim() || value.name.trim().length > 100)
    throw new AppError(400, "Meeting name must contain 1 to 100 characters");
  if (!Array.isArray(value.weekdays) || !value.weekdays.length || value.weekdays.length > 7 ||
      value.weekdays.some(d => !Number.isInteger(d) || d < 1 || d > 7))
    throw new AppError(400, "Choose one or more weekdays");
  if (typeof value.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time))
    throw new AppError(400, "Choose a time in HH:mm format");
  const timeZone = value.timeZone ?? "Europe/Moscow";
  try {
    if (typeof timeZone !== "string" || !timeZone.trim()) throw Error();
    formatter(timeZone);
  } catch { throw new AppError(400, "Choose a valid IANA time zone, such as Europe/Moscow"); }
  if (value.enabled !== undefined && typeof value.enabled !== "boolean")
    throw new AppError(400, "Enabled must be true or false");
  const input = validateInput({ meetingUrl: value.meetingUrl, recordingMode: value.recordingMode, botName: value.botName === undefined ? "Engineering Assistant" : value.botName });
  return {
    name: value.name.trim(), meetingUrl: input.meetingUrl, botName: input.botName,
    weekdays: [...new Set(value.weekdays)].sort((a, b) => a - b),
    time: value.time, timeZone, recordingMode: input.recordingMode!, enabled: value.enabled ?? true,
  };
}

export class Scheduler {
  private rules: Schedule[];
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private file: string;
  constructor(
    root: string,
    private controller: Pick<Controller, "settings" | "startSession"> | {
      settings(): { botName: string };
      startSession(input: Parameters<Controller["startSession"]>[0]): Promise<{ id: string }>;
    },
    private now: () => Date = () => new Date(),
  ) {
    mkdirSync(root, { recursive: true });
    this.file = join(root, "schedules.json");
    this.rules = existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : [];
    for (const rule of this.rules) {
      Object.assign(rule, validate(rule));
      if (rule.lastRun?.status === "starting") {
        rule.lastRun.status = "failed";
        rule.lastRun.reason = "Service restarted during launch; automatic retry was skipped.";
      }
    }
  }
  private save() {
    writeFileSync(this.file + ".tmp", JSON.stringify(this.rules, null, 2), { mode: 0o600 });
    renameSync(this.file + ".tmp", this.file);
  }
  list(): Schedule[] { return structuredClone(this.rules); }
  create(input: ScheduleInput): Schedule {
    const value = validate(input);
    const rule: Schedule = { ...value, id: randomUUID(),
      nextRunAt: value.enabled ? nextOccurrence(value, this.now()) : undefined };
    this.rules.push(rule);
    try { this.save(); } catch (e) { this.rules.pop(); throw e; }
    return structuredClone(rule);
  }
  update(id: string, input: Partial<ScheduleInput>): Schedule {
    const index = this.rules.findIndex(r => r.id === id);
    if (index < 0) throw new AppError(404, "Schedule not found");
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new AppError(400, "Invalid schedule");
    const old = this.rules[index];
    const value = validate({ ...old, ...input });
    const changed = !old.enabled || old.time !== value.time || old.timeZone !== value.timeZone ||
      JSON.stringify(old.weekdays) !== JSON.stringify(value.weekdays);
    const rule: Schedule = { ...old, ...value,
      nextRunAt: !value.enabled ? undefined : changed ? nextOccurrence(value, this.now()) : old.nextRunAt };
    this.rules[index] = rule;
    try { this.save(); } catch (e) { this.rules[index] = old; throw e; }
    return structuredClone(rule);
  }
  delete(id: string) {
    const index = this.rules.findIndex(r => r.id === id);
    if (index < 0) throw new AppError(404, "Schedule not found");
    const [removed] = this.rules.splice(index, 1);
    try { this.save(); } catch (e) { this.rules.splice(index, 0, removed); throw e; }
  }
  tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.runDue().finally(() => { this.running = undefined; });
    return this.running;
  }
  private async runDue() {
    for (const rule of [...this.rules]) {
      if (!this.rules.includes(rule) || !rule.enabled || !rule.nextRunAt) continue;
      const now = this.now();
      const scheduled = Date.parse(rule.nextRunAt);
      if (scheduled > now.getTime()) continue;
      const missed = now.getTime() - scheduled >= 60_000;
      const previousRun = rule.lastRun;
      const previousNext = rule.nextRunAt;
      rule.lastRun = { scheduledAt: rule.nextRunAt, status: missed ? "skipped" : "starting",
        ...(missed ? { reason: "Missed scheduled time while the service was unavailable." } : {}) };
      rule.nextRunAt = nextOccurrence(rule, now);
      // Persist the claim before spawning a worker. Never retry an uncertain launch on restart.
      try { this.save(); } catch (e) {
        rule.lastRun = previousRun;
        rule.nextRunAt = previousNext;
        throw e;
      }
      if (missed) continue;
      try {
        const session = await this.controller.startSession({ meetingUrl: rule.meetingUrl,
          meetingName: rule.name, botName: rule.botName, recordingMode: rule.recordingMode });
        rule.lastRun.status = "started";
        rule.lastRun.sessionId = session.id;
      } catch (e) {
        const busy = e instanceof AppError && e.status === 409;
        rule.lastRun.status = busy ? "skipped" : "failed";
        rule.lastRun.reason = busy ? "Skipped because another meeting is still active." : "Could not start the meeting. Check the recording history.";
      }
      if (this.rules.includes(rule)) this.save();
    }
  }
  start() {
    if (this.timer) return;
    const poll = () => { void this.tick().catch(() => console.error("Scheduler could not persist or process scheduled meetings")); };
    this.timer = setInterval(poll, 10_000);
    this.timer.unref();
    poll();
  }
  async stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }
}
