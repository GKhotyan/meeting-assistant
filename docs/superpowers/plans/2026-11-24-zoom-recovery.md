# Zoom recovery implementation plan

**Goal:** Recover an expired Zoom login once using an encrypted saved password.

**Spec:** `docs/superpowers/specs/2026-11-24-zoom-recovery-design.md`

## Tasks

- [x] Add failing storage, verified-login persistence, recovery and retry lifecycle tests.
- [x] Extend ZoomSettings with saved credentials, connection state and stale-result guards; keep public metadata free of secrets.
- [x] Add cancellable one-shot worker recovery using the existing LoginDriver, with safe fixed errors and browser cleanup.
- [x] Wire recovery into connection retries and handle already-expired accounts. Preserve existing session lifecycle and other pending workspace changes.
- [x] Update Settings and README storage/retry descriptions; run targeted tests, typecheck, full suite and build, then review the diff.

## Review focus

Legacy accounts, cancellation during sign-in, account replacement/disconnect during recovery, repeated authentication failure, and credential leakage in errors must have regression coverage.

## Verification and review

Full suite: 186/186 passed. Typecheck, production build, Docker image build and Zoom Settings browser smoke in Chrome passed. An independent reviewer found two issues; regression tests first reproduced them, then passed after fixes: controller-owned persistence serializes account revision checks and writes with Settings; interactive credential correction discards the original password. No real Zoom credentials were submitted and no real meeting was joined during testing.
