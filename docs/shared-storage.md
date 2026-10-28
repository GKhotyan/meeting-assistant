# Shared storage for Meeting Assistant and Meeting Analyzer

HuntFlow Reports sets `DATABASE_PATH=/opt/demo-stands/data/private/cache.db` in its Dockerfile. Its repository does not contain the VM's Docker volume configuration, so that path documents the location inside its container, not a verified host mount. For the meeting services, explicitly bind the same host directory into both containers.

Meeting Assistant accepts two host paths through Compose:

| Variable | Default | Container path | Contents |
| --- | --- | --- | --- |
| `ASSISTANT_DATA_DIR` | `./data` | `/data` | `settings.json`, `schedules.json`, assistant state |
| `RECORDINGS_DIR` | `./data/recordings` | `/data/recordings` | Meeting folders, audio, video, screenshots and session metadata |

Meeting Analyzer already accepts `RECORDINGS_DIR` and mounts it at `/recordings`. The paths **inside** the two containers differ; the host source must be identical. Use an absolute host path so each repository resolves it identically. The application variable `DATA_DIR=/data` remains the path inside the assistant container; do not set it to a host path.

## VM example

These are example host paths under the same base directory as HuntFlow Reports. Create them as the deployment user with permission to write there; neither service moves existing recordings automatically.

From the Meeting Assistant repository:

```sh
export ASSISTANT_DATA_DIR=/opt/demo-stands/data/private/meeting-assistant
export RECORDINGS_DIR=/opt/demo-stands/data/private/meeting-recordings
mkdir -p "$ASSISTANT_DATA_DIR" "$RECORDINGS_DIR"
docker compose up -d --build app
```

Or set both variables in the assistant's `.env`, alongside its access settings, and run the same Compose command. Keep `settings.json` and `schedules.json` in `ASSISTANT_DATA_DIR`; point `RECORDINGS_DIR` directly at the directory containing `PIM_Daily_<UUID>` / `Meeting_<UUID>` folders, not its parent.

From the Meeting Analyzer repository, supply the **same** recordings path:

```sh
RECORDINGS_DIR=/opt/demo-stands/data/private/meeting-recordings \
OCR_UID=0 OCR_GID=0 bash start.sh
```

The current assistant image runs as UID/GID `0:0` and writes private JSON files with mode `0600`. The analyzer UID/GID above matches that owner on Linux so it can read the metadata and, when requested, delete files. If deploying differently built images with a different recording owner, use that owner's numeric UID/GID instead. Analyzer output, settings and secrets use its existing separate mounts and must be writable by that user.

Only one assistant instance should write to this state directory and execute its schedules. Analyzer processes completed recordings from the shared directory.

## Without Compose

Pass the two host paths as bind mounts when starting the assistant image:

```sh
docker run -d --name meeting-assistant \
  --restart unless-stopped --shm-size=1g --stop-timeout=60 \
  -p 127.0.0.1:8088:8088 \
  --mount type=bind,src=/opt/demo-stands/data/private/meeting-assistant,dst=/data \
  --mount type=bind,src=/opt/demo-stands/data/private/meeting-recordings,dst=/data/recordings \
  engineering-assistant:local
```

Create the source directories first. Supply the existing server access variables when exposing the application beyond localhost, as described in the main README.

## Existing installations

The default mounts still point to this project's existing `./data` and `./data/recordings`, so local recordings and schedules stay in place. To use another location, stop recordings first and copy the existing meeting directories to the new `RECORDINGS_DIR`; copy private state separately only if changing `ASSISTANT_DATA_DIR`. Preserve file ownership. Verify the copied files before switching the containers. Changing an environment variable alone does not migrate data.
