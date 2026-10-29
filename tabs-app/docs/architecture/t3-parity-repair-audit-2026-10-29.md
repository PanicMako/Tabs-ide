# T3 parity: independent repair audit

29 October 2026. Repair branch: `codex/t3-parity-audit-repairs`.

Historical checkpoint. The [later release audit](t3-parity-release-audit-2026-10-29/README.md) supersedes the remaining acceptance limits below, including the temporary transport/paging mitigations and native build prerequisites.

## Provenance and scope

Antigravity's implementation is `54cf362ec..3b1ac6746`. The first SHA is the captured source-worktree baseline, not an implementation contribution. Repairs start at `3b1ac6746` in `/Users/rushil.dev/.codex/worktrees/t3-parity-repairs/tabs`. Neither the dirty source checkout nor Antigravity's branch was modified. No integration or deployment was performed.

This audit closes the confirmed defects listed below. It does not certify every requirement of Packages 1-8 or claim an exhaustive review of every inherited diff hunk. Historical completion tables must not be read as fresh test evidence.

## Confirmed defects and repairs

| Defect                                                             | Repair                                                                                                                                                        | Evidence                                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Legacy merge-back ignores `sourceThreadId`                         | Translate it to the consolidated `threadId`; force the legacy operation after copying arguments                                                               | Alias regression and existing orchestration integration tests                                                     |
| Legacy tools absent from real HTTP routing                         | Register compatibility operations in the actual MCP registry with their original schemas and permission annotations                                           | HTTP legacy update succeeds; missing task ID is rejected without any write; all advertised schemas remain compact |
| Claude read-only allowlist no longer matches tools                 | Restore separate queue/question/configuration/transfer reads; share their implementations with consolidated operations                                        | Claude adapter allowlist test and orchestration integration suite                                                 |
| Previous machine's scripts appear while a new file read is pending | Key hook state by environment and cwd; expose empty scripts immediately on key changes; cancel stale reads                                                    | Browser test switches machines at the same path with the next read held pending                                   |
| PR card handles only one PR; fork identity lost                    | Resolve linked PR URLs with environment/cwd-scoped query keys, retain branch PR fallback, ignore dismissed links, preserve fork identity in both Git adapters | Browser test resolves two links on the remote environment; GitManager regression                                  |
| Failed PR refresh can retain cached Ready status                   | Render unavailable status and suppress cached check-success indicators                                                                                        | Browser regression with cached passing/approved/mergeable details                                                 |
| Missing live deduplication sources can produce blank bodies        | Disable live body omission; keep complete live/replay event representations and existing opt-in snapshot deduplication                                        | Existing wire/client tests; protocol safety mitigation, not completion of the live optimization                   |
| Comparison document fails formatting                               | Format the changed report and annotate historical claims                                                                                                      | `vp check`                                                                                                        |

Additional related repairs preserve case-sensitive PR cache keys (cache namespace v2 safely invalidates old collisions), treat persisted placeholder data as unverified, and restore the schedule field's top-level schema guidance and `nextRunAt` instructions. Regression tests cover both the cache collision and pending live refresh, and the original schedule-guidance test remains intact.

The primary and secondary web subscriptions no longer opt into older-settled omission. The implementation exposes `getOlderSettledThreads` and re-exports shelf helpers, but no UI consumer calls the paging API. Keeping the complete shell avoids silently hiding older conversations until the shelf is wired and its search/direct-link behavior is verified.

## Compatibility and budget tradeoff

The original `callTool` wrapper affected direct service calls, but the installed Effect HTTP transport dispatches through its internal registry router. Legacy operations now enter that registry and validate their original required arguments before dispatching to consolidated handlers. In particular, `update_scheduled_task` cannot become task creation by omitting its ID, and caller-supplied `action` cannot change a legacy operation.

The actual catalog grows from 59,160 to 73,118 UTF-8 JSON bytes (+13,958) because compatibility operations and read-only entries must be discoverable. Provider injected instructions remain 4,174 bytes for Claude and 6,245 bytes for Codex. The exact baseline was deliberately updated for this compatibility repair; it was not raised to conceal uncontrolled schema growth. Further context reduction needs a transport-supported hidden-alias design and provider-specific read discovery before removing advertised entries. These are schema byte measurements, not actual provider tokens or a model-quality evaluation.

## Validation

Fresh results and complete local logs are recorded at closeout below. Browser fixtures use real Chromium with mocked backend/provider data. The HTTP compatibility test uses a real local HTTP transport and stubbed task services. It does not execute a provider turn or change a real schedule.

## Inherited hygiene setup

The commit hook enters `tabs-code-oss` even when only Tabs application files are staged. A fresh worktree needed the locked native dependencies (`npm ci --ignore-scripts --no-audit --no-fund`). The inherited `build/lib/gulp/facade.ts` additionally imports `gulp-merge-json` and `gulp-sort`, although neither is declared in that vendored manifest/lockfile. Local hygiene tooling uses `gulp-merge-json@2.2.2` and `gulp-sort@2.0.0` installed in a separate temporary tool directory; no vendored source or dependency manifest was changed. This does not establish a reproducible fresh native build. The dependency discrepancy remains an inherited build prerequisite to resolve separately before production signoff.

## Remaining acceptance limits

- Older-settled shell omission remains disabled in the web client until UI paging and unloaded-history search are connected. Server paging contracts and tests remain available.
- Live event body deduplication remains disabled until source-version validation and automatic recovery are implemented and tested for missing/stale/out-of-order data. Full bodies preserve correctness at a transport-byte cost.
- The original report does not establish a real configured-provider parent/child run, complete theme/scale/Electron screenshot matrix, performance measurements on matching datasets, or actual model tool-use quality. These are unverified, not reproduced successes.
- Repository scripts are currently offered as imports. Full repository-owned precedence, live file updates, shared selector consolidation, and placement-flow parity require separate acceptance review; the repair does not label them complete.
- No published review base was established for the inherited dirty source snapshot. Review locally before authorizing integration into `codex/startup-release-review`.

## Fresh closeout evidence

Command root: `/Users/rushil.dev/.codex/worktrees/t3-parity-repairs/tabs/tabs-app`. Node v26.11.1; shell Bun v1.3.14 (workspace runner reports Bun v1.3.9). Full logs are retained locally under `.logs/t3-parity-repairs/` and are excluded from Git.

| Command and cwd                                                                       | Exit | Result                                                                                                                 | Log                   |
| ------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `vp run test --concurrency=2` at command root                                         | 0    | 18/18 tasks; server 649 files passed, 11 skipped; 7,613 tests passed, 35 skipped. Web: 230 files / 1,749 tests passed. | `workspace-final.log` |
| `vp run typecheck` at command root                                                    | 0    | 16/16 packages                                                                                                         | `typecheck.log`       |
| `vp check` at command root                                                            | 0    | Formatting clean; zero lint errors; 671 existing warnings                                                              | `check.log`           |
| `vp run test:browser` with the eight files below, cwd `apps/web`                      | 0    | 8 files / 59 tests passed in Chromium                                                                                  | `browser.log`         |
| `vp test src/wsNativeApi.test.ts src/lib/pullRequestSnapshot.test.ts`, cwd `apps/web` | 0    | 2 files / 53 tests passed                                                                                              | `web-focused.log`     |
| `vp test src/mcp/toolUseEvaluation.test.ts`, cwd `apps/server`                        | 0    | 5 tests passed, including local HTTP compatibility and actual merge command targeting                                  | `legacy-focused.log`  |
| `vp test smoke-desktop-backend.test.mjs`, cwd `scripts`                               | 0    | 3 tests passed                                                                                                         | `smoke-retry.log`     |

Browser filter list: `src/components/chat/WorkspaceAgents.browser.tsx src/components/chat/WorkspaceAutomations.browser.tsx src/components/chat/WorkspaceProjectScripts.browser.tsx src/components/chat/WorkspacePullRequest.browser.tsx src/components/chat/useT3ProjectFileScripts.browser.tsx src/components/chat/ChatHeader.browser.tsx src/components/BranchToolbar.browser.tsx src/components/ChatView.browser.tsx`.

The first default-concurrency full run hit the existing five-second `smoke-desktop-backend` test timeout and canceled remaining tasks. Its isolated retry passed without changing any timeout. The next complete run found one stale schedule-guidance regression (7,612 other server tests passed); restoring the missing schema guidance fixed it. The final complete run passed with lower package concurrency. These failed attempts remain in `workspace-initial-timeout.log` and `workspace-schedule-regression.log`.

No SQLite migration or user-state reset is needed. The PR cache uses a new namespace to invalidate potentially colliding derived snapshots; source data and old cache entries are preserved. The transport mitigations trade bytes for complete history and event bodies. Rollback should revert the scoped repair commits in a reviewed integration branch; do not reset or clean the user's source checkout.
