# Recurring Meetings Implementation Plan

> Execute inline in this ongoing workspace; preserve all prior changes.

**Goal:** Persist weekly Zoom rules and launch them automatically through the existing controller.
**Architecture:** A scheduler owns JSON rules and occurrence claims; the server exposes CRUD routes, starts/stops the scheduler, and the existing UI gets two tabs with a rule editor and list.
**Tech Stack:** TypeScript, Node fs/Intl, existing HTTP server and plain browser JavaScript; no new dependencies.
**Spec:** `docs/superpowers/specs/2026-10-27-recurring-meetings-design.md`

## Constraints and review focus

One active worker. Default Europe/Moscow. Persist occurrence claims before launch. Never catch up old launches. Validate weekdays, clock time, zone, URL and mode. Test restarts, concurrent ticks, overlaps, DST boundaries and invalid input. UI must preserve edits during polling and use textContent for user text.

### Task 1: Weekly scheduler and persistence

- [x] Write failing tests in `tests/schedules.test.ts`: next weekly occurrence and timezone; validation; CRUD persistence; exactly one launch; collision/missed outcomes; pause/resume; restart and concurrent ticks; DST.
- [x] Run tests to confirm failure; implement `src/session/schedules.ts` with `nextOccurrence`, `Scheduler.list/create/update/delete/tick/start/stop` and public typed rules/outcomes.
- [x] Run tests and typecheck; inspect failures before proceeding.

### Task 2: API and service lifecycle

- [x] Write failing HTTP tests in `tests/api.test.ts` for schedule CRUD, invalid requests, missing IDs, authentication and cross-site protection.
- [x] Add optional Scheduler integration to `src/server/app.ts`; wire startup/shutdown in `src/server/main.ts`.
- [x] Run API tests and full suite.

### Task 3: Tabs and weekly editor

- [x] Update `public/index.html`, `public/app.js`, `public/style.css`: accessible tabs, weekly editor, per-rule edit/pause/delete, next occurrence and last outcome, shared history.
- [x] Run browser smoke against fixture schedules in temporary storage: create/edit/pause/delete, tab switching, preserve input on refresh; build and run all tests.
- [x] Review changes; check no active meeting, rebuild/restart Docker, verify served UI and APIs and persisted recording history.

## Ledger

Ruling: continue in the current workspace — the user asked to extend and deploy the already modified app; creating a worktree would omit authorized uncommitted changes. No commits or merges requested.
Ruling: execute inline — no delegation requested, and these tasks share interfaces and the current application state.

Verification: 44/44 application tests passed, TypeScript/build and JavaScript syntax checks passed. Playwright smoke passed twice in the Docker image, including real Controller single-worker collision handling with synthetic workers (no live Zoom call). Desktop/mobile screenshots visually inspected. Independent review identified a failed-claim persistence path; regression test reproduced it, rollback fixed it, and full suite passed. Docker image rebuilt and service recreated with no active recordings.
