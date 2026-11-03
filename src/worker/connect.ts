import { setTimeout as delay } from "node:timers/promises";
import { AdmissionError } from "../../vendor/vexa/join/shared/admission";
import { ConnectionAttempt } from "../session/types";
import { redact } from "../session/security";

export interface AttemptState {
  attempts: ConnectionAttempt[];
  nextRetryAt?: string;
}
interface ConnectOptions<T> {
  signal: AbortSignal;
  open(): Promise<T>;
  connect(resource: T): Promise<void>;
  close(resource: T): Promise<void>;
  onChange(state: AttemptState): void;
  now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}
function retryable(error: unknown) {
  // Playwright includes navigation URLs in errors; URL data is not a platform verdict.
  const text = String(error).replace(/https?:\/\/[^\s"'<>]+/gi, "[URL]");
  // Explicit platform decisions win over generic timeout/browser wording.
  if (/auth_required|auth_session_missing|authentication|passcode|password|rejected|removed|meeting (?:has )?ended|host ended|host did not start/i.test(text)) return false;
  if (error instanceof AdmissionError) return error.outcome === "join_failure" || (error.outcome === "denial" && /zoom_requires_rtms/.test(text));
  return /net::ERR_|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|Target (?:page, context or browser|closed)|browser (?:has been closed|closed unexpectedly)|page crashed|TimeoutError|Timeout \d+ms exceeded/i.test(text);
}
function abortError() { return new DOMException("Connection stopped", "AbortError"); }
async function untilAborted<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(operation), cancelled]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

/** Owns connection attempts only. A returned resource belongs to the recording lifecycle. */
export async function connectWithRetries<T>(options: ConnectOptions<T>): Promise<T> {
  const { signal } = options;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((ms, signal) => delay(ms, undefined, { signal }));
  const attempts: ConnectionAttempt[] = [];
  const emit = (nextRetryAt?: string) => options.onChange({ attempts: structuredClone(attempts), nextRetryAt });
  const delays = [10000, 10000, 60000];
  for (let number = 1; number <= 4; number++) {
    signal.throwIfAborted();
    const attempt: ConnectionAttempt = { number, startedAt: new Date(now()).toISOString(), outcome: "connecting" };
    attempts.push(attempt);
    emit();
    let resource: T | undefined;
    let failure: unknown;
    try {
      // Launch is not cancellable: wait for it so its eventual browser is always closed.
      resource = await options.open();
      signal.throwIfAborted();
      await untilAborted(() => options.connect(resource!), signal);
      signal.throwIfAborted();
      attempt.outcome = "connected";
      attempt.endedAt = new Date(now()).toISOString();
      emit();
      return resource;
    } catch (error) {
      failure = error;
      attempt.outcome = signal.aborted ? "cancelled" : "failed";
      if (!signal.aborted) attempt.error = redact(String(error));
    }
    // Cleanup precedes the retry timer and cannot be skipped by cancellation.
    try {
      if (resource !== undefined) await options.close(resource);
    } catch (error) {
      attempt.error = [attempt.error, `Browser cleanup failed: ${redact(String(error))}`].filter(Boolean).join("\n");
      attempt.endedAt = new Date(now()).toISOString();
      emit();
      throw error;
    }
    attempt.endedAt = new Date(now()).toISOString();
    if (signal.aborted || number === 4 || !retryable(failure)) {
      emit();
      if (signal.aborted) throw abortError();
      throw failure;
    }
    const pause = delays[number - 1];
    emit(new Date(now() + pause).toISOString());
    try {
      await wait(pause, signal);
      signal.throwIfAborted();
    } catch (error) {
      emit();
      throw error;
    }
  }
  throw Error("Connection attempts exhausted");
}
