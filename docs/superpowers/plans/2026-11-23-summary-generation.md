# Meeting Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Generate, store and present meeting summaries from complete saved transcripts.

**Architecture:** Native fetch provider adapter and explicit context policy feed a durable Summaries service. Existing HTTP routes and meeting view expose explicit manual generation and saved results.

**Tech Stack:** TypeScript, Node 22, vanilla JavaScript, node:test, Playwright. No runtime dependencies added.

**Spec:** `docs/superpowers/specs/2026-11-23-summary-generation-design.md`

## Global Constraints

- Explicit manual generation only; never truncate transcript input silently.
- English interface and README; preserve user content language.
- Fixed provider endpoints, bounded context/output/requests; no automatic paid retries.
- Preserve previous successful results and detect changed transcript input.

## Review Focus

- Unicode and pathological long lines: split without lost text or broken characters.
- Unsupported reasoning effort: reject before sending a paid request.
- Truncated, empty, oversized or secret-bearing provider failures: fail without leaking bodies.
- Retranscription/navigation races: protect jobs and ignore stale UI responses.
- Restart and failed regeneration: retain successful results and never automatically retry.

### Task 1: Provider and context policy

Files: create `src/summary/model.ts`, `src/summary/generate.ts`, `tests/summary-generation.test.ts`.

Interfaces: `modelPolicy(provider, model, effort)` returns context/output limits and request parameters; `generateSummary(input, transport, progress)` returns text/request count/usage; `transcriptFingerprint(transcript)` identifies exact input.

- [x] Write tests for provider request contracts, effort validation, Unicode chunk coverage, recursive merging, output/context/response limits and sanitized errors; run RED.
- [x] Implement policies, bounded transport and full-input generation; run GREEN.

### Task 2: Durable service and HTTP integration

Files: create `src/summary/service.ts`, `tests/summary-service.test.ts`; modify `src/server/app.ts`, `tests/api.test.ts`.

Interfaces: `Summaries(controller, transcriptions, ai, transport?).get(id)`, `.start(id, raw)`, `.isRunning(id)`, `.status(id)`; GET/POST `/api/sessions/:id/summary`, GET `/api/sessions/:id/summary/download`.

- [x] Write lifecycle and API tests: readiness, duplicates, result provenance, restart, failed retry, stale result, no automatic requests, protected delete/retranscription and Markdown download; run RED.
- [x] Implement atomic storage, input snapshots, generation progress and routes; run GREEN.

### Task 3: Summary interface and documentation

Files: create `public/meeting-summary.js`, `tests/browser-summary.cjs`; modify `public/meeting.js`, `public/index.html`, `public/app.js`, `public/style.css`, `README.md`, existing browser route fixtures.

- [x] Write browser checks for explicit start, status/result, retry, copying/download, stale state, keyboard routes, late response isolation and mobile overflow; run RED.
- [x] Implement Summary controller and integrate three accessible tabs/cards. Update README to match actual behavior; run GREEN.
- [x] Run full unit suite, typecheck/build and browser regression checks. Review diff and resolve material findings before delivery.

## Execution record

Design approved in conversation. Execute inline in the existing clean feature checkout; do not create or publish branches, commits or remote deployments as part of this request. Baseline suite recorded in `/tmp/meeting-summary-baseline.log`.


Task 1: provider/context tests RED (missing module) → GREEN; known families have explicit limits, unknown IDs use conservative bounds. Task 2: lifecycle/API tests RED (missing service/routes) → GREEN. Task 3: Summary browser workflow, transcription regression and workspace regression passed in installed Chrome; bundled Playwright Chromium is not installed. Build passed.

Final review: fresh reviewer found omitted diarized speaker turns. Fixed by adding anonymous timed turns alongside the complete text, including both in source size/context accounting. Regression test `summary source preserves diarized speaker turns alongside all transcript text` RED→GREEN. No other material findings reported. No deferred minors.

Implementation choices: native inline execution in the existing checkout; no commits or remote deployment. Conservative model fallback may split more often; unavailable/unsupported model parameters fail explicitly. Minimal safe Markdown rendering supports headings, bullets and bold, while copy/download preserve original Markdown.

Final verification: 159/159 server tests passed; TypeScript/build and Chrome Summary, Transcription and Workspace scenarios passed. Docker image rebuilt locally; no running jobs before recreation. Local app refreshed on port 8088 with persistent data retained. No real paid LLM request was submitted during verification.
