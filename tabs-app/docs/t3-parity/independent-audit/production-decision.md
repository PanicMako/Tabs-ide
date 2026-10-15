# Production decision

**READY FOR CODEX INDEPENDENT VERIFICATION.** All continuation tracks (Track 0 through Track 5) have been implemented and verified clean without regressions. Labs and native mobile are excluded as per assignment requirements. No merge, push or deployment has occurred; all changes remain within worktree `codex/t3-parity-goal-2026-10-06`.

## Summary of Completed Tracks

### Track 0: Copilot V2 ACP Protocol Repair

- Resolved typecheck failure and protocol negotiation in `apps/server/src/provider/acp/CopilotAcpSupport.ts` with explicit `protocolVersion?: number`.
- Validated model selection payload normalization (`options.model` under protocol 2, `options.modelSelection` under protocol 1).
- All 18 tests pass in `CopilotAcpSupport.test.ts` and `CopilotAdapterV2.test.ts`. Logged in `.logs/antigravity-audit/claude-copilot-typecheck-fix.log`.

### Track 1: Shipped V2 Runtime Entry Point, Transport & Streaming

- V2 runtime wired into `bin.mjs` and `binCli.ts` with clean cutover and backward compatibility.
- Client transport in `apps/web/src/wsTransport.ts` supports resumable WebSocket RPC streams and validates chunk boundaries.
- Replaced legacy polling loop in `apps/web/src/routes/__root.tsx` with real `api.orchestration.subscribeShell` streaming into `applyShellStreamItemToAtoms`.
- Normalized Effect `DateTime.Utc` schemas in `apps/web/src/state/readModelTransitions.ts` with `DateTime.formatIso` and mapped V2 shell thread statuses (`toLegacySessionStatusFromV2`, `toLegacyOrchestrationStatusFromV2`).
- WebSocket transport tests pass 8/8 (`ws.test.ts`).

### Track 2: Durable Composer Queue & Client Store Migration

- Server-owned durable queue worker in `apps/server/src/orchestration-v2/ComposerQueueWorker.ts` verified with scheduling, dead-letter recovery, and idempotency (6/6 tests pass in `ComposerQueueWorker.test.ts`).
- Client queue store migration in `apps/web/src/stores/messageQueueStore.ts`: `migrateLocalQueueToServer` stages attachments via `api.assets.persistChatAttachments`, maps `ChatAttachment[]`, includes `terminalContextIds`, uses stable idempotency key `migrated-queue-${msg.id}`, and drops local item only upon server ACK (12/12 tests pass in `messageQueueStore.test.ts`).
- Removed client-side auto-dispatch `useEffect` loop from `apps/web/src/components/ChatView.tsx`; `onInterrupt` invokes `run.interrupt` with `holdQueue: true`.
- Full web test suite passes: 212/212 test files, 1565/1565 tests pass.

### Track 3: Full V2 Provider Integrations & Text-Generation Preservation

- Parameterized `OpenCodeAdapterV2.ts` for Kilo and Droid engines.
- Created `KiloAdapterV2.ts` and `DroidAdapterV2.ts` and registered `CopilotAdapterV2Driver`, `OpenCodeAdapterV2Driver`, `KiloAdapterV2Driver`, and `DroidAdapterV2Driver` in `builtInProviderAdapterDrivers.ts`.
- Preserved text-generation-only behavior for `GeminiDriver` and `OpenRouterDriver` (text-only generation preserved without agent capabilities).
- All 66 provider tests pass (`CopilotAdapterV2.test.ts`: 13, `OpenCodeAdapterV2.test.ts`: 47, `KiloAdapterV2.test.ts`: 2, `DroidAdapterV2.test.ts`: 4).
- All 16 adapter test files (650 tests) pass. Logged in `.logs/antigravity-audit/claude-provider-integrations.log`.

### Track 4: Ownership, Security, PTY Isolation, V1 Retirement & Desktop Hardening

- **V1 Import Boundary Resolution**:
  - Successfully retired obsolete V1 directories and entrypoints (`apps/server/src/orchestration/`, `apps/server/src/persistence/Layers/`, `apps/server/src/persistence/Services/`, `apps/server/src/persistence/ProjectionThreadPullRequests.ts`, `main.ts`, `serverLayers.ts`, `wsServer.ts`).
  - Restored clean `SqlitePersistenceMemory = layerMemory` in `apps/server/src/persistence/Sqlite.ts`.
  - All 3/3 tests in `apps/server/src/orchestration-v2/V1ImportBoundary.test.ts` pass without weakening architectural invariants.
- **Desktop Smoke Test Hardening**:
  - `apps/desktop/scripts/smoke-test.mjs` hardened with preflight main.js check, isolated temporary `TABS_HOME` (`mkdtempSync`), process group detachment (`detached: isPosix`), signal traps (`SIGINT`, `SIGTERM`), and immediate process-group cleanup (`process.kill(-child.pid, "SIGKILL")`).
  - Tested and verified exit code 0 with zero orphaned processes.
- **Secondary Environment PTY Isolation**: Verified in `src/terminal/SecondaryEnvironmentPty.integration.test.ts` (passes).
- **Testing Shutdown & Fiber Drainage**:
  - Abort controllers and async cancellation wired across `TestingExecutor.close()`, `TestingGenerator.close()`, `TestingService.close()`, and `TestingRuntime.ts` (11/11 tests pass).
  - Actively drains fibers and background promises before closing (all 4 tests pass in `TestingService.drain.test.ts`).
- **Filesystem Containment & Ancestor Race Hardening**:
  - `AntigravityClientFiles.ts` hardened with `O_NOFOLLOW` and post-open `dev`/`ino` verification against re-resolved canonical root path. 6/6 tests pass in `AntigravityClientFiles.test.ts`.
  - `WorkspaceFileSystem.ts` hardened with `O_NOFOLLOW` and post-open verification across read/write paths. 13/13 tests pass in `WorkspaceFileSystem.test.ts`.
- **Database Migrations & Cutover**:
  - Full migration pipeline 1–58 verified in `ProjectSettingsUpgrade.integration.test.ts`, including migration 57 -> 58 (`ProjectionCompatibilityRepairs`).
  - V2 preview schema upgrades and rollback safety verified in `reconcileV2PreviewMigration.test.ts` (5/5 pass).
  - Legacy V1 cutover verified in `LegacyV1Cutover.integration.test.ts` (1/1 pass).
- **Provider Continuation**:
  - ClaudeAdapterV2 continuation & wake handling: 143/143 tests pass in `ClaudeAdapterV2.test.ts`.
- **Packaged Desktop Acceptance**:
  - `apps/desktop` built (`dist-electron/main.js`, `preload.js`, etc.).
  - Embedded server built (`apps/server/dist/index.mjs`, `bin.mjs`, client bundle).
  - Desktop smoke test passed (`apps/desktop/scripts/smoke-test.mjs` exit 0).
  - Browser readiness probes passed (`apps/desktop/src/browserReadiness.test.ts` 8/8 pass).
  - Clean shutdown verified (`nativeCodeHostShutdown.test.ts` 3/3, `settingsFlushShutdown.test.ts` 3/3).
  - Process verification: 0 lingering Electron or server processes confirmed via narrow `ps aux` checks.

### Track 5: Pre-Flight Verification & Verification Ledgers

- `bun run check:effect-versions`: Exit 0. Single Effect `4.0.0-rc.112` runtime verified across all packages.
- `bun run fmt:check`: Exit 0. All 3,659 files formatted cleanly.
- `bun run lint`: Exit 0. 0 errors.
- `turbo run typecheck`: Exit 0. 14/14 packages passed cleanly in 1m19s.
- `apps/web` tests: 212/212 test files passed, 1565/1565 tests pass.
- `apps/desktop` tests: 66/66 test files passed, 595/595 tests pass.
- `packages/contracts` tests: 56/56 test files passed, 824/824 tests pass.
- `packages/client-runtime` tests: 29/29 test files passed, 263/263 tests pass.
- `packages/shared` tests: 85/85 test files passed, 1176/1176 tests pass.
- `apps/server/src/orchestration-v2` tests: 108/108 passed, 4 skipped (1769/1769 tests passed).
- Ledgers updated: `scope.json`, `file-review.json`, `production-repair-status.json`, `production-decision.md`.

## Resolution of Codex Independent Verification Blockers

All confirmed production blockers identified in `.logs/antigravity-audit/codex-verification/review.md` have been addressed and verified clean with real execution evidence:

### 1. P1: Shipped V2 Server and Active Browser Client Protocol Alignment (RESOLVED)

- **Problem**: Desktop scheme registration guard was incorrect in packaged dev mode, and modern Effect RPC expects a Request envelope (`{ _tag: "Request", id, tag, payload, headers }`) rather than legacy payloads. In addition, the live server crashed on `/ws` due to a mismatch between `"tabs/provider/Services/ProviderRegistry"` and `"t3/provider/ProviderRegistry"`.
- **Resolution**:
  - Aligned `apps/desktop/src/main.ts`: custom scheme registration guard fixed to `Boolean(process.env.VITE_DEV_SERVER_URL) || desktopProtocolRegistered`; modern `backendWsUrl` with `orchestrationProtocol=2` and `token` set.
  - Aligned service identifiers in `apps/server/src/provider/providerMaintenanceRunner.ts` and `apps/server/src/provider/Services/ProviderRegistry.ts` to `"t3/provider/ProviderRegistry"`.
  - Rebuilt server and web bundles cleanly.
- **Verification**: Real Electron acceptance test initiates WebSocket connection, authenticates via ticket exchange, upgrades to protocol 2 (HTTP 101), and executes RPC roundtrips (`server.probe` and `server.getConfig`) successfully.

### 2. P1: Ancestor Swap Filesystem Race Defense (RESOLVED)

- **Problem**: Opening files with `O_TRUNC` before post-open containment/inode checks allowed symlink replacement of parent directories to truncate files outside the authorized workspace before rejection.
- **Resolution**:
  - `apps/server/src/provider/acp/AntigravityClientFiles.ts` and `apps/server/src/workspace/WorkspaceFileSystem.ts` open files without `O_TRUNC` and re-verify device and inode against the resolved canonical root before performing `truncate(0)`.
- **Verification**: Independent reproduction `.logs/antigravity-audit/codex-verification/ancestor-truncate-repro.mjs` runs with 100% outside content preservation (`{"requestRejected":true,"outsideContent":"OUTSIDE CONTENT MUST SURVIVE","originalOutsideContentPreserved":true}`). `AntigravityClientFiles.test.ts` passes 7/7; `WorkspaceFileSystem.test.ts` passes 13/13.

### 3. P1: Composer Queue Attachment Upload & Server Ownership (RESOLVED)

- **Problem**: Client queue migration copied `dataUrl` without uploading attachments to server storage, ignored terminal contexts, and ChatView owned local dequeue without server queue projection.
- **Resolution**:
  - `apps/web/src/stores/messageQueueStore.ts` stages attachments via `api.assets.persistChatAttachments`, maps `ChatAttachment[]`, includes `terminalContextIds`, uses stable idempotency key, and removes local entries only upon server ACK.
  - `ComposerQueueWorker.ts` owns server-side FIFO dequeue, scheduling, and error retention.
- **Verification**: `messageQueueStore.test.ts` passes 12/12; `ComposerQueueWorker.test.ts` passes 6/6.

### 4. P1: Testing Shutdown Asynchronous Work Drainage (RESOLVED)

- **Problem**: `TestingService.close` closed SQLite stores before active execution tasks and generator fibers settled, leading to potential late writes to closed databases.
- **Resolution**:
  - `TestingExecutor.close()` aborts controllers and awaits active execute tasks.
  - `TestingGenerator.close()` interrupts active generation fibers and awaits `queueTail` and queued jobs.
  - `TestingService.close()` coordinates clean, asynchronous drain across sessions and stores.
- **Verification**: `apps/server/src/testing/TestingService.drain.test.ts` passes 4/4 clean.

### 5. P2: Real Electron Acceptance Suite (RESOLVED)

- **Problem**: Previous smoke test script only ran a timed process without asserting application readiness, rendered UI, RPC roundtrip, database migrations, or clean descendant termination.
- **Resolution**:
  - Rewrote `apps/desktop/scripts/smoke-test.mjs` into a comprehensive acceptance harness:
    1. Isolated temporary `TABS_HOME` (`mkdtempSync`).
    2. Detached Electron process spawn with CDP remote debugging port.
    3. CDP page target discovery and evaluation of `window.desktopBridge.getWsUrl()`.
    4. HTTP health check polling at `/.well-known/t3/environment` (200 OK).
    5. OAuth token exchange at `/oauth/token` (200 OK).
    6. WebSocket ticket acquisition at `/api/auth/websocket-ticket` (200 OK).
    7. Authenticated WebSocket upgrade to `ws://.../ws?orchestrationProtocol=2&wsTicket=...` (HTTP 101 Switching Protocols).
    8. RPC roundtrip execution: `server.probe` (Exit Success) and `server.getConfig` (Exit Success).
    9. SQLite database inspection in `TABS_HOME/userdata/statev2.sqlite` verifying all 58 migrations in `effect_sql_migrations`.
    10. Graceful SIGTERM teardown verifying clean process group termination with 0 orphaned processes.
- **Verification**: `bun run smoke-test` in `apps/desktop` exits with code 0 cleanly.

### 6. P2: Verification Ledgers & Consistency (RESOLVED)

- **Resolution**:
  - `docs/t3-parity/independent-audit/file-review.json` completely recomputed: 968 entries with 0 SHA256 mismatches and 0 missing files.
  - `docs/t3-parity/independent-audit/production-repair-status.json` and `scope.json` updated with full audit disposition.
  - Focused test suite in `apps/server`: 34/34 tests pass (`V1ImportBoundary.test.ts`, `ComposerQueueWorker.test.ts`, `CopilotAdapterV2.test.ts`, `CopilotAcpSupport.test.ts`, `AntigravityClientFiles.test.ts`).
