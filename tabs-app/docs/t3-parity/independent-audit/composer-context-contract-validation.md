# Composer context contracts — batch206

Pinned HEAD remains bb89383e8516d6ee6c730579be3e353a8e43a0e9. Complete298line source and271line tests read; both new files. Contracts824test pass from batch199 reused.

Nine known record kinds, bounded open-kind payloads, terminal/review ordered ranges, annotation details and attachment references reviewed. Aggregate200-record/16-million-character checks precede tolerant record decoding; normalized duplicate IDs are rejected after decoding. Tests exercise all known kinds, unknown payload escaping bounds, malformed-known exclusion, normalization, pre-drop count and aggregate size, optional message/dispatch integration.

This suite does not directly assert reversed terminal/review ranges, per-field maximums, or whether attachmentId/screenshotContextId refers to another valid object. Contracts enforce shape rather than those cross-object links. No production failure established from that distinction.

Selected ThreadLaunchService forwards context to branch naming; ProviderTurnStartService projects records through projectComposerContextForProvider for auth handling and user text. This establishes call-path use in V2 source, not shipped desktop integration or provider runtime behavior. Earlier entrypoint findings remain applicable.

No production changes or redundant reruns. Full audit incomplete.
