# Deepgram Settings Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Configure and check encrypted Deepgram credentials in Settings.
**Architecture:** Separate credential store and server-only provider check; dedicated API routes; independent UI form.
**Tech Stack:** TypeScript, Node crypto/fs/fetch, vanilla JS, node:test, Playwright.
**Spec:** docs/superpowers/specs/2026-11-17-deepgram-settings-design.md

## Global Constraints
No new runtime dependencies. No audio or summary requests. Never expose stored keys. Preserve recording settings and /data persistence.

## Review Focus
Restart and missing/corrupt master key must not discard saved credentials.
Rejected keys and provider errors must never leak secrets.
Draft validation must not overwrite saved credentials.
Authentication and cross-origin restrictions apply to new routes.
Initial loading and pending operations must not erase user drafts or allow races.

### Task 1: Credentials, provider check and API
Files: src/integrations/deepgram.ts, src/server/app.ts, tests/deepgram.test.ts, tests/api.test.ts.
Interfaces: DeepgramSettings(root).metadata(): {configured:boolean}; save(apiKey:unknown); remove(); key():string. checkDeepgram(key:string, transport=fetch): Promise<{valid:boolean;message:string}>. createApp optional deepgramFetch for external transport.
- [x] Write tests for persistence/encryption/permissions, missing key/corruption, validation, check success/failure, draft versus saved selection, API auth and origin.
- [x] Run focused tests and confirm failure before implementation.
- [x] Implement encrypted store with atomic writes and fail-closed key handling, bounded server-only check and dedicated routes.
- [x] Run focused tests and typecheck.

### Task 2: Settings UI and documentation
Files: public/index.html, public/app.js, public/style.css, tests/browser-deepgram.cjs, README.md, README.ru.md.
- [x] Write browser coverage for save/check/delete, draft checks, masking, pending controls, reload and mobile.
- [x] Run and confirm missing UI fails.
- [x] Implement independent Deepgram form with accessible state feedback and load error handling.
- [x] Document encrypted storage/backup and check semantics in both READMEs.
- [x] Run full npm test, npm run build and browser tests; inspect desktop/mobile screenshots and final diff.

## Execution evidence

Implemented in the current checkout. Baseline: 96 tests passed. New storage/API tests failed before their implementation; browser test failed on missing Deepgram field before UI implementation. Final: npm test 102 passed; npm run build passed; browser-deepgram and browser-workspace passed using installed Chrome. Desktop and 390px mobile screenshots inspected. No real Deepgram requests or audio uploads.

Independent review found no blocking issue and one whitespace validation inconsistency; regression test confirmed it and API validation was fixed. A separate browser regression confirmed and fixed the saved-key verification status. Settings and secrets persist through the existing /data volume. No deployment or changes to the running container.
