# Meeting summary generation

Approved by the owner: manual generation from a saved transcript, OpenAI/z.ai, full-transcript context handling, durable results, Summary tab with copy/download/regeneration, errors and restart recovery, automated verification and English documentation.

## Approaches

Rejecting oversized transcripts is simpler but excludes long meetings. Silently truncating (as parts of Raven currently do) loses the end of the meeting. Selected approach: direct generation when the transcript fits, otherwise sequential chunk notes and recursive merging, without dropping input. Summaries remain lossy; disclose multi-step generation and its extra requests.

## Behavior and constraints

- Explicit Generate summary/Generate again only; no provider requests on navigation or after transcription. Confirm replacing an existing result before resubmitting paid work.
- Use the session's prompt snapshot or the default for legacy recordings. Snapshot provider/model/effort, prompt, transcript hash and timestamp at launch; never read changing settings mid-job.
- Require a completed recording and completed nonempty transcript. Only one summary job across the application. Block deletion and retranscription of that meeting while generating. Old results survive failed retries, reloads and restart.
- Store atomic `summary.json` beside `transcription.json`. Persist status idle/processing/completed/failed/interrupted, progress, result and metadata. Recover abandoned processing as interrupted without automatic paid retries. Compare transcript fingerprints to mark results stale after retranscription.
- Context calculation includes system instructions, message framing, output/reasoning allowance and a safety margin. Known model limits are explicit; unknown models use a conservative fallback, disclosed in metadata. Use conservative UTF-8 byte token bounds rather than assuming English characters per token. Split at paragraph/line/word boundaries, preserve all text and Unicode. Chunk and merge requests carry the original instructions and grounding rules. Bound input bytes, total requests and response size; fail explicitly instead of truncating or looping.
- Use fixed HTTPS Chat Completions endpoints with native fetch, no redirects/automatic retries, per-request timeout, response size cap, sanitized errors. Reject empty/refused/length-limited replies. Reasoning effort is model-specific; reject unsupported non-default combinations before paid requests.
- Accessible Summary tab, keyboard navigation and hash links; polling preserves focus and player state, navigation ignores late replies. Render untrusted output with textContent; downloadable Markdown and clipboard copy preserve authored text. Display model/date, previous-result and stale-result notices, progress, provider transfer notice and missing-settings link.
- Interface and the single README are English; meeting content stays in its original language. No deployment, publishing or real meeting upload required for implementation verification.

## Builder choices

Reuse the existing vanilla JS meeting view, AISettings and transcription service patterns. Separate model/context policy, provider transport and durable summary lifecycle. Unit/provider fixtures plus API and Playwright coverage verify boundaries without sending user data. Model references live alongside the model policy; defaults are conservative rather than inferred from unknown IDs.
