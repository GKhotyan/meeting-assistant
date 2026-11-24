# Current schedule instructions for regeneration

The owner clarified that editing the prompt in Schedule must apply to subsequent generation or regeneration of existing recordings, including pim-daily. This supersedes the original recording-only prompt selection.

- Scheduled recordings persist a stable schedule ID at launch. Each generation resolves the latest schedule prompt, then snapshots it together with provider and transcript provenance for the duration of that job and its saved result.
- Existing recordings with a proven last-launch session ID in schedule history are linked durably during scheduler initialization. Never infer linkage from meeting names. Deleted schedules use the recording snapshot/default fallback rather than a different same-named schedule.
- Summary GET previews the instructions for the next generation, their origin and linked schedule name. Existing results retain their original instructions. Changing the schedule prompt marks the old summary as needing updating without changing its text. Blank schedule prompts select the default, rather than an older custom snapshot.
- Shared provider instructions defer to the user's structure, exclusions, attribution and length requirements. Source grounding still prohibits invented facts. Intermediate extraction/merging does not force names or extra sections into summaries that exclude them.
- The UI distinguishes current instructions from instructions used by a previous result and updates Schedule help and regeneration confirmation. No automatic paid regeneration is triggered by editing a prompt.

Verification: unit tests cover current-prompt selection, changes during an in-flight job, regeneration, stable identity/rename/delete fallback and legacy migration. HTTP integration verifies schedule edits change the next job's instructions while retaining old result provenance. Browser checks cover current instructions and the changed-instructions notice.
