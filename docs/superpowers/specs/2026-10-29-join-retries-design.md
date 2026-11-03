# Connection retries and attempt history

## Intent

Recover from intermittent Zoom browser admission failures within a single meeting session, and make every connection attempt visible to the user.

## Behavior

- Four attempts at most: first immediately; second and third 10 seconds after the preceding failure; fourth 60 seconds after the third failure.
- Retry network/browser connection failures and the observed `zoom_requires_rtms` bot block. Do not retry explicit host rejection, ended meetings, invalid passwords, or authentication requirements. Waiting for host admission remains part of the current attempt.
- Each attempt owns a fresh browser. Close the preceding browser before another attempt starts. Never retry after recording has started.
- Stop cancels an active connection and any pending retry. Keep the existing single-session concurrency restriction throughout retry delays.
- Persist attempt number, start/end timestamps, outcome, and redacted error text in the same session. Persist the next retry time while waiting; after application restart mark the session interrupted rather than rejoin automatically.
- After four retryable failures, finish the session as failed. A successful later attempt clears the session's current error but preserves failed attempts in its history.

## Interface

- Show a compact clickable `Attempts: N/4` block on each new meeting session card, including while connecting.
- Any failed attempt makes the block red, including after eventual success.
- Expand the block to show each attempt's time, outcome, and full redacted error as text. Preserve expansion across automatic list refreshes.
- During delays show a countdown until the next attempt; after success report which attempt connected.
- Keep the existing English interface language. Historical sessions without attempt metadata remain supported without invented history.

## Approaches

1. Retry only within the existing browser: less cleanup, but carries failed admission state into later attempts.
2. Retry connection with a fresh browser inside the session worker (recommended): keeps one session and one recording lifecycle, and closely reproduces the successful manual retry. Controller persists attempt events; worker owns cancellation and browser cleanup.
3. Restart the entire session for each failure: reuses existing start behavior but creates duplicate meeting entries and complicates stop/concurrency handling.

The recommended implementation is option 2. Timing, attempt count, and history behavior follow the discussion; browser ownership and persistence details are implementation proposals.

## Validation

Verify retry count and delays with controlled timers; successful recovery; nonretryable outcomes; stopping during a delay or admission; browser cleanup; no reconnect after recording starts; persistence/redaction; and UI history expansion, red highlighting, countdown, and old-session compatibility.
