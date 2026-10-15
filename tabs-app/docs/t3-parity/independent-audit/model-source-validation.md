Batch191 — model helpers

HEAD unchanged. Complete583line model source and full modified diff reviewed, plus unchanged231line direct test file. Batch180 shared1,176test pass reused.

New equality canonicalizes option ordering and omitted empty lists, while strictly comparing instance/model and option value types. New command selector distinguishes same-instance model changes from provider switches. Custom entries trim provider-owned identifiers, deduplicate exact slugs, decode capabilities, and reconstruct compatibility fields from option descriptors. Alias resolution now includes selectable-option aliases. Formatting and Codex family helpers inspected.

Direct shared tests exercise existing descriptor/alias/default/effort helpers; they contain no assertions for new equality, custom entry conversion, display formatting or explicit option alias lists. Equality is used by V2 orchestrator, adapters, turn start/switch and session transition policy. Selected policy source confirms equality affects restart/reject decisions. Provider snapshot and Codex custom-model append use decoded capabilities or provider fallback. MCP thread command selector has a source caller, subject to the already recorded shipped toolkit wiring gap. No app caller found for toCustomModelSetting or formatModelSlugName in the search.

The equality helper assumes typed option arrays unlike the defensive selection reader that tolerates migrated object maps. No valid persisted-state path to malformed options or confirmed failure established. Duplicate option IDs with differently typed equal string representations can make canonical sort order sensitive, but contract validity and actual producers require investigation before assigning a regression. Native provider switching/custom models not exercised in this batch.

No production changes; full audit incomplete.
