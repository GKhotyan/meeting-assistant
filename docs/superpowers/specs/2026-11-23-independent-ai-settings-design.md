# Independent AI provider settings

The owner requested separate OpenAI and z.ai configuration, with both providers populated at once and an independent switch between them.

Use two visible cards, each with API key, model, reasoning preference, save/check/remove controls and feedback. Save only that provider's configuration; blank key preserves its stored key. A separate Summary provider selector and Apply provider action choose the provider for future summary jobs. Switching retains both configurations and unsaved card drafts. Checks still list models without inference or saving; editing one provider does not submit the other's draft.

Reuse the existing encrypted storage format. Extend save with `activate: false` to separate editing from selection; retain existing activation behavior for callers omitting this flag. PUT `/api/settings/ai/provider` changes selection without changing either provider configuration or credentials. Running summary jobs retain their original snapshots.

Verification: independent persistence/validation unit tests and HTTP tests, Chrome flow covering two visible cards, both saved keys, checking drafts/saved keys, independent save/removal, switching with drafts, reload/error recovery and mobile layout. Full server suite: 161/161 passing. Summary browser regression and build passed. Existing mobile Zoom tooltip positioning was adjusted after the page overflow check traced a 24px overflow to that tooltip.
