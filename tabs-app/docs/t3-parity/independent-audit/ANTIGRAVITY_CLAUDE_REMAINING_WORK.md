# Claude / Antigravity continuation assignment

You are taking over the remaining Tabs implementation and production-repair work. Codex has stopped implementation so you can work exclusively in this checkout. Complete the remaining scope, then return a reviewable evidence-backed handoff for Codex's independent verification. Do not restart the audit or discard completed repairs. Do not finish after planning, narrow tests, screenshots, or a partial implementation.

## Checkout and authority

Work only in:
`/Users/rushil.dev/Desktop/tabs/.worktrees/t3-parity-goal-2026-10-06/tabs-app`

Existing branch: `codex/t3-parity-goal-2026-10-06`
Current HEAD: `bb89383e8516d6ee6c730579be3e353a8e43a0e9`
Original review base: `117643e40e33ee3a897bd00571186f9c674c25a7`

The dirty tree contains substantial completed Codex repairs and existing Antigravity work. Preserve all of it. Do not reset, clean, stash away, replace the checkout, or overwrite it from an upstream copy. Do not modify the primary `/Users/rushil.dev/Desktop/tabs` checkout. Do not touch `main`, push, merge, open a PR, publish or deploy. This assignment authorizes local implementation and validation; local commits are optional and must be reviewable without indiscriminately committing unrelated pre-existing dirt.

The user authorizes you to finish routine implementation decisions without repeated confirmation. Continue independent work if a real external credential, OS permission or unavailable service blocks one acceptance case; record that limitation precisely. Do not invent credentials, waive failures, or claim externally blocked behavior works.

Read these before implementation:

- Checkout `AGENTS.md` and applicable nested instructions.
- `docs/ANTIGRAVITY_T3_PARITY_GOAL_PROMPT_2026-10-06.md`: original product requirements, source pin and acceptance rules.
- `docs/t3-parity/requirements.md` and existing implementation evidence.
- `docs/t3-parity/independent-audit/production-decision.md`, `production-repair-status.json`, `progress.md`, `scope.json`, and `file-review.json`.
- Latest logs under `.logs/antigravity-audit/`. Older `/tmp` logs disappeared and are historical claims, not fresh acceptance.
- Before Effect changes, the reference LLMS at `/Users/rushil.dev/Desktop/tabs/t3code-main/.repos/effect-smol/LLMS.md`, plus actual installed rc.112 source/examples. Do not edit read-only vendored references.

A local baseline of the inherited dirty state is saved under `.logs/antigravity-audit/claude-handoff-baseline/`. Preserve it and use it to distinguish your changes from inherited work. The source coverage ledger is partial; existing entries and targeted fixes are not an exhaustive current audit.

## Immediate unfinished edit: fix this first

The last Copilot compatibility edit is unfinished and the latest server typecheck fails. Do not trust older status saying typecheck passes.

Inspect:

- `apps/server/src/provider/acp/CopilotAcpSupport.ts`
- `apps/server/src/provider/Layers/CopilotAdapter.ts`
- `apps/server/src/provider/Drivers/CopilotDriver.ts`
- New `apps/server/src/orchestration-v2/Adapters/CopilotAdapterV2.ts` and its test.
- `.logs/antigravity-audit/copilot-v2-typecheck-final.log`

The shared model-selection helper currently assumes `AcpSessionRuntimeShape.getProtocolVersion`, but that member does not exist. The negotiated protocol version is available from `start().initializeResult.protocolVersion`. Pass/store that version explicitly where needed; do not add casts or a fictitious API. Protocol1 uses `setSessionModel`; protocol2 uses `setModel` / config options. Preserve the existing helper's error mapping and older callers. Add meaningful tests for both protocols and model changes during an active legacy session. The new V2 Copilot adapter opens a mocked subprocess and selected protocol2 model successfully; 17 focused tests pass, but the type errors must be repaired before acceptance.

## Completed repairs to preserve and build on

- Effect catalog/platform/SQL/atom/vitest dependencies and source APIs now use a single `4.0.0-rc.112` runtime. OpenCode2/ACP collection errors and auth response-drain failures were repaired. Do not revert to beta.78 or install two Effect runtimes.
- Separate modern Codex/Claude/Cursor/Grok/OpenCode/Antigravity driver assemblies exist beside preserved legacy implementations. `ProviderRuntimeGeneration` explicitly selects the path. Modern per-instance capabilities, auth, text generation and maintenance ownership repairs must survive.
- Published Tabs migration IDs1–57 were retained. Additive migration58 supplies missing compatibility schema/lookup/settlement repairs. Preview53-to54 reconciliation is transactional and rejects unexpected later preview history. Populated legacy cutover/import/restart passes; historical ledger names remain unchanged and divergence is logged precisely.
- V2 durable runs now store `scheduledFor` through their JSON codecs. A first message can wait without starting a provider. Future entries do not block ready entries. Deadline edits persist; receipts are idempotent; restart recovery retains schedules and holds the queue. `ComposerQueueWorker` registers promotion with the environment scheduler. Runtime/eligibility/recovery89 tests and focused deadline/order/recovery19 tests pass. **Browser migration and controls are still disconnected.**
- Actual modern MCP HTTP middleware/transport was exercised with the real MCP SDK, scoped extension broker, move-during-invocation and credential revocation. Preserve this coverage. The current Effect transport rejects optional DELETE with405; do not claim session termination via DELETE.
- Real Node PTYs in two isolated managers pass identical-ID/process/cwd/output isolation, close independence, resize, reopen/history restoration and restart. **Remote RPC/UI/Electron acceptance remains to do.**
- All52 existing Testing operations were added to modern RPC, with the same validated input schemas, JSON results and explicit auth scopes. `TestingRuntime` owns the service at environment lifetime, not per websocket. Actual mutation/persistence and read-only denial checks pass. Core and Testing RPC groups are composed separately to avoid TypeScript instantiation-depth errors. Preserve these endpoints and investigate full shutdown ownership.
- Preserve prior dev-auth, canonical containment, atomic write, transcript/usage streaming, secret-answer semaphore, compression, Git/cache/timestamp, power, CLI startup, managed Codex and updater ownership fixes. Native Claude `/compact` is preserved; discarded deep tool payloads no longer drop usage; API-key auth sources and provider capabilities are normalized properly.

Fresh full server baseline before subsequent fixes:13 failed,7742 passed,36 skipped; zero collection failures;661 files;349.87 seconds. Ten failures were subsequently repaired and passed focused checks. The remaining three baseline failures are `orchestration-v2/V1ImportBoundary.test.ts`, reflecting the unfinished runtime migration. This subtraction is not a current final test count. Additional queue, Testing and Copilot changes require fresh full validation.

## Finish the remaining work in this dependency order

### 1. One authoritative V2 runtime, shipped end to end

Coordinate the shipped startup and web client migration. `apps/server/package.json` bin/start still point to legacy `dist/index`; `index.ts/main.ts/wsServer.ts` are legacy. Modern `bin.ts/server.ts/ws.ts` exists and can start, but changing the entrypoint alone breaks the browser.

Inspect the active paths, including:

- `apps/server/src/{index.ts,main.ts,wsServer.ts,bin.ts,server.ts,ws.ts,serverRuntimeStartup.ts}` and packaging/desktop launch code.
- `apps/web/src/{wsTransport.ts,wsNativeApi.ts,nativeApi.ts,routes/__root.tsx,connection/environmentApiRegistry.ts}` and current read-model stores/ChatView.
- `packages/client-runtime/src/rpc/client.ts`, the new V2 projection reducer, and `packages/contracts/src/{rpc.ts,orchestrationV2.ts,ipc.ts}`.

Wire V2 commands, resumable shell/thread/archive subscriptions, bounded selected-thread projections, history pagination and controls into real user entry points. Replace no-op subscriptions. Encode/decode through actual schemas, including dates. Maintain watermarks only after complete validated application; reconnect must replay from committed watermarks. Unknown forward-compatible events require authoritative refresh rather than silently losing state. Avoid whole-history retention or full replay on every update.

Every migrated thread must have exactly one runtime authorizing/writing agent work. A compatibility adapter may translate UI shape, but must not run a second legacy engine or invent misleading legacy domain events. Preserve recoverable legacy data and lossless read access. Resolve the V1 boundary tests through real architecture work; do not merely delete assertions, allowlist all legacy readers, or remove features for green tests. `server.ts` still provides the V1 projection snapshot query; trace its actual consumers and replace live V1 reads appropriately.

Preserve Tabs-specific Testing, usage, provider/account settings, top-level Browser/tools, MCP/extensions, existing Git/PR/review flows, and companion panel. Integrate V2 workflows, coordinated agents, forks/merge-back, approvals/questions, native goals, plans, stops and background lifecycle required by the original ledger. Do not shrink parity to basic chat.

### 2. Durable composer queue through the real UI

Build on existing V2 runs, command receipts, `scheduledFor`, `ComposerQueueWorker`, attachment intake and stop/resume/reorder/edit/cancel commands. Do not create a parallel queue engine.

Replace browser ownership in `apps/web/src/stores/messageQueueStore.ts` and ChatView's local scheduler. Migrate existing local entries, including environment ID, schedules, images/files/data URLs and context, with stable idempotency keys. Upload/claim attachments before durable acceptance. Remove a local entry only after server acknowledgement; retry interrupted migration without duplicate delivery. Preserve local recovery data on quota, upload or network failure. Never dispatch a secondary environment's message through the primary environment.

Expose actual queue state and working schedule/edit/reorder/cancel/hold/resume controls. Stop holds delivery; future deadlines do not trigger early; ready later entries can proceed; errors remain visible and retryable. Queue work survives UI closure, reconnect and server restart under the defined recovery hold policy. Test duplicate acknowledgements, disconnects, restart, cancellations racing delivery, attachments and environment isolation.

### 3. Preserve remaining provider integrations

Finish Copilot V2 integration and protocol compatibility as above. Existing agent-capable Kilo and Droid still need V2 assemblies/adapters preserving their actual protocols, configuration, lifecycle and capabilities. Gemini/OpenRouter currently expose text-generation-only behavior; preserve that behavior without inventing unsupported agent capabilities.

Do not route fork providers through an incompatible SDK just because the types fit. Validate configured executable, model selection, account/environment routing, resume/continuation, approval semantics and shutdown. Maintain explicit legacy/V2 generation routing during transition. Preserve current core-provider managed account/auth/update ownership fixes. Live provider acceptance may use available authenticated accounts without changing them; unavailable accounts must be listed exactly, not replaced with fake success.

### 4. Ownership, security and production acceptance

- Verify secondary environment terminal routing over actual RPC and the companion UI; combine real PTY lifecycle coverage with real UI evidence.
- Verify Testing jobs/processes/browser sessions shut down under environment ownership, including background generation and execution; websocket disconnect should not kill durable environment-owned jobs. Await required cleanup, avoid late writes into closed stores, and preserve user cancellation.
- Finish filesystem containment/race review for ACP client files, extension workspace reads and relevant assets/writes. Canonical path checks alone do not prove safety against ancestor replacement between check and open. Add negative/race tests and an implementation with a defensible ownership boundary; do not claim unverified races are solved.
- Exercise packaged modern startup, readiness, real HTTP/RPC and MCP transport, populated upgrade, migrated provider continuation and clean shutdown/restart.
- Launch real desktop acceptance with `bun run dev:desktop`, using a dedicated worktree-local `TABS_HOME` / `--home-dir`, nonconflicting recorded ports and at most one task-owned app. The compiled Code-OSS reference may be selected read-only with `TABS_CODE_OSS_BUILD_DIR=/Users/rushil.dev/Desktop/tabs/tabs-code-oss`. Do not use live user state, alter shared runtime builds, or call a browser screenshot Electron acceptance.

### 5. Finish the original review coverage and all gates

Continue `scope.json` and `file-review.json` from their current coverage. Review the original Antigravity changes outside Labs and native mobile, plus your integration changes. Update hashes/status/evidence accurately. Mark complete source review separately from tested call chains and real acceptance. Do not mark everything reviewed from grep results, sampled tests or the previous walkthrough.

Read requirements through observable UI/server/persistence/provider behavior; update stale evidence honestly. Keep the audit focused on this scope, avoiding unrelated polish and blanket dependency upgrades.

Run affected focused tests after changes, then:

- `bun run check:effect-versions`
- `vp check`
- `vp run typecheck`
- `vp run test` for the full workspace script
- Packaged server/desktop builds and the real acceptance cases above.

Server focused tests run from `apps/server` using `bun run test <actual src/...test.ts paths>`; web tests run from `apps/web`. Keep editing/root reads and package test working directories distinct. Store logs under `.logs/antigravity-audit/` with phase names. Do not weaken tests, silently skip failures, raise timeouts to hide deadlocks, or claim a passing suite from source inspection.

## Required final handoff to Codex

Return a concise walkthrough plus persistent files containing:

1. Branch/HEAD, inherited dirty baseline and exact files/changes you made, with a patch or reviewable commits. Do not conflate inherited fixes with your work.
2. Requirement-to-evidence matrix showing completed, partial, unverified and externally blocked items.
3. Exact commands, exit codes, test totals and log paths; all remaining failures, skips and collection errors explained.
4. Real Electron/package/upgrade/restart/queue/provider/secondary-terminal evidence, clearly separated from mocks and source review.
5. Architecture: active shipped entrypoint, protocol, projection ownership, single-runtime boundary, queue migration/idempotency, attachment ownership, recovery/stop behavior and provider routing.
6. Updated audit coverage with current file hashes, findings and repaired regressions.
7. A precise remaining list and honest production decision. Do not declare production ready while required work or verification remains.

Complete the heavy implementation and validation before handing back. Codex will independently inspect and verify your claims afterward; your self-review does not replace that independent review. No publishing or deployment is authorized.
