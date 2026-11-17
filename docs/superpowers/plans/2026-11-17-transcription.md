# Transcription Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** Manual background Deepgram transcription with a dedicated meeting view.
**Architecture:** Stream manifest audio through a transcription service, persist normalized result/job status beside recording; hash-routed meeting view uses existing API and styling.
**Tech Stack:** TypeScript, Node fs/fetch, vanilla DOM, node:test, Playwright.
**Spec:** docs/superpowers/specs/2026-11-17-transcription-design.md

## Global Constraints
No new dependencies, no automatic paid requests/retries, no key/provider error leaks, preserve existing settings and recording workflows.

## Review Focus
- File safety: missing/partial/symlink/outside files never uploaded.
- Concurrency/restart: duplicate requests rejected; interrupted work never replayed; deletion blocked.
- Retry: old result retained, errors sanitized, malformed response rejected.
- Navigation: stale responses don't replace another meeting; player/forms preserved on polling.
- Playback: byte ranges and timestamps seek correctly; keyboard/mobile layouts work.

### Task 1: Background service and API
Files: src/transcription/service.ts, src/recordings/access.ts, src/server/app.ts, tests/transcription.test.ts, tests/api.test.ts.
Interfaces: Transcriptions(controller, settings, transport?).get(id), summary(id), start(id, options), isRunning(id). GET/POST /api/sessions/:id/transcription with {audioFileId,language,diarize}; state {status:idle|processing|completed|failed|interrupted, options?,error?,transcript?}. Normalized transcript {audioFileId,audioFile,language,diarize,model,createdAt,text,segments:[{start,end,text,speaker?}]}.
- [x] Add failing service/API tests for streaming/options, persistence, restart, concurrency, safety, malformed/error responses, range/auth/origin/deletion.
- [x] Implement safe file access, service, API routes and range playback.
- [x] Run focused tests/typecheck.

### Task 2: Meeting view and card navigation
Files: public/meeting.js, public/app.js, public/index.html, public/style.css, tests/browser-transcription.cjs, existing browser fixtures.
- [x] Add failing browser test for card/title/status entry, two tabs, no navigation uploads, submit/progress/result/error/retry, seek, Back/reload, stale responses, mobile.
- [x] Implement dedicated route/view with shared player and stable controls during polling.
- [x] Document manual transfer, persistence/restart and scope in README.md/README.ru.md.
- [x] Run full npm test/build, browser regressions, inspect screenshots and request independent code review.

## Execution evidence

Implemented in the existing checkout, preserving the earlier uncommitted Deepgram settings work. New service/API/browser tests failed before their corresponding implementation. Final npm test: 110 passed; npm run build passed. Transcription browser test covers explicit upload, selected options, background completion, existing result retention, timestamps, error/retry, reload/Back, slow API polling, audio selection preservation, pending seek cancellation, stale navigation response, and 390px layout. Settings, workspace and recording-files browser regressions passed. Desktop/mobile transcript screenshots inspected. A native fetch test streams synthetic audio through a local HTTP server; no real recording or provider request was used.

Independent review identified overlapping slow polling, selection reset during polling, and pending timestamp autoplay across navigation. Each was reproduced in browser regression tests and fixed. Follow-up review found no blocking issue. No deployment or changes to the running container.
