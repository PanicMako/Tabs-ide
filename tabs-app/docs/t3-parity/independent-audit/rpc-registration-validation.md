# RPC registration inventory

Partial RPC source review, not completion. Current1923-line source includes broad new RPC surface. Opening imports1–180, method names430–565, provider setup620–655 and selected middleware/group boundaries were inspected. Some combined tool outputs truncated, so unshown lines are not credited as reviewed.

A text inventory matches Rpc.make declarations referenced by WsRpcGroup against computed authorization and server-handler keys. Results are in rpc-registration-inventory.json. This is lexical evidence of keys, not proof that handlers run, enforce correct scope or implement correct behavior. Labs/device entries are marked excluded; unchanged source/full1285-added234-removed diff remains outstanding.

Selected authorization source requires an explicit method scope, throws on missing mappings and fails calls whose connection lacks that scope. WsRpcGroup attaches RpcScopeAuthorization. Selected ws1814 source starts the V2 dispatch handler with intake/provenance and startup enqueue. Exact middleware execution and shipped entry composition remain integration work. Existing824 passing contract tests reused.

## Batch261 payload/response pass

Read current180–320/736–1452/1508–1748, recovering1450–1454 closing context; Labs device1455–1507 omitted. Reviewed ACP registry, diagnostics/usage, relay installation, PR read/write/viewed-file operations, clone/project filesystem, attachment signing, VCS/terminal/preview, V2 dispatch/subscriptions, scheduling, secret-answer and capability-negotiated server stream contracts. No response/payload mismatch established from these declarations.

Selected ws2165–2190 URL-auth handler maps accepted boolean to declared result; operation error handling is not proven solely by this call. Selected3682–3705 explicitly emits usageLimitSourcesUpdated only when the subscriber asks, consistent with the contract's compatibility promise. Full subscriber path and client behavior remain open.

RPC source and original-base removed hunks remain partially unread. This batch records partial coverage, not acceptance, and does not rerun existing tests.

## Batch262 source completion and legacy removals

Read remaining321–429/566–619/656–735/1749–1923. Current non-Labs source complete across batches; device1455–1507 excluded. Extracted and read all234 removed original-base lines directly, including removed legacy orchestration RPCs, batch-keybinding/support-bundle and old Git PR methods, export visibility changes and moved scan/import registration. Added declaration content is covered by current-source reading; no claim of full runtime interoperability.

The removed RPC-group legacy method names still appear in active wsNativeApi/wsServer. Traced root export: index.ts explicitly exports WS_METHODS from ws.ts, whose object restores git.listPullRequests/git.mutatePullRequest/git.createPullRequest/server.createSupportBundle/server.batchUpsertKeybindings/server.batchRemoveKeybindings and request decoders. Consequently removed RpcGroup entries do not alone establish undefined names or broken legacy transport. Compatibility remains two distinct transport paths; legacy/V2 integration and external direct RPC-subpath consumers are unverified.

No new confirmed defect from this pass. Existing shipped runtime composition blocker remains; no production changes or redundant test run.
