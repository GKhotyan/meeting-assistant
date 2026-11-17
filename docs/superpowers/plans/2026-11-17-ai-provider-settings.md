# AI provider settings

Scope: add English settings for OpenAI and z.ai on `feat/llm-provider-settings`. No inference, summaries, automatic uploads, or changes to Deepgram transcription.

1. Add storage and transport tests: independent encrypted provider keys, backwards-compatible Deepgram credentials, persistent active provider/model/effort, input validation, sanitized and bounded model-list checks.
2. Extend existing encrypted credentials without replacing Deepgram data. Store validated AI preferences in the same atomically replaced encrypted document and use fixed provider endpoints. Keep secrets server-side.
3. Add authenticated and origin-protected settings/check/remove routes, tested via HTTP with injected provider transport.
4. Add a provider selector, per-provider model and effort preferences, masked keys, save/check/remove actions, and race-safe loading. Cover switching, persistence, no key disclosure, and responsive layout in a browser test.
5. Document configuration and its current settings-only scope. Run full tests, build, browser scenarios, inspect diff, commit on feature branch. Do not merge into main.

Design choices: keep both provider configurations, default to z.ai/GLM-4.7 to match Analyzer; use editable model IDs rather than claiming a static catalogue is exhaustive. Empty model settings cannot be saved. Effort defaults to provider/model default; optional choices are preferences for future generation and do not establish model capability. Connection checks GET fixed models endpoints and send no meeting content.

Validation: 118 application tests pass; TypeScript and browser bundle build pass. Browser coverage includes provider switching, drafts, independent keys, save/check/remove, failed save, failed initial load/retry, reload, pending controls, mobile layout, plus existing Deepgram/transcription/workspace/recording-file regressions. Independent code review found no blocking issue. Provider requests were mocked; no live API keys or paid generation requests were used. A damaged-configuration removal regression was reproduced and fixed before completion.
