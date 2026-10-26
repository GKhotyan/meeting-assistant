# Third-party code

`vendor/vexa/` derives from Vexa-ai/vexa, revision f1a62fbbd, Apache License 2.0 (see LICENSE). Files copied from core/meetings/modules/join/src and core/meetings/modules/record-chunker/src. Zoom joining, admission, removal, leaving and MediaRecorder chunk handling are reused. Changes in this project: redact secrets in logging; disable VNC escalation in favour of visible status; local recording host and independent composition. Original copyright/license notices must remain. Dependency licenses remain with their packages.

Browser runtime additionally derives from core/meetings/modules/remote-browser/src/{browser,args}.ts and core/meetings/modules/join/src/browser-args.ts at the same revision. The S3/session-store dependency is removed; each local worker owns an ephemeral profile that is deleted after browser close.

## Modified upstream files

The following files differ from upstream revision `f1a62fbbdfd2c98cb162582d82c31fe8102acc89` and carry modification notices in their headers:

| Local file | Changes |
| --- | --- |
| `vendor/vexa/join/_host.ts` | Redact credentials from structured logs. |
| `vendor/vexa/join/shared/escalation.ts` | Disable VNC startup and report the need for manual admission help. |
| `vendor/vexa/record-chunker/index.ts` | Drain pending audio writes before finalization; reject a configurable finalization timeout. |
| `vendor/vexa/remote-browser/browser.ts` | Remove the upstream session-store dependency and require a caller-owned profile directory. |

Other TypeScript files under `vendor/vexa/` are unchanged from that upstream revision. The upstream paths correspond to `core/meetings/modules/<module>/src/`.

The upstream revision has no root or relevant module `NOTICE` file. Its unrelated `core/agent/workspace-seeds/finos/NOTICE` belongs to a component not included here. Existing notices in the copied source files are preserved.

The Docker image includes this document and `LICENSE` in `/app/`.
