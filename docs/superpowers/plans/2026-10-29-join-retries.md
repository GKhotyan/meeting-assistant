# Connection retries implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** Recover from intermittent admission failures and show connection attempt history.
**Architecture:** The worker owns a cancellable four-attempt connection loop and fresh browser cleanup. The controller persists attempt snapshots; existing cards expose accessible expandable history.
**Tech Stack:** TypeScript, Node, Playwright, vanilla JavaScript/CSS.
**Spec:** docs/superpowers/specs/2026-10-29-join-retries-design.md

## Global Constraints
- Four attempts maximum; delays 10,000 / 10,000 / 60,000 ms after failure.
- One session throughout retries, no automatic reconnect after recording starts.
- Stop cancels admission and delays; close each failed browser before retrying.
- Retry known browser/network failures and zoom_requires_rtms only; never host rejection, ended meeting, wrong passcode, authentication, or admission waiting timeout.
- English interface, persisted redacted errors, backwards compatibility with old sessions.

## Review Focus
- Stop races with browser launch/close must not spawn the next attempt or leak browsers.
- Browser crash while connecting may retry; crash while recording must fail without reconnecting.
- Cleanup failures must stop retries, preventing simultaneous browsers.
- Successful recovery must clear current error while retaining red history.
- Polling must retain expanded details and keyboard accessibility, and countdown must advance without backend updates.

### Task 1: Cancellable connection attempts
**Files:** Create src/worker/connect.ts and tests/connect.test.ts; modify src/worker/main.ts and src/session/types.ts.
**Interfaces:** ConnectionAttempt {number, startedAt, endedAt?, outcome: connecting|connected|failed|cancelled, error?}; connectWithRetries<T>({signal, open, connect, close, onChange, now?, wait?}): Promise<T>. onChange emits full attempts and optional nextRetryAt.
- [x] Write tests for four attempts and exact delays, eventual success, permanent errors, lobby timeout, unknown errors, redaction, cancellation during connection/delay/launch and cleanup failures. Run node --import tsx --test tests/connect.test.ts; expect missing module failure.
- [x] Implement fresh-resource retry loop with AbortSignal, selective retry classification, cleanup-before-delay, and snapshot notifications. Integrate only around launch/join/admission; detach lifecycle handlers before cleanup; keep recording outside loop.
- [x] Run focused tests and npm run typecheck; expect pass.

### Task 2: Persist attempt history
**Files:** Modify src/session/controller.ts and tests/controller.test.ts.
**Interfaces:** Worker sends {type: attempts, attempts: ConnectionAttempt[], nextRetryAt?: string}; Session gains attempts? and nextRetryAt?, status gains retrying.
- [x] Write failing controller tests for persisted history, redaction, retrying concurrency/stop, clearing errors on success, restart interruption, and terminal cleanup. Run focused tests; expect failures on missing attempt metadata.
- [x] Persist bounded validated snapshots, clear transient errors/retry time on success or terminal state; retain old-session compatibility.
- [x] Run controller tests and npm test; expect pass.

### Task 3: Attempt block and verification
**Files:** Modify public/app.js and public/style.css; create tests/browser-attempts.cjs; update README.md and README.ru.md.
**Interfaces:** Existing GET session data supplies history; details.attempts shows count, red failures, timestamps and errors as text; nextRetryAt drives live countdown.
- [x] Write browser integration test with actual controller/server and simulated worker events for red history after success, refresh persistence, countdown/stop, escaped error text, mobile fit, old sessions. Run against prechange UI; expect missing attempts element.
- [x] Implement accessible expandable block preserving open/focus on refresh; update active status/countdown and document retry policy.
- [x] Run npm test, npm run test:vendor, npm run build, browser regression and inspect screenshots. Review full diff; correct material findings and rerun relevant checks.
- [x] Build and restart local app only when no meeting is active; verify health and new UI. Do not initiate another live meeting without a current need.

## Execution notes
User approved the complete design and implementation. Execute inline without another approval gate. Leave changes uncommitted for review; isolated worktree may be used and copied back after verification.
