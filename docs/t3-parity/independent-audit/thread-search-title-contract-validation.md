# Thread search/title contracts — batch210

HEAD unchanged bb89383e8516d6ee6c730579be3e353a8e43a0e9. Complete42line search and10line title new sources/full diffs reviewed. Existing824contract tests reused; neither file has a direct contract test file.

Search input trims then requires2-200 characters and optional integer1-50 limit. Snippet max240; matches array has no schema maximum. Full current server ThreadSearch implementation read: SQL uses escaped parameterized LIKE, excludes deleted/archived threads/deleted projects/streaming messages, ranks user first then newest per thread, applies limit default50. Snippet uses236-character body plus ellipses. Selected ws handler wraps typed errors; RpcAuthorization maps search to orchestration read scope.

The schema comment says bounds prevent monopolizing the synchronous SQLite connection. Input and output caps do not themselves cap rows scanned by leading-wildcard LIKE plus ranking. This is a performance claim not proven by tests or source alone; no measured slowdown established. Runtime native SQLite performance and ThreadSearch.test.ts assertion review remain pending.

Title regeneration carries command identity/start timestamp and is used by MCP metadata and legacy orchestration shapes. No title lifecycle correctness inferred from that shape.

No production edits; full audit remains incomplete.
