# Automatic Zoom sign-in recovery

The owner approved encrypted password persistence and one automatic sign-in followed by another meeting connection attempt when Zoom authentication expires.

Use the existing AES-GCM credential store. Save the submitted password only after verified login, preserve it when refreshing or expiring the same account, and remove it on disconnect. Legacy accounts require another manual login to supply a password.

Recovery runs in the worker with read access to the data root; passwords never travel in worker IPC or public metadata. All credential writes remain in the controller process: the worker sends the fresh session and expected account revision, and the controller checks and saves synchronously before acknowledging. This serializes recovery with Settings changes. Close failed meeting browsers before recovery. Recover typed authentication failures once, within the existing four-attempt limit. Already-expired accounts with saved credentials can recover before launching the meeting browser. Stop cancels recovery and prevents saving or joining afterward. CAPTCHA, verification codes, or rejected credentials require Settings; never loop password submissions. Concurrent disconnect or account replacement must prevent stale recovery from saving. If credentials are rejected or edited in the interactive browser, discard the original submitted password rather than save a known-wrong credential.

Approaches: controller-driven worker restarts complicate session ownership and cancellation; worker-side recovery reuses the existing retry lifecycle and is the selected implementation choice. No new dependency or account-wide renaming is needed. Product copy stays English.
