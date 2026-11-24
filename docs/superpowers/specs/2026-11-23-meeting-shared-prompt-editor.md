# Shared instructions (prompt) editor on meeting pages

The owner requested explicit Instructions (prompt) labels and direct editing from a meeting page, with a warning that the prompt is shared by all meetings of the same type.

Linked recurring meetings expose Edit instructions (prompt) in Summary. A modal loads the current raw schedule prompt and identifies the recurring meeting in a warning: saving changes future summary generation for all recordings linked to that schedule, including existing recordings. Save shared prompt updates only summaryPrompt through the existing schedule API; no model is invoked. Existing results and running generation jobs keep their original snapshots. Unlinked recordings do not offer a shared editor.

The editor preserves draft text during polling and failed saves; Cancel/Escape discards without a request. Empty text uses default instructions; maximum length remains 8,000 characters. A version token isolates late responses after closing or navigation. Mutating requests disable save/cancel until completion. The server compares optional expectedSummaryPrompt before saving and returns 409 on concurrent prompt changes, preserving the newer saved value and the user's draft.

Verification: conflict/validation unit test RED→GREEN, 167/167 server tests, build, browser Summary editor flow and Schedule regression pass. Desktop/mobile dialog screenshots inspected; mobile overflow check passes. No real user prompts or summaries changed during tests.
