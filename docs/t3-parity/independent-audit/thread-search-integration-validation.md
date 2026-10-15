# Thread search integration — batch211

HEAD unchanged bb89383e8516d6ee6c730579be3e353a8e43a0e9. Implementation168lines read in batch210; complete201line new test reviewed now. Numstat confirms both wholly added.

Node24 targeted command: vitest run apps/server/src/orchestration-v2/ThreadSearch.test.ts --reporter=dot. Session51967 terminal exit0;2tests passed1.75s, native in-memory SQLite with real projection/project stores. Log /tmp/tabs-audit-thread-search.log.

Tests verify active-project/thread filtering, exclusion of streaming/system messages, user-over-assistant and newest user selection, ASCII uppercase matching, explicit limit1 and literal percent handling. Corrupted numeric text is surfaced as decode error. No network mocks stand in for this SQL behavior.

Missing here: long snippet centering, non-ASCII case behavior, underscore/exclamation literal cases, tie-break ordering, large-database latency and limit rejection at RPC boundary. Passing native small-fixture tests do not resolve the scan-performance claim or shipped-entrypoint integration. No new failure found in executed cases.

No production edits; full audit remains incomplete.
