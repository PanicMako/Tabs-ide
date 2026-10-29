# Antigravity handoff: remaining T3 parity in Tabs

Prepared 27 October 2026. This is an implementation prompt pack, not a claim of complete parity or an authorization to merge or deploy. The user relays this document to Antigravity; no message has been sent automatically.

## Start prompt — paste this into Antigravity

You are implementing the remaining T3 Code parity work in Tabs. Read this entire handoff, then execute its work packages in dependency order. Do the implementation and verification; do not return only a plan or a rewritten comparison. Keep each package independently reviewable. Use the existing Tabs UI and architecture, not a parallel application or a wholesale upstream merge.

Authoritative handoff file:
`/Users/rushil.dev/Desktop/tabs/tabs-app/docs/handoffs/antigravity-t3-parity-2026-10-27.md`

Comparison and measured baseline:

- `/Users/rushil.dev/Desktop/tabs/tabs-app/docs/architecture/t3-tabs-comparison-2026-10-27.md`
- `/Users/rushil.dev/Desktop/tabs/tabs-app/docs/architecture/t3-performance-measurements-2026-10-27.json`

First establish an isolated, verified copy of the CURRENT WORKING FILES as described below. Then implement Package 1, followed by Packages 2–8. Audit the report against code before treating an item as missing: it is a map, not an infallible specification. If a capability is already present, prove it with code and tests rather than duplicating it. If a broader comparison reveals additional gaps, record them separately instead of silently widening the current package. Continue through the named packages without asking for routine design approval; stop only for an actual access blocker, a destructive operation, or a material product decision not covered here.

Do not claim completion from screenshots or from a mock alone. Report implemented, automated-tested, live-verified, unverified, and blocked separately. Do not merge, deploy, publish releases, or change the user's active checkout.

## 0. Isolation and reference rules

### Verified state at handoff time

- Git root: `/Users/rushil.dev/Desktop/tabs`
- Monorepo/package-command root: `/Users/rushil.dev/Desktop/tabs/tabs-app`
- Current branch: `codex/startup-release-review`
- Current HEAD: `3915c864f131e8f7ed472cf06a9cbf5c9ac17835`
- The source worktree has over 400 changed/untracked paths. Many changes described in the report are UNCOMMITTED. HEAD alone is NOT the implementation baseline.
- An older Antigravity checkout exists at `/Users/rushil.dev/.codex/worktrees/tabs-exchange-antigravity/tabs`, branch `codex/tabs-exchange-antigravity`, inspected tip `5d50bf1f9732502b26c7c3f0500503fc83eac9d8`. It belongs to a different Exchange task. Do not reuse or alter it for this work.
- Existing Codex extension, release, and other worktrees are unrelated. Do not alter them.

Before implementation, recheck `git status`, branch, HEAD and `git worktree list`. If they changed, record the actual state; do not reset them to these historical values. Read applicable `AGENTS.md` files, including `/Users/rushil.dev/Desktop/tabs/tabs-app/AGENTS.md`, and relevant repository skills.

Create a NEW isolated worktree/branch for this task. Suggested names, only if unused: `codex/t3-parity-antigravity-20261027` and a dedicated sibling/managed worktree. Never have two agents writing the same checkout.

Preserve the current source baseline in that isolated worktree before making changes:

1. Start from the verified source HEAD.
2. Capture the source's tracked working diff against HEAD, including binary changes, plus its non-ignored untracked source/assets. Do not alter its index, stash, branch or files. Do not copy ignored credentials, local databases, build outputs or runtime state.
3. Apply/copy that baseline into the isolated checkout, preserving paths, symlinks and file contents. Verify transferred tracked/untracked file hashes against the captured source manifest. Detect source changes during capture; retry the capture rather than claiming a consistent snapshot that was never obtained.
4. Record a baseline snapshot commit ONLY in the isolated branch and record its SHA and provenance. This snapshot is inherited user/Codex work, not your contribution. All review diffs must distinguish it from your subsequent implementation commits.
5. Install dependencies from the existing lockfile. Do not copy `node_modules` or fabricate missing local settings.

No destructive Git commands, stash modification, force pushes or wholesale replacement of the active worktree. Do not commit the user's dirty source checkout. No `git add .` in it.

Integration target is `codex/startup-release-review`, never `main` and never the extensions branch. A draft PR is useful only once the source baseline has a published, reviewable base. If that baseline is still unpublished, do not push inherited dirty changes or produce a misleading giant PR: return the isolated baseline SHA, implementation SHA/commit list and a diff of baseline..implementation, and explicitly report the PR-base blocker. Do not change the base to `main` to get around it. No merge is authorized by this handoff.

### Pinned T3 reference

- Repository: `https://github.com/pingdotgg/t3code`
- Inspected upstream revision: `1702d55214bdbae12278462e572b35e7c0eb4a46`
- Read-only local clone: `/tmp/tabs-t3-selector-upstream-20261026`

IMPORTANT: that clone's checked-out files need not match its fetched revision. Read pinned sources using:

```sh
git -C /tmp/tabs-t3-selector-upstream-20261026 show 1702d55214bdbae12278462e572b35e7c0eb4a46:apps/web/src/components/chat/ThreadDetailsPanel.tsx
```

Use the same command for each referenced path. If the temporary clone is gone, create a separate reference clone and fetch/verify that exact revision. Never fetch/merge upstream into the implementation branch as a substitute for a reviewed port. If you choose to inspect a newer upstream revision, record it and explicitly distinguish its changes from this pinned comparison. Preserve upstream licensing/attribution where code is adapted.

T3 uses `@t3tools/*` and a newer Effect API layout; Tabs uses `@tabs/*` and its installed Effect version. Inspect the installed APIs and adapt deliberately. Never import from `.repos/` or invent a module because an upstream import exists.

## 1. Product and correctness invariants — all packages

- Preserve Tabs' existing Agents UI, theme tokens, restrained rounded surfaces, navigation, embedded IDE, Git/divergence features and provider integrations. Match T3's capabilities, not its branding.
- Do not redesign right-hand Settings pages or unrelated Code-OSS/chat internals. No sparkle icons, new palette toolbar, artificial bouncing animation or arbitrary green status emphasis. Semantic Git additions/deletions can retain their established colors.
- Tabs Dark/Light use logo blue `#0E2AF3`; Monotone presets stay neutral. Preserve explicit custom themes and user settings.
- Resolve every operation through the owning environment/machine/project/thread. Never silently fall back to the local machine. Do not confuse remote Git refs with remote execution environments.
- Server authorization and validation remain authoritative. UI-disabled controls are not a security boundary. Inherit permissions unless the user explicitly selects a supported policy; do not escalate to full access for convenience.
- Distinguish provider-native read-only sub-agents from app-owned delegated children. Provider capabilities vary. Do not pretend unsupported operations succeeded or create a writable composer for native child threads.
- Preserve history, pinned/live threads, queues, exact counts, direct links, archived access, exports, unsaved drafts and reconnect behavior.
- Respect reduced motion, keyboard navigation, meaningful labels and focus restoration. Use Tabs' custom confirmation dialogs; no native alert/confirm/prompt.
- Subscription/event listeners must be disposed on closure, thread/environment change and unmount. Prefer existing streams/cache; no permanent polling per collapsed panel or per row.
- Never log credentials, webhook tokens, bearer URLs or raw private prompts in test evidence. Use configured secure provider settings; never invent credentials or ask the user to paste a key into chat.
- Do not enable a real recurring task, publish a PR to the user's repository, commit/push user work, delete user data or change branches in their live project as an incidental test. Use isolated fixtures/throwaway repositories.

## 2. Already implemented — inspect and preserve

Local paths below are relative to the MONOREPO root in your isolated copy, not the Git root. Verify their current contents before editing.

| Area                             | Existing local evidence                                                                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workspace card and navigation    | `apps/web/src/components/chat/ChatHeader.tsx`, `OpenInPicker.tsx`, `WorkspacePullRequest.tsx`; related `.browser.tsx`/`.test.ts` files                                                                       |
| Basic sub-agent UI               | `apps/web/src/components/chat/WorkspaceAgents.tsx`, `WorkspaceAgents.browser.tsx`; active-thread stream in `apps/web/src/components/ChatView.tsx`                                                            |
| Basic automation UI              | `apps/web/src/components/chat/WorkspaceAutomations.tsx`, `WorkspaceAutomations.browser.tsx`                                                                                                                  |
| Real orchestration commands      | `apps/server/src/orchestration-v2/Orchestrator.ts`, `ThreadManagementService.ts`, `Orchestrator.control-reads.test.ts`; `packages/contracts/src/orchestrationV2.ts`                                          |
| Environment-scoped APIs          | `apps/web/src/connection/environmentApiRegistry.ts`, `apps/web/src/wsNativeApi.ts`, `wsNativeApi.test.ts`; `packages/contracts/src/ipc.ts`, `rpc.ts`                                                         |
| Schedules and webhooks           | `packages/contracts/src/scheduledTask.ts`; `apps/server/src/scheduledTasks/` and existing service/schedule/webhook tests                                                                                     |
| Workspace selectors              | `apps/web/src/components/BranchToolbar.tsx`, `BranchToolbarBranchSelector.tsx`, `BranchToolbarEnvironmentSelector.tsx`, `BranchToolbar.logic.ts`, tests beside them                                          |
| Saved project scripts            | `apps/web/src/components/chat/WorkspaceProjectScripts.tsx`, `.browser.tsx`; `apps/web/src/components/ProjectScriptsControl.tsx`                                                                              |
| PR metadata                      | `apps/server/src/git/GitManager.ts`, `GitManager.test.ts`; `apps/web/src/components/chat/WorkspacePullRequest.tsx`, `.test.ts`; inspect `apps/server/src/pullRequest/` for existing capabilities             |
| Shell/thread state               | `apps/server/src/orchestration-v2/ProjectionSnapshotQuery.ts`; `packages/client-runtime/src/state/orchestrationV2Projection.ts`; `apps/web/src/state/readModelTransitions.ts`, `apps/web/src/wsNativeApi.ts` |
| Compact MCP registry             | `apps/server/src/mcp/advertisedJsonSchema.ts`, `.test.ts`, `McpHttpServer.ts`, `toolkits/core.ts`, `toolkits/core.test.ts`                                                                                   |
| Bounded model discovery          | `apps/server/src/mcp/capabilityModels.ts`, `.test.ts`, `OrchestratorMcpService.ts`; `packages/contracts/src/orchestratorMcp.ts`                                                                              |
| Short orchestration instructions | `apps/server/src/provider/T3OrchestrationInstructions.ts`, `.test.ts`                                                                                                                                        |
| Snapshot body dedup              | `packages/shared/src/orchestrationV2DedupedBodies.ts`, `.test.ts`; `apps/server/src/ws.ts`, `apps/web/src/wsNativeApi.ts`                                                                                    |
| On-demand capabilities           | `packages/shared/src/providerWorkspaceSnapshots.ts`, `.test.ts`; server `ws.ts`, client `wsNativeApi.ts`                                                                                                     |
| New highlighting engine          | web `@pierre/diffs` 1.6.1/highlights; `apps/web/src/lib/incrementalHighlighting.ts`, `.test.ts`, `syntaxHighlighting.ts`; `DiffWorkerPoolProvider.tsx`, `DiffEngine.browser.tsx`                             |

Do not reimplement these as a second store, agent system, scheduler or transport. The fresh provider-backed delegation run was NOT verified previously. Existing automated tests are useful evidence, not proof of every live provider.

## Package 1 — complete agent relationships and delegation targeting

Objective: make the agent workflow genuinely usable from Workspace actions, including relationships absent from the current thread's immediate sub-agent array.

Upstream reference paths at the pinned revision:

- `apps/web/src/components/chat/ThreadRelationshipsControl.tsx`
- `apps/web/src/components/chat/SubagentTooltipContent.tsx`
- `apps/web/src/components/chat/ProviderSubagentBar.tsx`
- Locate upstream relationship/workflow derivation modules from these imports; verify their exact paths before using them.

Local entry points: `WorkspaceAgents.tsx`, `ChatView.tsx`, thread stream/read-model paths, environment API registry, contracts `orchestrationV2.ts`, server `ThreadManagementService.ts`/`Orchestrator.ts`, MCP `OrchestratorMcpService.ts` target resolution.

Required behavior:

- Show parent/ancestors, related forks and children with correct relationships, statuses and provenance, including family members absent from the initial shell/current projection. Paginate long families without hiding membership/counts. Handle cycles, missing/deleted/archived relatives, duplicate records and cross-environment IDs safely.
- Open app-owned children normally. Provider-native children remain read-only and route approvals/questions to their parent. Implement supported detach/native-child actions only after verifying provider capability and existing server semantics; otherwise show an explicit unavailable reason.
- Add a provider/model chooser to manual delegation using existing provider catalog/capability controls. Validate the selected provider on the owning machine, preserve explicit effort/options where supported, inherit permissions by default, and revalidate at dispatch. Model disappearance/disconnect or a parent run ending while the dialog is open must produce a recoverable error, not a different silent target.
- Stop queued/preparing/running child work through the appropriate existing commands; do not interrupt the parent or unrelated sibling work. Do not leave pending wakes or duplicate children on retry. Fork/merge-back must retain their provenance/context and only offer valid operations.
- Reuse the active thread stream. If a family query is genuinely missing, add a bounded contract/server query with explicit authorization rather than loading every conversation body. Clear pending UI state on thread/environment changes.

Tests: active/idle/stopping parent; user-origin and provider-native children; cross-provider success and unsupported target; queued/running stop; retry/idempotency; inherited permission enforcement; late results after navigation; archived/missing relative; long family pagination; keyboard/focus; subscription disposal. Preserve the existing server user-delegation test and add capability failures at the server boundary.

Live check: in a disposable project, use an already-configured available provider for one minimal parent/child greeting task. Capture redacted IDs/status transitions and a screenshot of the populated child list/result. Do not substitute a mock or old historical greeting for this check. If credentials, network or provider limits prevent it, report that exact check BLOCKED and continue independent work; do not weaken auth or invent success.

## Package 2 — complete automation management

Objective: expose the existing scheduler's supported lifecycle in Tabs, with an uncluttered thread summary and a management/editor surface.

Upstream references:

- `apps/web/src/components/chat/ThreadAutomationsPanel.tsx`
- `apps/web/src/components/chat/ThreadAutomationsPanel.permissions.browser.test.tsx`
- `apps/web/src/components/settings/ScheduledTasksSettings.tsx`
- `apps/web/src/components/settings/ScheduledTasksSettings.browser.test.tsx`

Local: `WorkspaceAutomations.tsx`, `wsNativeApi.ts`, contract `ipc.ts`/`rpc.ts`/`scheduledTask.ts`, server `scheduledTasks/`, existing secret handling/custom confirmations. Keep unrelated Settings pages unchanged; use a dedicated surface or existing appropriate entry point.

Required behavior:

- Retain live thread-scoped list, toggle, run-now, interval/daily add/edit. Add deletion with custom confirmation, full weekday options, schedule validation and accurate workspace-machine time semantics.
- Expose existing webhook configuration, token rotation and delivery inspection through the correct scoped APIs. Treat URLs/tokens as credentials: reveal/copy deliberately, never leak them into general task lists or logs. Preserve the current token/signature secret on unrelated edits; rotation invalidates the old token and reports the new state accurately.
- Preserve IDs, binding, workspace strategy, selected model/options, permissions, disabled state and trigger-specific fields on edit. Reject stale edits (`requireExisting`) instead of resurrecting deleted tasks. Do not silently convert webhook tasks into daily tasks.
- Read-only users can inspect but cannot mutate/run/rotate. Enforce permission checks on the server as well as UI. Subscription reconnect/disposal must work; no duplicate run-now on retries. Show next/last status and meaningful errors without claiming work ran while the machine was offline.

Tests: create/edit/delete/cancel; interval minimum; weekdays; machine-zone schedule behavior; readonly permissions; wrong environment; stale edits; webhook signature/token preservation/rotation/delivery auth; reconnect; failed save; collapsed/unmounted subscription cleanup. Use fixtures for recurring triggers, not real enabled schedules in the user's workspace.

## Package 3 — shared workspace selectors, placement and scripts

Objective: composer tray and workspace card operate on the same context and share selector logic.

Upstream references:

- `apps/web/src/components/BranchToolbar.tsx`
- `apps/web/src/components/BranchToolbarBranchSelector.tsx`
- `apps/web/src/components/BranchToolbarEnvironmentSelector.tsx`
- `apps/web/src/components/chat/ThreadDetailsPanel.tsx`
- `apps/web/src/hooks/useT3ProjectFileScripts.ts` and its imported server/contracts

Local: the BranchToolbar family; ChatHeader's branch selector; `ChatView.tsx`; environment registry; `WorkspaceProjectScripts.tsx`; `ProjectScriptsControl.tsx`; Git/project command layers.

Required behavior:

- Consolidate duplicated branch/worktree behavior into shared logic with toolbar/panel presentations. Keep existing pull, merge, pinned branches and divergence features. Do not remove a capability to make the component smaller.
- Implement the supported add-project-to-machine/placement flow after auditing actual environment/project APIs. Show only configured usable machines; never invent a machine from a hostname. Locked threads cannot silently move execution to another environment.
- Preserve current checkout/new worktree, PR shortcut and remote-base behavior. A remote base must resolve to the intended remote ref; fetch failure prevents creation. Branch/worktree changes with active runs must use the established interrupt/lock rules. Preserve dirty checkouts and unsaved composer text. Do not change the primary checkout as a side effect of creating another worktree.
- Support repository-declared scripts using the upstream format and precedence only after reading its implementation. Distinguish repository-owned/read-only definitions from saved user scripts. Define ID collision, precedence, edits, file changes, deletion and execution cwd/environment explicitly. Execute a script only on a deliberate user action through the established executor.

Tests: both presentations share context; one/multiple/offline machines; wrong environment; missing project; local dirty tree; active run; fetch/auth failure; remote ref ambiguity; existing/failed worktree creation; persisted draft; script collision/precedence/file update and execution ownership. Use disposable Git repositories and fixture machines.

## Package 4 — complete PR context and readiness

Objective: the card displays verified PR/check/review/mergeability context and routes actions correctly.

Upstream: `ThreadDetailsPrRow.tsx`, `ThreadDetailsPrRows.tsx`, their browser tests, `ThreadDetailsPanel.tsx`, and their imported PR contracts/services at the pinned revision.

Local: `WorkspacePullRequest.tsx`/tests, `useCheckoutPullRequest`, server `git/GitManager.ts` and adapters, `pullRequest/`, shared/client PR resolution. First locate existing rich provider APIs; do not implement a second GitHub client if the project already has one.

Required behavior:

- Preserve actual Draft/open/closed/merged states and multiple/linked/branch PR relationships. Add provider-backed check rollups, review state and conflict/mergeability data as a complete contract→adapter→UI path.
- Ready is never inferred from an open PR or missing checks: require the reviewed readiness conditions. Preserve an Unknown/unavailable state for unsupported provider fields, permissions and stale fetches.
- Correct fork repository and PR identity; environment/project-scoped caches; no stale readiness from a previous branch. Fetch on meaningful changes with cancellation/dedup, not permanent polling per row.
- Preserve commit/push/PR and change-navigation semantics. Read-only users retain correct disabled controls. No live push, PR creation or merge as an incidental test.

Tests: Draft; passed/pending/failed/unknown checks; approved/changes-requested/no-review; conflicts/unknown mergeability; closed/merged; multiple PRs; forked repository; auth denial; stale responses after checkout; caches separated by machine/repository.

## Package 5 — adaptive Tabs workspace card

Objective: retain Tabs' visual identity while giving the panel T3's useful full/compact/essential behavior.

Upstream: `ThreadDetailsCard.tsx`, `ThreadDetailsCard.browser.test.tsx`, `ThreadDetailsSection.tsx`, `ThreadDetailsControl.tsx`, `threadDetailsPanelStyles.ts` if present at the pinned revision.

Local: `ChatHeader.tsx`, workspace-card styles in `apps/web/src/index.css`, `OpenInPicker.tsx`, existing browser tests; new agent/automation sections from Packages 1–2.

Required behavior:

- Work at narrow/wide window sizes, split chat panes and short heights, browser/Electron, light/dark/Monotone. No horizontal clipping, out-of-window menus or inaccessible lower actions.
- Specify deterministic density rules based on available space. Important context/actions stay reachable; secondary groups can collapse. Do not hide active agents or errors with no way to discover them.
- Restore focus on Escape/close. Prevent overlay/drag-region conflicts. Keep scroll regions deliberate and keyboard accessible. Preserve reduced motion.
- Preserve the connected composer tray, curved joins, Tabs theme/branding and existing right-hand Settings content. No wholesale restyle or T3 branding copy.

Tests and screenshots: matching scale at representative widths/heights, both split orientations, menu collision, long project/branch/script/PR names, empty and many agents/automations, zoom, keyboard and reduced motion. Save screenshots after the last change, not earlier prototypes.

## Package 6 — older-settled shell paging (coherent protocol port)

Objective: reduce initial shell payload while retaining complete discoverability and correct state recovery.

Upstream reference: PR `https://github.com/pingdotgg/t3code/pull/24723`. Inspect its full diff and the pinned revision's resulting code; later fixes may be important. Do not copy only its row limit.

Local: `ProjectionSnapshotQuery.ts`, shell/thread RPC schemas in `packages/contracts`, server subscriptions/replay, `apps/web/src/wsNativeApi.ts`, `state/readModelTransitions.ts`, `packages/client-runtime/src/state/`, task sidebar/search, caches and archived/family queries. Locate actual current files rather than guessing names from upstream.

Required behavior:

- Stable server-side cursor/page ordering, exact total/count semantics and recent settled pages. Keep pinned/live/needs-attention threads discoverable according to established behavior.
- Search across unloaded history; direct links and ancestor/family hydration must load omitted threads correctly. An empty initial client array is not evidence a thread was deleted.
- No duplicate/missing rows when threads settle/unsettle/archive/delete, move between pages, get pinned or change while requests are in flight. Preserve unread/count state.
- Explicit compatibility/version/opt-in behavior; older clients retain a safe complete path. Reconnect, replay gaps, cached/offline state, invalidated cursors and simultaneous pages must reconcile correctly. Avoid whole-transcript loading to implement shell paging.
- Shared runtime and any other affected client remain type/behavior compatible. Do not silently break mobile to make web tests pass.

Tests: a large seeded dataset; exact counts; deterministic pagination/no duplicates; search for an unloaded item; direct links; parent/child families; pin/live exceptions; concurrent lifecycle changes; stale cursors; replay/snapshot recovery; environment isolation; older client; cache reload. Measure raw/compressed payload and decode/render costs before/after on the SAME dataset. No universal speed claims.

## Package 7 — safe live-event body deduplication

Objective: extend existing opt-in snapshot dedup to supported live events without losing any text or result data.

Upstream: PR `https://github.com/pingdotgg/t3code/pull/24647` and its final helper/tests at the pinned revision.

Local: `packages/shared/src/orchestrationV2DedupedBodies.ts`/tests; turn-item/subagent JSON schemas in `packages/contracts/src/orchestrationV2.ts`; server wire projection/streams in `ws.ts` and `orchestration-v2/`; `wsNativeApi.ts`; projection reducer.

Required behavior:

- Only omit exact duplicates with an authoritative source available to the receiving client. Handle event ordering and partial/bounded snapshots explicitly. Missing source data must trigger a safe recovery/full representation, never an empty user-visible body.
- Restore before UI, storage/cache and exports. Preserve ordinary empty text versus omitted text. Treat streaming deltas, edits, inherited rows, checkpoints and subagent progress/results independently.
- Preserve opt-in legacy compatibility, reconnect/replay and event ordering. Do not dedup a subset of fields while dropping schema markers in a downstream decoder.

Tests: lossless round-trip including Unicode/long text; genuinely empty bodies; missing/stale authoritative record; late/out-of-order/replayed events; inherited rows; truncated/bounded snapshots; reconnect; exports/cache; opted-out client. Measure exact bytes and decode/restore overhead on a representative event trace.

## Package 8 — tool consolidation and evaluated context budgets

Objective: address remaining upstream tool-context differences without breaking existing clients/tool references.

Upstream: PRs `https://github.com/pingdotgg/t3code/pull/25423`, `https://github.com/pingdotgg/t3code/pull/25790`, `https://github.com/pingdotgg/t3code/pull/25785` and `https://github.com/pingdotgg/t3code/pull/24635`. Inspect full diffs, the final toolkit registration boundary and tool-use evaluation method.

Local: `mcp/toolkits/`, `McpHttpServer.ts`, `advertisedJsonSchema.ts`/tests, `capabilityModels.ts`/tests, `OrchestratorMcpService.ts`, handlers, shared orchestration instructions, existing context-budget test/artifact.

Required behavior:

- Inventory current advertised tools/descriptions/schemas and actual call sites before choosing consolidation. Preserve all operations and their permissions/validation/error semantics.
- Keep backward-compatible aliases/references for renamed operations as required by the repository's tool-rename skill. Do not remove old names because the new model prompt no longer mentions them.
- Compact ALL registration paths without weakening full runtime validators. Keep paged/searchable model discovery and inherited defaults. Preserve ACP-specific fallbacks only where required.
- Add a committed, meaningful budget baseline/ratchet for the actual registry and provider-specific injected instructions. Changing a budget must require an explicit explained change, not a silent threshold increase.
- Reproduce a small representative tool-use evaluation when configured credentials permit: success, invalid argument recovery, discovery and context tokens under comparable model/settings. Distinguish schema bytes, estimated tokens and actual provider usage.

Tests: legacy names still resolve; all registered schemas compact; runtime validation rejects invalid arguments; each consolidated operation retains positive/negative/authorization coverage; model pagination; provider instruction parity; real registry budget. Never claim T3's advertised 4× tool quality or 79% context reduction was reproduced from byte counts alone.

## 3. Verification commands and evidence contract

Run from the ISOLATED monorepo root (its `tabs-app` directory):

```sh
vp check
vp run typecheck
vp run test
```

Run focused suites in their owning package, using real existing paths. Examples already present at handoff time:

```sh
# cwd: isolated-copy/tabs-app/apps/web
vp run test src/wsNativeApi.test.ts
vp run test:browser src/components/chat/WorkspaceAgents.browser.tsx src/components/chat/WorkspaceAutomations.browser.tsx src/components/chat/ChatHeader.browser.tsx src/components/BranchToolbar.browser.tsx src/components/chat/WorkspaceProjectScripts.browser.tsx src/components/DiffEngine.browser.tsx
vp run test:browser src/components/ChatView.browser.tsx

# cwd: isolated-copy/tabs-app/apps/server
vp run test src/orchestration-v2/Orchestrator.control-reads.test.ts src/orchestration-v2/ThreadManagementService.test.ts
vp run test src/scheduledTasks/ScheduledTaskService.test.ts src/scheduledTasks/ScheduledTaskService.schedule.test.ts src/scheduledTasks/ScheduledTaskService.webhook.test.ts
vp run test src/mcp/advertisedJsonSchema.test.ts src/mcp/capabilityModels.test.ts src/mcp/McpHttpServer.test.ts src/mcp/toolkits/core.test.ts
```

Verify exact paths/scripts after baseline capture. Browser filters follow the script name directly; do not insert an extra `--` that accidentally removes the filter. Use the repository's documented native Code-OSS hygiene/tests only if a package genuinely needs to change that runtime; none of these packages authorizes an upstream Code-OSS sync.

Last observed source-baseline checks (historical, NOT your new results): full test 18/18 tasks; server 647 files/7,596 passed plus 35 skipped; web 229 files/1,732 passed; typecheck 16/16 tasks; `vp check` zero errors/660 existing warnings. One full run hit an existing CLI subprocess timeout, then isolated and full retries passed. Do not weaken assertions, silently skip tests or increase unrelated timeouts to manufacture green results. Reproduce failures and distinguish baseline failures from introduced regressions.

For each package return:

1. Requirement → implementation file/symbol → test/evidence → status matrix. Status must be implemented+tested, implemented+unverified, absent or blocked, not a blanket checkmark.
2. Baseline SHA, implementation commit SHA(s), exact changed paths and dependency changes. Separate inherited baseline files from your contribution.
3. Exact commands, cwd, exit status and test counts; full log paths. Explicitly list mocks versus real browser/Electron/provider/server verification.
4. Screenshots of final real UI, with theme/scale/window dimensions and data provenance. Screenshots do not prove execution or authorization.
5. Benchmarks with dataset, environment, method and raw artifacts; no unmeasured headline multipliers.
6. Compatibility, migration/rollback considerations, remaining risks and precise blockers. No destructive rollback instructions or data reset.
7. An updated comparison report that reflects the final code and explicitly lists unfinished requirements. Do not remove open gaps merely because they are inconvenient.
8. Draft PR URL only when an honest published base is available; otherwise baseline..implementation review diff and the exact PR-base blocker. Do not merge or deploy.

Stop only after all named packages have either passed their acceptance checks or have individually documented genuine blockers. A successful unit test, an attractive card or a report alone is not complete T3 parity.
