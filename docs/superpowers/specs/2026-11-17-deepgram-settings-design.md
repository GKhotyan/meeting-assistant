# Deepgram settings

Approved scope: add Deepgram credentials to the existing Settings page, matching meeting-analyzer: password field with show/hide, save, check and remove. Checking a draft does not save it; checking an empty field uses the saved key. Saved and verified are distinct states. No audio submission, transcription or summary in this change.

Approaches: use existing plaintext recording settings (rejected: credentials need encryption); port Python/Fernet (rejected: introduces another runtime); use Node crypto (selected: fits the existing TypeScript server without dependencies).

Store AES-256-GCM ciphertext in DATA_DIR/settings/api-keys.json and its random master key in DATA_DIR/secrets/master.key, private directories 0700/files 0600. Existing /data volume persists both. Never recreate a missing master key when ciphertext exists. Never return secrets or provider response bodies to clients/logs. API exposes configured state only. Existing recording settings remain independent.

GET/PUT/DELETE /api/settings/deepgram and POST /api/settings/deepgram/check use existing authentication/origin protections. Validate printable ASCII keys up to 512 characters. Check GET https://api.deepgram.com/v1/auth/token with Token authorization, no redirects and a 10-second timeout; validate response subject/accessor. Errors are sanitized. Verification only authenticates the key, not transcription permissions or balance.

UI uses existing English styling, disables controls while requests run, clears saved drafts and resets masking, preserves draft text during initial metadata load and resets verification on edits. Tests use fake provider transport; no real key or recording is transmitted.
