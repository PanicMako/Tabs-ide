# Orchestrator MCP contract review

Complete new661-line contract and166-line test read at HEAD bb89383e8516d6ee6c730579be3e353a8e43a0e9. Original-base diff confirms827 inserted lines and no removed lines.

Strict model options accept canonical selections or string/boolean shorthand; invalid values fail instead of disappearing. Input bounds include20 batch threads,100 read/list items,50 runs,50,000 characters/item,120,000-character prompts,512-character titles and256-character idempotency keys. Schedule objects additionally accept decoded JSON strings for provider compatibility. Secret-request timeout is bounded integer1s–1h; delegate/thread wait numbers are clamped at service boundaries. Read/status structures permit several state combinations without relational validation, so producer correctness remains a service concern.

The five tests cover valid delegation result decoding, model-option shapes and rejection, mixed batch creation, and selected thread management requests. They do not establish actual delegation, cancellation, authorization, schedule execution, secret handling, limit enforcement, idempotency or polling behavior. Reused the existing56-file/824-test passing contract run rather than rerunning.

Selected OrchestratorMcpService source1620–1645/1785–1805/2270–2300 confirms timeout application and clamping. Full service review and native integration remain open. Previously confirmed shipped legacy/V2 composition gap remains an acceptance blocker; contract completeness does not resolve it. No production code changed.
