# Meeting Assistant

**Your Zoom recordings, on your own disk.**

A self-hosted Zoom recorder with a simple web interface. Join a meeting as a guest, capture audio separately, and choose between full-screen video or timestamped screenshots. Run it locally with Docker or on your own Linux server.

[Русский](README.ru.md) · [Validation notes](docs/validation.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

![Meeting Assistant web interface](docs/images/interface.png)

## Features

- **Separate audio and visuals** — Opus audio in WebM, plus H.264 video in MP4 or JPEG screenshots every five seconds.
- **Screenshots linked to audio** — capture timestamps and audio offsets in JSON sidecars; screenshots crop to the visible shared-screen area when detected.
- **Persistent recordings** — files live on your host, survive container recreation, and can be downloaded from the interface.
- **Background sessions** — close the browser tab while recording continues; stop a session to finalize files and leave Zoom.
- **No service account or API key required** — no Vexa account, transcription provider, or calendar integration needed.

The default participant name is **Engineering Assistant**. You can change it in the interface independently of the application name.

## Quick start

Install and start Docker Desktop (macOS), or Docker Engine with Compose (Linux), then run from the project directory:

```sh
docker compose up --build -d
```

Open **http://localhost:8088**, enter a Zoom meeting link, choose a recording mode, and start recording. Admit **Engineering Assistant** from the waiting room if needed. The host machine must remain awake and Docker must keep running.

To stop the application gracefully:

```sh
docker compose stop
```

Recordings stay in `./data/recordings/`. The Compose project and local image retain the internal name `engineering-assistant` to preserve compatibility with existing installations.

## Recording modes

| Mode | Audio | Visuals |
| --- | --- | --- |
| Video | Separate `audio.webm` | `screen.mp4`, 1920 × 1080 at 15 fps, without audio |
| Screenshots | Separate `audio.webm` | JPEG every 5 seconds, with timing metadata |

A detected screen share is cropped for screenshots; otherwise, the full meeting screen is captured. Overlays and thumbnails inside that region remain visible. Video captures the whole virtual Zoom screen.

Each session has its own directory:

```text
data/recordings/<session-id>/
  session.json      # Session state and timing metadata
  audio.webm        # Finalized Opus audio
  audio-parts/      # Recovery chunks retained after finalization
  worker.log        # Connection and recording diagnostics
```

Depending on the selected mode, it also contains video or screenshots with `.jpg.json` sidecars. Sidecars include `capturedAtMs`, `captureCompletedAtMs`, `audioStartedAtMs`, and `audioOffsetMs`. Timing uses recording clocks and a capture window; it is not sample-accurate synchronization. Files marked `.partial` are unfinished output.

## How it works

```mermaid
flowchart LR
    UI[Web interface] --> API[Node.js HTTP API]
    API --> Controller[Session controller]
    Controller --> Worker[Isolated browser worker]
    Worker --> Zoom[Zoom web client]
    Zoom --> Audio[Audio capture]
    Zoom --> Visuals[Video or screenshots]
    Audio --> Disk[Host recording directory]
    Visuals --> Disk
```

Built with **TypeScript**, **Playwright / Chromium**, **FFmpeg**, and **Docker Compose**. Browser joining and audio chunking reuse code from [Vexa](https://github.com/Vexa-ai/vexa); this project supplies its own session management, local storage, capture pipeline, and web interface. See [third-party notices](THIRD_PARTY_NOTICES.md) for provenance and modifications.

## Run on a server

Copy the example configuration and edit it:

```sh
cp .env.example .env
```

Set `ACCESS_MODE=server` and a strong `APP_PASSWORD`, then start with Docker Compose. Basic Auth uses the username `assistant`. The default bind address is `127.0.0.1`; use an SSH tunnel or an HTTPS reverse proxy for remote access. Basic Auth requires HTTPS when sent across a network.

```sh
ssh -L 8088:127.0.0.1:8088 your-server
```

Open http://localhost:8088 on your computer. Recordings reside on the server; download them through the interface or copy them over SSH.

## Current scope

- One meeting at a time; standard Zoom `/j/<id>` and `/wc/...` links.
- The bot joins with its camera and microphone disabled. Guest-access restrictions, SSO, and CAPTCHA may prevent joining.
- No automatic reconnection, transcription, summaries, or calendar integration.
- No storage quota or automatic retention policy. Recovery chunks consume extra disk space.
- Interrupted sessions are marked as interrupted after restart; existing files remain available on disk.
- A real Zoom recording was validated on Apple Silicon on 2026-10-26. Linux VPS / amd64 validation remains pending. See [validation notes](docs/validation.md) for evidence and limitations.

## Development

Use **Node.js 22+** and install **FFmpeg / ffprobe**:

```sh
npm ci
npm test
npm run test:vendor
npm run build
```

| Directory | Purpose |
| --- | --- |
| `src/session` | Session state and worker lifecycle |
| `src/worker` | Browser automation and media capture |
| `src/recordings` | File writing and finalization |
| `src/server`, `public` | HTTP API and web interface |
| `vendor/vexa` | Attributed upstream browser and chunking modules |
| `tests` | Application tests |

## License

[Apache License 2.0](LICENSE). Upstream attribution and modifications are documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
