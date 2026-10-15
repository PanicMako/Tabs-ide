# V2 orchestration contract review — partial

Read current1–180 of3618 lines: imports, actor/creation provenance, provider refs, thread lineage, source-point and context-transfer resolution variants. Native refs allow null id independent of strength; lineage fields allow combinations needing producer consistency rather than schema-level relational checks. No defect established from declarations alone. Remaining source/test/diff and producer consistency review open. Existing824 passing contract results remain narrow codec/test evidence, not shipped V2 runtime proof.

## Batch270 capabilities and persisted runtime state

Complete181–1060 read (opening1–180 previously covered). Covers provider capabilities and weaker default runtime-policy enforcement, limit-recovery updates requiring a choice, app-thread settlement/pin/rollback state, queued/held runs, delegated-completion cohorts, restart-cancelled work, execution nodes/subagents/checkpoint scopes, sessions, background kind fallback, provider goals/thread metadata/context handoffs/turns and runtime requests. Most lifecycle relationships are producer invariants, not relational schema checks.

Selected recovery278–306 marks unheld queued runs held while preserving identity/order; projection520–538 omits held queued runs from its runtime-interest criterion. This supports the local meaning of queueHeld but does not prove dispatch cannot occur elsewhere or shipped recovery works. Earlier browser-local queue/shipped V2 composition blockers remain independent.

latestProviderTurnForAttempt chooses highest ordinal for matching nonnull attempt; selected final test1412–1423 checks unmatched/null/unsorted matching turns. Codec suite passed824 previously; helper/source trace does not justify claiming multi-turn native goal execution. Remaining1061–3618/current tests/diff pending. No production edits.

## Batch271 notification/timeline compatibility

Complete1061–1720 read: notification source compatibility transforms, conversation messages, plan/question/checkpoint schemas, bounded provider failures, timeline item variants, unknown-turn-item filtering and opening domain events. Failure strings have size bounds but credential redaction is explicitly producer-owned; schema bounds are not sanitization. Secret-request timeline items contain labels/status only, not secret values; broader producer/storage path remains open.

Actual Bun codec diagnostic from packages/contracts exited0: future-kind source becomes background_task and encodes canonically; subagent with childThreadId encodes as background_task/work subagent; command encodes background_command; malformed known delegated_task missing taskIds rejects. This verifies selected compatibility transforms and known-kind rejection, not notification delivery or older installed clients. A test-reference rg used an incorrect package-root relative path and yielded no coverage. Existing824 contract evidence reused.

Unknown turn-item filtering is only applied by specialized array helpers, not the raw union; inspect remaining snapshot/stream usage before concluding every path tolerates future types. Remaining1721–3618/test source and native timeline rendering open. No production edits.

## Batch272 domain events, projections and JSON forms

Complete1721–2600 read. Domain-event variants, thread projection/shell/snapshot, shell stream and JSON date codecs inspected. Snapshot raw/visible turn-item arrays both apply unknown-item filtering. Raw domain-event schemas remain strict; later thread-stream wrapper must be reviewed separately before claiming forward compatibility on subscriptions.

JSON forms explicitly convert timestamps for thread/run/attempt/session/provider/context/checkpoint/request/conversation data. Runtime and JSON turn-item variants were read independently. Lexical comparison of43 dotted/hyphenated domain-event literals reports no missing variants; saved v2-domain-event-tag-comparison.json. This is a string inventory, not AST field/schema equivalence or proof of replay. No new mismatch established.

Commands begin after this reviewed range, so the planned client-command boundary review remains next work. Source searches locate later unknown-thread-event wrapper at3296–3367, not yet reviewed. Tests and native snapshots/subscriptions remain open. Existing824 contract evidence reused; no production edits.

Batch273: completed current lines2601–3618, including client commands, internal commands, progressive snapshots, stream compatibility, RPC schema map, and replay transcripts. Actual Bun diagnostic exited0: public command schema rejects thread.stop and checkpoint.rollback.fail; unknown future.event decodes to unknown-event retaining sequence7; malformed known turn-item.updated rejects. This establishes schema boundaries, not deployed transport or lifecycle behavior. Reused prior824 passing contract tests. Dedicated test-source review and shipped integration remain incomplete.

Batch274: complete1423-line dedicated test source reviewed. Compatibility tests include mixed known/unknown wire events, future turn-item filtering in snapshot/history, malformed known payload rejection, bounded snapshot negotiation, historical capability/background defaults and old notification encodings. Lifecycle tests decode shapes; they do not execute rollback, delegated wakes, checkpoint counts or shipped server wiring. Handwritten legacy schemas are useful codec evidence but not a running historical client. Existing824 passing contract tests reused.
