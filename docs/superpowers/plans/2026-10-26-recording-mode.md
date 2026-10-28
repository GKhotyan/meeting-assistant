# Recording mode Implementation Plan

**Goal:** Choose full video or screenshots every 5 seconds on the home screen; always record audio.
**Architecture:** Persist recordingMode in settings and snapshot it per session. Worker uses a sequential JPEG capture loop instead of the MP4 recorder for screenshots. Download screenshots through existing authenticated file API.
**Tech Stack:** TypeScript, Node, Playwright, existing HTML UI.
**Spec:** User approved video/screenshots choice, remembered settings, 5 second interval, audio in both modes.

## Tasks
- [x] Add failing controller tests for defaults, persistence, validation, and worker mode propagation.
- [x] Add failing screenshot tests for immediate capture, interval, stop and failure handling.
- [x] Implement typed mode and backward compatible settings; keep session mode fixed when settings change.
- [x] Implement serialized JPEG captures with timestamps, register completed images, drain capture on stop.
- [x] Wire worker mode selection, UI choice, authenticated JPEG downloads and documentation.
- [x] Run full tests and build; inspect UI source and JavaScript syntax (browser tool unavailable).

## Review Focus
Old settings default to video; invalid modes are rejected; stop drains pending capture; screenshot errors propagate; audio always starts regardless of visual mode.

## Verification
24/24 tests passed; npm run build passed; public/app.js syntax passed. Local Docker image rebuilt and app recreated with no active sessions. Live Zoom session 49e206b8-29c6-4014-b6fe-3a1c1dda9f6b completed with five JPEGs and a 20.312-second WebM audio track; no MP4 created. Inspected screenshot showing shared screen. Browser UI visual verification unavailable because neither iab nor chrome is connected.
