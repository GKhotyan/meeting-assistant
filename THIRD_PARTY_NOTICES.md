# Third-party code

`vendor/vexa/` derives from Vexa-ai/vexa, revision f1a62fbbd, Apache License 2.0 (see LICENSE). Files copied from core/meetings/modules/join/src and core/meetings/modules/record-chunker/src. Zoom joining, admission, removal, leaving and MediaRecorder chunk handling are reused. Changes in this project: redact secrets in logging; disable VNC escalation in favour of visible status; local recording host and independent composition. Original copyright/license notices must remain. Dependency licenses remain with their packages.

Browser runtime additionally derives from core/meetings/modules/remote-browser/src/{browser,args}.ts and core/meetings/modules/join/src/browser-args.ts at the same revision. The S3/session-store dependency is removed; each local worker owns an ephemeral profile that is deleted after browser close.
