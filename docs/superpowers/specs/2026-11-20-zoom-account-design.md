# Optional Zoom account connection

## Purpose and evidence

Allow Meeting Assistant to use one optional Zoom account for manual and scheduled
meetings, while keeping the requested bot name specific to each meeting.

On 2026-11-20, guest joins were explicitly blocked by Zoom and later succeeded.
An authenticated container browser also joined successfully. These observations
confirm that authenticated joining is possible, but do not establish that account
sign-in prevents all bot blocks. Authentication and meeting admission are separate
checks and must be reported separately.

## Approaches

- Browser-only sign-in: handles additional verification but requires manual entry.
- Credentials-only sign-in: convenient but cannot complete arbitrary verification.
- Credentials with interactive fallback: the user's selected direction. Attempt
  sign-in from Settings, then let the user continue in the same server browser.

## Settings behavior

Add an optional **Zoom account** section with **Email**, **Password**, and **Connect**.
Submitting starts a bounded sign-in attempt; typing never submits credentials.
Clear the password field after submission. Do not join a meeting to test sign-in.

Show **Not connected**, **Connecting**, **Action required**, **Connected**,
**Sign-in required**, or a specific recoverable error. Confirm success using an
authenticated Zoom account page, not cookies alone, a URL alone, or an enabled
meeting Join button.

If the password is rejected, show a useful error and allow correction. If Zoom
requests a code, CAPTCHA, SSO, or another manual step, offer **Continue in browser**.
Also make that action available after an unsuccessful automatic attempt. Preserve
the same pending browser session; never automate CAPTCHA solving. Bound pending
sessions and expose a cancel action.

Provide **Check connection**, **Reconnect**, and **Disconnect**. No account is
required for guest mode. Connecting an account enables its use for future manual
and scheduled meetings; changing it does not affect a recording in progress.

## Storage and execution

Proposed implementation decision: use the password only for the current sign-in
attempt; persist the account email and encrypted browser session, not the password.
Reuse the existing credential encryption mechanism and persistent DATA_DIR volume.
Session lifetime is controlled by Zoom. Restarting or replacing a container with
the same persistent data must preserve the saved session.

Create isolated browser profiles for recording workers and hydrate them from the
saved session. Do not share one live Chromium profile between login and recording.
Remove `--incognito` for authenticated launches. Check session validity before
joining; require reconnection when expired rather than silently switching to a
guest identity. Explicitly disconnected accounts use the existing guest flow.

Disconnect removes the stored session and closes pending login activity without
terminating an ongoing meeting. Never return passwords, cookies, or session tokens
through settings metadata, logs, recording metadata, or diagnostics.

## Interactive fallback on a virtual machine

Render the server browser inside the application's web interface with keyboard
and pointer control. The browser runs in Docker; the user's ordinary browser only
provides the interface. Use a dedicated login display, separate from recordings.
Protect all control and display traffic with application authentication and
same-origin checks; do not expose an unauthenticated VNC or debugging port.
Ship the required runtime dependencies in the Docker image.

## Meeting identity and errors

Try setting the meeting's configured bot name in pre-join, including authenticated
mode. If necessary, attempt Zoom's in-meeting Rename flow and verify the result.
If Zoom or the host prevents changing the name, report that the account name is
being used; do not repeatedly rename the account's global profile.

An explicit bot prohibition ends retries and displays Zoom's actual reason.
Do not describe every such prohibition as a confirmed RTMS requirement.

## Verification and scope

Cover encrypted session persistence, expired sessions, disconnect, login challenge
states, protected browser control, worker isolation, guest mode, and per-meeting
names. Check the English Settings interface and interactive fallback in a browser.
Verify sign-in, actual meeting admission, and the requested name separately; a
meeting shell or loading spinner is insufficient proof of admission. Verify session
reuse after a container restart. Real Zoom tests require an available account and
meeting and must report any unverified host restrictions.

Update the single English README with connection, reconnection, persistent storage,
and limitations. Do not introduce RTMS, multiple accounts, or silent sign-in with
a stored password as part of this change.
