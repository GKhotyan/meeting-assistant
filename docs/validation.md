# Validation — 2026-10-26

## Expected

Build a standalone Linux Docker image without Vexa source/images/services; expose browser controls; preserve a separate silent video and audio including late audio after initial silence.

## Observed

- `npm test`: 17 passing tests (API, controller, real FFmpeg audio/video, secret redaction).
- `npm run test:vendor`: copied Zoom URL and admission tests pass (typed denial/timeout and RTMS wall).
- `npm run build`: TypeScript and browser bundle build successfully.
- `docker build -t engineering-assistant:local .`: independent image built from `mcr.microsoft.com/playwright:v1.56.0-noble`, Linux arm64 on Apple Silicon. No Vexa image or parent build context.
- Docker health endpoint returns `{"status":"ok"}`.
- Real Chromium synthetic audio test: starts with silence, adds oscillator-backed media audio later, stops, remuxes, verifies one audio stream, duration 2.523 seconds and non-zero PCM energy (660085059 summed absolute samples). Earlier test exposed initial AudioContext startup delay; code now waits for clock readiness before recording.
- Native Chrome UI: fields, disabled idle stop button, available server indicator, invalid non-Zoom link shown as an error without launching worker. Page visually inspected.
- Earlier Zoom full-screen spike in Vexa Lite showed demonstrated content in 1920×1080 H.264; that is NOT evidence of a live standalone join.

## Not yet observed

Live Zoom join/capture/stop of this standalone application; host ending the meeting; silence → real participant audio; change of screen sharing during a standalone session; long recording/disk exhaustion; Linux amd64 VPS, network-loss reconnection (not implemented). A new meeting was requested from the user. Keep these rows pending until witnessed.

Test audio/video fixtures generated from sine/testsrc, not private meeting media. Existing meeting clips in docs/research/artifacts must not be committed or published.

## Standalone live attempt and final review

Session 338202e9-7ab5-4af1-8f42-e9ca7fd5d60b, 2026-10-26 06:32 UTC: the independent container entered the Zoom prejoin, typed Engineering Assistant and clicked Join. Admission poll observed exact text `automated bots aren't allowed` and raised typed `zoom_requires_rtms` denial. Application marked the session failed, attempted leave/navigation and closed the browser. Process inventory afterward showed no worker, Chromium or FFmpeg. No meeting audio/video was captured in this attempt; do not claim live recording success.

Official Zoom documentation says built-in Web App bot protection cannot be disabled: https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0088381 . RTMS/Meeting SDK are different integration paths and require a new scoped decision, not an automatic switch in this task. The earlier successful Vexa probe does not establish reliability for the standalone browser route.

Independent review identified async final-chunk drain and unexpected browser-close handling defects. Added regression tests, observed RED, fixed, tests GREEN. A follow-up timeout regression verified stalled writes now reject stop rather than silently finalize. Total: 17 new tests, 15 inherited Zoom checks; build/typecheck pass. Final image synthetic audio: 2.522 seconds, PCM energy 651960716. UI validation was performed in native Chrome. Browser probe fixtures use a synthetic oscillator, not meeting audio.

## Updated A/B diagnosis and successful standalone witness

On the same meeting 2026-10-26: original Vexa admitted and explicitly left; source browser args alone in standalone denied; full original browser runtime control admitted. Normal worker with prejoin audio setup still denied. Removing prejoin audio setup allowed that same normal worker/name/profile path to enter. Final implementation reuses the browser runtime and starts capture from existing DOM media streams after admission. Earlier conclusion that this meeting necessarily requires an RTMS rewrite was premature.

Live session 35767f64-5aba-4eda-adbe-c2249f7e0024: admitted 07:10:27 UTC, recording, stopped 07:14:09 UTC, confirmed Leave Meeting at 07:14:12 UTC, completed 07:14:15 UTC. User reported speaking. audio.webm: Opus, 219.169 s, 3528703 bytes, max -8.1 dBFS/mean -39.4 dBFS. screen.mp4: H264 video only, 1920×1080, 221.266667 s, 1238934 bytes. Both ffmpeg full decodes exit 0 with no errors. SHA256 for both API downloads matches disk. Speech content itself was not transcribed or sent to a provider.

Screen-share content was visually verified in a frame at 30 s. That recording still had a partially sized browser window. Subsequent isolated Xvfb/Fluxbox browser test exercised Browser.setWindowBounds and confirmed innerWidth=1920, innerHeight=975 (browser decorations occupy remaining display height); final full-screen live run pending image rebuild. Source final suite 18 passed; independent review found no Important introduced issues, typecheck pass.

NOT checked: VPS, long-term resilience, all Zoom tenants, calendar, Deepgram, automatic network reconnection. Private meeting files remain under data/ and are excluded from Git/Docker build context.
