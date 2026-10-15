# Thread pull-request contracts — batch224

HEAD unchanged bb89383e8516d6ee6c730579be3e353a8e43a0e9. Complete136line schema/85line tests reviewed; wholly added. Existing824contract test pass reused.

Legacy link, host-level identity, source/tombstone, native-stack/snapshot and watch watermarks reviewed. URLs are nonblank strings without protocol validation at this persistence shape; metadata MCP input separately checks HTTP(S). No active unsafe navigation established. Stage/number positive and statistics nonnegative, array lengths and cross-field host/repository/stack consistency not enforced here.

Tests cover snapshot/native-stack decode and older watch missing passedChecks default[]. They do not exercise tombstone hiding, wake dedup/retries, host equality or live pull-request changes. Caller inventory locates pullRequestWatch calculation, reactor, projection and orchestrator defaults, including comments-only wake exhaustion. That inventory is not runtime proof; watch helper/full runtime tests remain pending for source review.

No production edits; full audit remains incomplete.
