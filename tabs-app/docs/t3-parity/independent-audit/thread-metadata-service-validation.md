# Thread metadata service — batch220

HEAD unchanged bb89383e8516d6ee6c730579be3e353a8e43a0e9. Complete260line service/168line tests reviewed. Targeted Node24 Vitest4tests passed5.80s; session10683exit0; log /tmp/tabs-audit-thread-metadata.log.

Requires orchestration capability and target identity, rejects missing/deleted shell. Cross-thread provider caller must own active nonarchived run; client caller uses runtime ceiling. Target modes checked before records/dispatch. Same-thread branch skips cross-thread live-run check; whether invocation scope already guarantees liveness requires context review. No authorization failure inferred without that evidence.

Stable command identity includes URI-encoded request namespace/thread/action/request key; omitted key random UUID. Result comes from dispatched metadata event rather than current mutable shell. Selected integration2050-2110 asserts same command ID/sequence on rename retry, but full integration not executed here. Four focused tests mock thread management and verify missing caller/storage failure/mode escalation/ended cross-thread run. Successful durable idempotency and concurrent permission changes remain unverified.

No production edits; full audit remains incomplete.

## Batch221 invocation follow-up

Complete123line McpInvocationContext and full100-addition17-deletion diff read. Capability helpers validate grants and thread presence, no run ownership. Selected McpSessionRegistry issue/resolve shows random per-provider namespace, hashed token map and liveness-window pruning; resolve refreshes lastAliveAt without querying activeRunId. Revocation callers located ProviderSessionManager516 and legacy ProviderService913. Thus invocation context does not itself prove a currently running turn. Same-thread metadata policy may legitimately allow a live idle provider session; no explicit requirement found here that it must deny idle same-thread writes, so no security defect claimed. Full registry/HTTP revocation and invocation tests remain pending.
