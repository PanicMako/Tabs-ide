# Thread metadata MCP contracts — batch219

HEAD unchanged bb89383e8516d6ee6c730579be3e353a8e43a0e9. Complete122line new schema/100line new tests read; numstat confirms wholly added. Existing824contract test pass reused.

Action filter enforces required rename title/link pull request and forbids incompatible fields. Title512/client key256 bounds, paired-surrogate validation and HTTP(S) URL check reviewed. Tests cover all actions, missing/conflicting fields, unknown action, valid emoji/lone surrogates, self-hosted HTTP(S) URL and malformed/javascript/file rejection. No direct title/key maximum assertions. HTTP URL shape does not validate repository/number consistency; that would require handler logic.

clientRequestId uses trimming nonblank codec despite test name saying without normalizing valid keys: its tested emoji key contains no surrounding spaces. No semantic requirement that whitespace-distinct keys remain distinct established, so not a new defect. Contract tests do not prove mutation idempotency, permission checks or regeneration lifecycle. Consumer inventory locates ThreadMetadataMcpService and orchestrator toolkit tools207, not the separate thread toolkit. Broader service integration remains open; existing shipping MCP entrypoint split finding remains applicable.

No production edits; full audit incomplete.
