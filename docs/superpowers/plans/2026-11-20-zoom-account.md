# Zoom Account Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optional Zoom email/password sign-in with verified session persistence,
interactive fallback in the user's web browser, and per-meeting participant names.

**Architecture:** A server-owned Zoom connection service drives an isolated login
browser and exports a validated, encrypted session. Recording workers hydrate
their own temporary profiles. Interactive fallback uses authenticated same-origin
HTTP screenshots and pointer/keyboard actions, rather than exposing VNC or CDP.

**Tech Stack:** Existing TypeScript, Node.js, Playwright, Chromium, Docker/Xvfb,
and plain JavaScript/CSS; no external browser-control service.

**Spec:** `docs/superpowers/specs/2026-11-20-zoom-account-design.md`

## Global Constraints

- Branch `feat/zoom-account` starts at `origin/main`; exclude the separate AI branch.
- Application interface and the single README remain English.
- One optional account; no stored password, RTMS, or silent guest fallback on expiry.
- Saved sessions belong to persistent DATA_DIR; passwords and cookies never appear
  in API metadata, logs, diagnostics, or recording metadata.
- Connection checks must not join a meeting. Meeting admission and authentication
  are separate outcomes. Do not silently change the global Zoom account name.

## Review Focus

- Existing Deepgram encrypted data must survive the new session storage.
- A cancelled/replaced login must never overwrite a newer connected account.
- A saved cookie jar or a loading meeting shell must not count as success.
- Cross-site browser-control requests must fail before generating input or images.
- Disconnect or reconnect during a recording must not terminate or alter that worker.

---

### Task 1: Encrypted optional account session

**Files:** Create `src/integrations/credential-store.ts`,
`src/integrations/zoom-settings.ts`, `tests/zoom-settings.test.ts`;
modify `src/integrations/deepgram.ts`, `tests/deepgram.test.ts`.

**Interfaces:** `CredentialStore(root).read(): Record<string, unknown>` and
`write(value): void` preserve existing AES-256-GCM format.
`ZoomSettings(root)` exposes `metadata()`, `session()`,
`save(email, storageState)`, `markExpired()`, and `disconnect()`.
Metadata contains connection status/email only; session returns validated
Playwright storage state exclusively to server/worker code.

- [ ] Write tests for encryption, reconstructed stores after restart, disconnected
  guest mode, malformed states, symlinks, missing keys, expiration, and preservation
  of Deepgram keys when saving/removing Zoom state.
- [ ] Run `node --import tsx --test tests/zoom-settings.test.ts tests/deepgram.test.ts`;
  confirm new tests fail before implementation.
- [ ] Extract existing encryption without changing its file format; add Zoom state
  validation and atomic read/merge/write storage. Persist no password.
- [ ] Rerun both suites and commit this independently testable storage change.

### Task 2: Verified login and bounded interactive fallback

**Files:** Create `src/zoom/connection.ts`, `src/zoom/login-browser.ts`,
`src/zoom/authentication.ts`, `tests/zoom-connection.test.ts`,
`tests/zoom-authentication.test.ts`; modify `src/server/main.ts` for shutdown.

**Interfaces:** `ZoomConnection(root, browserFactory?)` exposes `metadata()`,
`connect({email,password})`, `check()`, `cancel()`, `disconnect()`, `close()`,
`frame(): Promise<Buffer>`, and `input(action): Promise<void>`.
Connection operations return status immediately; the service owns background work.
Status: `not_connected | connecting | action_required | connected | sign_in_required | error`.
`verifyZoomAuthentication(page)` confirms an authenticated Zoom account view with
signed-in controls and rejects sign-in forms, intermediate redirects, and challenges.

- [ ] Write fake-browser tests for valid credentials, wrong password, code/CAPTCHA,
  timeout, expiry, cancellation, stale completion, and browser crash/cleanup.
- [ ] Run the new suites to establish failing behavior.
- [ ] Implement a dedicated login browser/display, 15-minute maximum pending login,
  bounded automatic attempts, and verified storage-state export. Remove incognito
  in login mode; never log credentials or retain password in connection state.
- [ ] Add screenshots and validated click/key/text/scroll input for the active login
  page, including page/popup changes. Serialize actions, cap text/frame sizes, and
  reject coordinates outside the viewport or input without an active pending login.
- [ ] Check connection in a separate temporary browser so checks cannot replace an
  interactive login. Persist refreshed verified state; clean all temporary profiles.
- [ ] Run tests and commit connection service and lifecycle handling.

### Task 3: Authenticated API and Settings interface

**Files:** Modify `src/server/app.ts`, `public/index.html`, `public/style.css`;
create `public/zoom-settings.js`, `tests/zoom-api.test.ts`,
`tests/browser-zoom-settings.cjs`.

**Interfaces:** `GET /api/settings/zoom` exposes metadata;
`POST /api/settings/zoom/connect`, `/check`, `/cancel`;
`DELETE /api/settings/zoom`; `GET /api/settings/zoom/browser/frame` returns an image;
`POST /api/settings/zoom/browser/input` accepts the service's validated actions.
Inject a test ZoomConnection via createApp options; production uses its own service.

- [ ] Write API tests for authentication, allowed/rejected origins, unsupported
  methods, limits, no secret disclosure, cancellation and image access. Reject
  cross-site frame access including Fetch Metadata; do not publish browser ports.
- [ ] Run API tests and confirm missing functionality fails.
- [ ] Add routes after existing auth/origin guards and a dedicated English Zoom
  settings form. Clear password after Connect, poll metadata without overlapping
  requests, and show correction/reconnect/disconnect actions for distinct states.
- [ ] Implement an accessible remote browser dialog with keyboard, pointer and
  scroll forwarding and a text-paste control. Scale image coordinates correctly.
  Stop frame polling when hidden/cancelled; never use session tokens in URLs.
- [ ] Add browser smoke checks for successful/failed/challenged connection,
  keyboard operation, responsive dialog, cancellation, and secret-free metadata.
- [ ] Run API and browser checks; commit Settings and remote login interface.

### Task 4: Recording session and meeting identity

**Files:** Modify `src/worker/browser.ts`, `src/worker/main.ts`,
`src/worker/connect.ts`, `src/session/controller.ts`,
`vendor/vexa/join/zoom/join.ts`, `vendor/vexa/join/zoom/admission.ts`;
create `src/zoom/meeting-name.ts`, `tests/zoom-meeting-name.test.ts`;
modify `tests/profiles.test.ts`, `tests/worker-connection.test.ts`,
`tests/connect.test.ts`, `tests/zoom-admission.test.ts`.

**Interfaces:** Snapshot the selected session server-side when a worker starts;
never include it in public Session records. Extend worker start IPC privately with
optional authentication state. `launchZoomBrowser(session?)` seeds an isolated
profile; `applyMeetingName(page, name)` returns `applied | restricted | unavailable`.

- [ ] Write failing tests for guest behavior, session seeding, incognito removal,
  stale session rejection, worker snapshot isolation, reconnect/disconnect during
  a recording, explicit prohibition without retries, and name restrictions.
- [ ] Implement session snapshot delivery and authenticated browser setup. Verify
  auth before meeting navigation; report Sign-in required instead of joining as
  a guest when a configured session is invalid.
- [ ] Fill requested per-meeting name in authenticated pre-join when available;
  verify the actual participant name and try in-meeting Rename only if necessary.
  Report host restrictions without changing the account profile or failing capture.
- [ ] Require an actual meeting Leave control for admission, excluding loading and
  waiting-room states. Preserve existing stop and cleanup behavior.
- [ ] Stop retries on explicit bot prohibitions and replace unsupported assertions
  that every bot prohibition requires RTMS with precise platform wording.
- [ ] Run affected worker/admission/name suites and commit integration changes.

### Task 5: Container persistence, documentation and whole-branch verification

**Files:** Modify `Dockerfile`, `README.md`, and runtime login display code as
needed; add `tests/browser-zoom-container.cjs` and update the spec with outcomes.

- [ ] Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:vendor`.
- [ ] Build a separate diagnostic image, without replacing the user's running
  container. Test its health and Settings/interactive browser on a separate port
  and temporary data volume. Confirm no VNC/CDP port is exposed.
- [ ] Verify verified session reuse after container restart, expired-session
  behavior and isolated recording workers, using a fixture for repeatable checks.
- [ ] Run real Zoom sign-in, manual fallback and meeting name tests only with the
  user's available account/meeting. Report unverified MFA/host restrictions plainly.
- [ ] Visually inspect Settings and remote browser UI at desktop and narrow widths.
  Update README with optional credentials, session-only persistence, login on a VM,
  reconnect, name restrictions, and the absence of guaranteed anti-bot admission.
- [ ] Review the final diff and tests against the approved spec, commit, and report
  branch name, checks, runtime changes, and any outstanding external verification.
  Do not merge, push, publish, or replace the running service as part of this plan.
