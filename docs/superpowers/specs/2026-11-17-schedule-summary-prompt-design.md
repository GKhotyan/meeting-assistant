# Scheduled meeting summary instructions

Approved UI: a collapsed Summary instructions section after Recording mode, an optional multiline Summary prompt, Insert example with replacement confirmation, and Expand editor with an accessible modal. Empty prompts mean Default instructions; nonempty prompts mean Custom instructions. One Save meeting persists the entire form; Cancel discards edits. Show a compact instruction status on each schedule card, not the prompt itself. Display the saved AI provider/model with a Manage AI settings link.

Scope: store and edit instructions, without summary generation or provider requests. Preserve user text in its original language. Copy the resolved default/custom prompt and its source into session.json at recording launch; later edits only affect future recordings. Older schedules default to empty/custom-absent; do not invent prompt snapshots for older recordings.

Choices: 8,000 UTF-16 character limit, matching HTML maxlength, with an explicit counter and server validation. Allow schedule JSON bodies up to 64 KiB to accommodate Unicode. The expanded editor has its own draft: Use instructions applies it to the form; Cancel/Escape keeps the form unchanged. Missing AI configuration does not prevent scheduling. No separate prompt library or per-meeting model override.

Alternatives considered: an always-visible textarea lengthens every schedule form; a modal-only editor hides basic editing. The approved collapsible section plus optional expanded editor provides both quick access and comfortable long-form editing.
