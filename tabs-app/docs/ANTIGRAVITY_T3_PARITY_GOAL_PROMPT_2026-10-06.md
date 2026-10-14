# Goal: bring Tabs to current non-mobile T3 Code parity

You are implementing this goal in Antigravity Goal Mode. Take the time required to complete the work, including research, migration, tests, real Electron verification, and an evidence-backed handoff. This is an implementation assignment. Do not finish after writing a plan, adding UI placeholders, producing a screenshot, or implementing only the first few items.

## Product objective and explicit user requirements

Bring Tabs up to the non-mobile functionality of the pinned T3 Code source, while retaining Tabs' existing product architecture, integrations, and additional features.

The user explicitly wants:

1. The new orchestration capabilities, including coordinated agent work and durable background workflows.
2. A T3-style companion side panel **inside the Agents workspace**, where users can browse files, use a browser, terminals, diffs, and PRs while chatting.
3. Existing top-level Tabs tool buttons to remain available. A user can use Browser or other tools from the main toolbar, or use the new companion panel inside Agents.
4. Complete real usage coverage, particularly Antigravity historical usage, with the appropriate provider/model/account/environment breakdowns.
5. All other applicable upstream non-mobile features, including those not listed in this prompt. Perform a systematic source inventory to find them.
6. A detailed walkthrough and reviewable code handoff for Codex to inspect independently and repair before integration.

Exclude the iOS/Android application and phone-specific features. Do not build native mobile apps, mobile widgets/push, phone keyboard controls, mobile offline queues, or the iOS/Android simulator/device-lab subsystem. Desktop responsive layouts and viewing ordinary media files remain in scope. Do not remove existing shared runtime code merely because mobile consumes it upstream.

Functional parity means working behavior through contracts, persistence, server/provider runtime, client state, user entry points, and failure handling. Equivalent existing Tabs behavior counts as implemented; different component names do not mean a feature is missing. Use Tabs branding and design conventions. T3 marketing, trademarks, analytics collection, public service credentials, and app-store distribution are not product features to copy.

## Verified references and source pin

Original Tabs checkout: `/Users/rushil.dev/Desktop/tabs`.

Tabs implementation baseline: `117643e40e33ee3a897bd00571186f9c674c25a7`, currently checked out on `main`; product package version observed was `1.3.34`.

Upstream source: `/Users/rushil.dev/Desktop/tabs/t3code-main`.

Upstream repository: `https://github.com/pingdotgg/t3code.git`.

Pinned upstream commit: `76d3c96fd5b89cca2c06aeaceaea16100c75084a`.

The original archive remains at `/Users/rushil.dev/Desktop/tabs/t3code-main-downloaded-2026-10-04`. Use the Git checkout, not the older archive, as implementation authority. Record the pin and keep it fixed during this task. If the checkout advances, inspect the pinned commit in a separate reference checkout rather than resetting another process's files. Do not chase a moving upstream during the migration.

Read these local research documents before building:

- `/Users/rushil.dev/Desktop/tabs/tabs-app/docs/T3_COMPARISON_2026-10-06.md`
- `/Users/rushil.dev/Desktop/tabs/tabs-app/docs/T3_PARITY_RESEARCH_ADDENDUM_2026-10-06.md`

The earlier `tabs-app/docs/T3_PARITY_AUDIT.md` is historical evidence, not the completion checklist. Some named files and statuses are stale. In particular, browser importing now exists, service install/restart are not registered, and provider usage labels do not prove historical usage ingestion.

## Work isolation and operational rules

This task has no dedicated worktree yet. Inspect current Git/worktree state before creating one. The proposed task branch is `codex/t3-parity-goal-2026-10-06`, and the proposed new worktree is `/Users/rushil.dev/Desktop/tabs/.worktrees/t3-parity-goal-2026-10-06`, starting at the verified Tabs baseline above. If either name already exists, inspect it; reuse only if it belongs to this exact task and contains no unrelated work. Otherwise use a new unique task name and record the actual path and branch.

Do not implement in the original `main` checkout. Existing Extensions/Exchange, audit, updater, and Code-OSS sync worktrees belong to other tasks. Do not modify them or use their branches as the parity base. The initial research files are untracked artifacts in the original checkout; copy them into your own task documentation if needed. Do not assume untracked reference folders appear automatically in a new worktree.

This prompt authorizes local, reviewable commits on the dedicated task branch. It does not authorize pushing, opening a PR, merging, changing the original `main` branch, publishing installers, deploying a site/relay, or changing production infrastructure. Return the branch tip and diff base for local review. If a PR is later requested, use the explicitly agreed review base and attach the created PR; do not guess an unrelated Extensions branch.

Read the applicable `AGENTS.md`, `.agents/AGENTS.md`, architecture and safety instructions in the actual checkout. Resolve stale absolute references to their current workspace equivalents and report a genuinely missing required document. Apply the accessibility, hygiene, unit-test, fixture, and tool-rename instructions when their triggers apply. Preserve current attribution/licensing when adapting upstream code.

Keep the Bun/Turborepo workflow. Do not replace it with T3's package-manager setup. Necessary, minimal dependency changes for these requirements are authorized by this prompt, but document each reason, keep Effect versions consistent, and synchronize configured reference subtrees when required by repository instructions. Do not run blanket upgrades or add a second lockfile. Adapt upstream APIs to Tabs' installed versions whenever practical.

Existing feature behavior must be preserved. This prompt authorizes replacing runtime implementation pieces specifically required for V2 parity after migration and regression coverage exist. It does not authorize unrelated refactors or deleting provider integrations, user records, or features. Preserve recoverable legacy data and read access where some record cannot be converted losslessly.

Never use destructive Git cleanup or reset commands. Do not edit live user data or run test servers against real `~/.t3`, Tabs, Codex, Claude, or Antigravity profiles. Use separate development state and copied/synthetic fixtures. Live provider checks may use already available authenticated accounts without changing them; if an account or OS permission is missing, record the exact external dependency and continue independent work.

Launch Tabs for interactive verification through `bun run dev:desktop`, never by treating a plain browser tab as the desktop app. Keep only one task-owned application instance running; inspect existing processes and reuse an appropriate instance or choose a nonconflicting test setup. Stop only processes whose ownership you established, preferably PIDs captured at launch. Do not kill unrelated apps or processes by broad name patterns. Preserve fat-installer Code-OSS bundling and the native desktop runtime boundary.

Set `TABS_HOME` or the dev runner's `--home-dir` to a dedicated directory inside the task worktree, and record the selected server/web ports. Do not rely on the default live `~/.tabs` directory. A new worktree does not contain ignored compiled Code-OSS assets: for app-only changes, an already compiled reference runtime can be selected read-only through `TABS_CODE_OSS_BUILD_DIR=/Users/rushil.dev/Desktop/tabs/tabs-code-oss`. If runtime source changes are required, build and validate the task's own runtime instead. Do not modify the shared reference build as a testing shortcut.

## Phase 0 — establish the authoritative requirements ledger

Before implementation, create `tabs-app/docs/t3-parity/requirements.md` in your task worktree and a persistent progress record. Give every requirement a stable ID. For each record include: observable behavior, upstream file/symbol at the pin, current Tabs equivalent, initial status, dependencies, target implementation, acceptance tests, and final evidence.

Inventory all applicable `docs/user`, relevant `docs/internals`, web routes/settings/commands, desktop IPC, provider drivers/adapters, RPC/MCP contracts/toolkits, migrations, usage readers, browser/file surfaces, and upstream tests. Trace UI entry points through the active runtime. Exclude stale backups, incomplete reference ports, generated types without handlers, and unreachable modules as implementation evidence. Record each excluded mobile feature with its rationale.

Use this prompt's phases as the minimum scope, not a ceiling. Add newly discovered non-mobile behaviors to the ledger and implement them within the objective. Do not quietly shrink the goal, invent parity percentages, or label externally blocked functionality complete. Mark existing working equivalents and validate them rather than duplicating them.

Run baseline validation in the isolated checkout and record pre-existing failures. Produce a concise architecture/migration plan, then proceed with implementation. Routine choices that meet the stated invariants do not require approval. A missing decision that materially changes the product or requires destructive data loss does require a clearly described decision request; continue unrelated work while waiting.

## Phase 1 — V2 orchestration, persistence, and compatibility

References: T3 `apps/server/src/orchestration-v2/`, its persistence migrations, `packages/contracts/src/orchestrationV2.ts`, `orchestrationDispatch.ts`, `applicationEvent.ts`, `rpc.ts`, and client shell/thread projections. Compare Tabs' active engine/reactor/projector under `apps/server/src/orchestration/`, its projection snapshot queries, command invariants, provider service, and client-runtime state.

Implement the current orchestration behavior as Tabs-owned runtime infrastructure. Do not bolt a second incomplete task system onto the old one. A staged migration is acceptable, but one authoritative runtime must own a migrated thread's commands, runs, provider bindings, requests, queues, and recovery.

Required invariants:

- Persist command receipts, ordered events, run/request state, effect intent, and recovery identity. Stable client request IDs must make retried logical commands idempotent.
- Durable effects may be retried after interruption. Prevent duplicate provider turns, task creation, scheduled runs, or completion messages through identities and reconciliation; do not claim exactly-once external execution without provider support.
- A pending request has one effective resolution. Late answers, duplicate responses, cancellation, disconnect, timeout, and parent stop must produce deterministic outcomes.
- Stop/archive/settle/delete/switch/restart races must not resurrect canceled work or route old provider events into a new run.
- Distinguish completed, failed, interrupted, limited, waiting for input/approval, and background work. Show the actual state rather than a spinner inferred only from an open socket.
- Preserve Tabs-specific providers and text-generation capabilities. Each adapter declares its actual capabilities. Unsupported operations have explicit user-facing behavior.
- Introduce explicit protocol/version negotiation for incompatible runtimes; reject an unsafe mixed-protocol connection with actionable host-specific guidance.
- Preserve event replay, reconnect, checkpoints, compaction queues, draft state, and completed output. Avoid unbounded live event/backlog work.

Migration must be transactional/restartable and tested on realistic copies of Tabs records: projects, threads, full message text, attachments, provider/model/instance choices, permission modes, branches/worktrees, pins/order/snooze/settlement/archive, linked PRs, queued input, drafts/stashes, and settings. Preserve stable IDs or maintain explicit mappings. Do not import upstream's lossy migration as permission to discard Tabs checkpoints, activities, approvals, plans, or diffs. Convert supported records; retain legacy inspection for others and document the boundary.

Preserve browser profiles and Code-OSS project state. Test repeated/interrupted migration, malformed legacy records, large transcripts, and recovery without duplication. Define backup and rollback semantics, including what happens to writes made after upgrade; do not run two mutable runtimes against one database as a fallback.

## Phase 2 — provider switching, conversation forks, and worktree transfer

References: T3 `ContextHandoffService.ts`, `ContextHandoffBudget.ts`, `ProviderSwitchService.ts`, `ThreadForkService.ts`, worktree MCP service, and `docs/user/portable-handoffs.md`.

- Allow compatible account changes and cross-provider continuation from an existing thread. Replace the current provider lock with capability-aware transitions, not a UI-only unlock.
- Preserve native history when a provider supports it; otherwise transfer attributed, ordered, budgeted conversation context. Preserve the user's current request intact. Do not transfer hidden reasoning or private tool state as public conversation.
- Account for target model capacity, current context, instructions, tools, and attachments. Keep retrieval references for omitted history; allow the agent to page that history. Fail visibly if the input cannot fit.
- Support forks at the chosen conversation point, including local checkout and a new/existing worktree. Correctly select destination cwd and resume identity; never resume in the source directory by accident.
- Implement lineage/details and merge-back/transfer semantics shown upstream. Distinguish importing conversation context from merging Git changes. Preserve user changes and surface conflicts.
- Implement thread/worktree handoff status and cancellation, setup script progress, safe default-branch refresh, configurable worktree location/naming, and returning to an existing worktree.

Test Codex/Claude and every additional adapter affected, with native and portable cases, unsupported forks, too-small context windows, failed/partial turns, account isolation, concurrent switches, and dirty worktrees.

## Phase 3 — delegation and agent access to the application

References: T3 MCP registration and toolkits `orchestrator`, `thread`, `worktree`, `project`, `environment`, `attachment`, `pullRequests`, `preview`, `previewControls`, and `html`. Inspect their services, descriptions, schemas, and test suites at the pin.

Provide corresponding Tabs tools for:

- Capability/model discovery; task delegation/status/cancel; ordinary thread launch and batch creation.
- Thread list/search/read/send/wait/interrupt/configure/organize, fork/merge/transfer, metadata and PR linking.
- Queue list/read/edit/cancel/reorder/promote-to-steer; pending request list/read/respond.
- Project list/read/create/update/clone and permission-aware deletion; environment information/preferences.
- Worktree list/status/handoff; attachment preparation/send/discard; PR linking and watch/unwatch.
- Scheduling, task-specific secrets, browser operations, and HTML replies defined below.

Use Tabs namespaces while preserving any existing public tool names/aliases. Update registration, injected instructions, adapter bridges, client presentation, and tool summaries together. Register tools in active provider sessions; adding definitions without exposing them is incomplete.

Delegation creates durable app-owned child tasks with explicit provider/model/options, parent ownership, state, results, and completion delivery. The parent must not continuously poll. Distinguish app tasks from native provider subagents and ordinary top-level chats. Route child approvals/input through the correct parent, and propagate stop/cancellation without claiming a request has already stopped a process. Inspect the upstream limitations on direct messaging of delegated child threads.

Checks belong on the server: caller environment/thread/session identity, target permissions, membership and resource ownership, allowed runtime/interaction modes, and no escalation beyond the caller. Keep authorization separate from untrusted instructions or content retrieved from another thread. A tool capable of sending a message is not blanket authorization to message unrelated chats. Preserve user-authorization requirements in tool descriptions and runtime enforcement where representable.

Bound list/read/wait outputs and support history cursors. Stable request IDs prevent duplicate child creation and repeated delivery. Test cross-provider children, parent stop, completion during an active turn, completion after disconnect/restart, duplicate delivery, approval races, permission rejection, native children, and stale thread IDs.

## Phase 4 — scheduled follow-ups, webhooks, goals, and recovery

References: T3 `scheduledTasks/`, scheduling runtime, `UsageLimitRecoveryWorker.ts`, restart/continuation services, `ThreadAutomationsPanel.tsx`, scheduled-task settings, and goal controls in ChatView.

- Create/edit/list/pause/resume/delete/run-now recurring tasks with project/environment/model/workspace/permissions, timezone semantics, next run, outcome, and per-thread binding. Support the upstream schedule forms and expose them through settings, thread controls, and MCP.
- Make execution server-owned and durable while UI clients are closed. Claim scheduled occurrences atomically, avoid overlap/duplicate runs, and implement upstream catch-up/missed-run policy explicitly.
- Implement tokenized webhook triggers, URL rotation/revocation, template substitution, signature verification, bounded inputs, recent deliveries and outcomes, and stale-delivery policy. Test invalid signatures, replay/idempotency, malformed bodies, rotated URLs, permission limits, and offline hosts.
- Integrate offline webhook holding with existing relay infrastructure where supported, with the upstream opt-in/privacy behavior. Do not pretend a local endpoint supplies public routing or invent hosted credentials. Implement the local/contract path and report any exact deployment dependency separately.
- Implement limited-state explanations, manual Resume, Resume at reset/cancel, optional automatic resume, and independent snooze-until-reset. Store the recovery identity; reset after restart must not resend an occurrence twice. New user input, archive, settlement, or cancellation invalidates the appropriate pending continuation.
- Implement opt-in “continue threads after restart” with saved resume state, restart background-work accounting, queue ordering, and explicit unsupported-state notices. Recovery must not create an uncontrolled retry loop.
- Surface native Codex/Claude goals, status/progress, appropriate pause/resume/clear behavior, and accurate Stop semantics. Respect provider differences instead of simulating native goals for unsupported providers.

Use fake-clock tests for DST/timezone boundaries, clock changes, overdue occurrences, multiple workers, process interruption between claim and execution, and rate-limit resets. Test webhook delivery and recovery independently of an open browser.

## Phase 5 — T3-style companion panel inside Agents

This is a mandatory product requirement, not an optional substitute for full-workspace tool buttons.

References: T3 `rightPanelStore.ts`, `rightPanelLayout.ts`, `RightPanelTabs.tsx`, `RightPanelSheet.tsx`, panel layout controls, preview panels, files panels, terminal surfaces, diff surfaces, and PR panels. Compare Tabs `WorkspaceShell.tsx`, `ChatView.tsx`, `ThreadTerminalDrawer.tsx`, browser manager/automation host, Git surfaces, native Code host and desktop IPC.

Implement a collapsible, resizable, tabbed companion panel alongside Agents chat. Support inline and compact overlay presentations according to available desktop width, a useful maximized view, open/close controls, persisted size/state, and keyboard navigation. Tabs' existing toolbar and Code/Browser/Git/Terminal surfaces remain usable.

Include:

- Browser tabs, profile selection, navigation/address bar, loading/error/retry, mute/audio state, close/close-others/close-to-right/close-all, preview controls and agent interaction.
- Files explorer and individual file/attachment tabs.
- Terminals with current supported tab/split controls, output and terminal-to-composer context.
- Thread/worktree/checkpoint diffs, file tree, inline review context, and editor handoff.
- Individual PR details and linked PRs, including checks, reviews, stacks and actions supported by the selected forge.

Scope panel preferences and resource references by environment/project/thread. IDs originating on one server are not globally unique. Switching threads must restore their own panel state without opening the wrong filesystem, profile, terminal, or PR. Restore gracefully when a referenced resource has been deleted or its environment is offline.

Share authoritative browser/terminal/Git/filesystem services and commands with the top-level tools. When two entry points represent the same logical browser or terminal, they must refer to the same resource and preserve its state. Do not spawn duplicate servers/PTYs or create a second uncoordinated browser manager. Reparent or activate native views through one owner rather than mounting the same native surface twice. Separate resources may remain separate when intentionally created as new tabs; make that behavior explicit.

Preserve native `WebContentsView` process/profile isolation and Code-OSS embedding. Never convert the Code tool to T3's webview or an iframe. Correctly handle native view bounds, resize/DPI, clipping, overlays/dialogs/menus, focus, active-tool changes, panel maximization, hidden-view lifecycle, strict-mode remounts and process crashes. A hidden browser must not receive accidental clicks or cover a dialog.

Reuse Tabs' visual system, typography, theme and icons. The T3 panel is the behavioral/layout reference; this instruction authorizes the necessary panel design inside Agents, not an unrelated redesign of the shell. Implement usable empty, disconnected, permission-denied, loading and failure states. Test keyboard-only operation and meaningful screen-reader labels; avoid native browser alert/confirm/prompt dialogs.

## Phase 6 — files, media, browser, and context parity

- Files: lazy tree expansion, search/refresh, reveal current file, copy path/reference, drag/add-to-chat, contextual open/reveal actions, source viewing and editing, line ranges/comments, safe save and conflict detection.
- Preview Markdown, delimited tables, HTML/PDF, images, audio/video and stored attachments. Support source/rendered switching, download/open externally where applicable, and opening a selected file/line in Code-OSS. Keep playback and position across fullscreen transitions.
- File changes made by an agent or Code-OSS must refresh read views. Never overwrite unsaved panel edits after an external change; expose a revision/conflict choice. Preserve correct encoding/newlines and binary/oversized-file behavior.
- All path, asset and write operations must enforce the actual thread/worktree/environment scope. Guard traversal, symlink escapes, wrong-server access and stale asset identities. Host files outside the workspace require the existing explicit access policy; do not silently widen it for convenience.
- Browser: local-server discovery/opening, viewport/device-size presets that do not require native mobile apps, resize and appearance control, element picking/annotations, screenshots, picture-in-picture where upstream supports it, crash recovery and browser automation readiness.
- Add real browser video recording/start/stop/artifact upload, distinct from Tabs' existing reproduction-step recorder. Handle cancellation, process loss, privacy, resource bounds, stale recording IDs, and attachment association.
- Preserve and validate existing cookie import/profile behavior, domain selection/consent, cancellation and platform limitations. Do not bypass Chromium app-bound encryption or OS permissions to claim parity.
- Composer context: movable inline file/dir/line-range, terminal, review, preview annotation, PR and thread references at the cursor; appropriate image chips/shelf, inspection/navigation, clipboard serialization, cross-draft/environment restoration, undo, and stash persistence.
- Thread references retrieve history on demand; attaching one does not authorize sending messages to it. Implement `#` PR lookup/search and `@` thread lookup/drag where upstream offers them.
- Question answers: separate per-question text/options/file attachments, upload completion/retry, remote destination identity, retained draft after failure, sent-history visibility and rollback/delete cleanup. Preserve the ordinary prompt draft.
- HTML visual replies: agent preview/publish tools, sandboxed inline rendering, current-theme support, embedded local assets, screenshot validation, expand/source/save controls and artifact lifecycle. Scripts cannot access Tabs session/storage/Electron bridge or privileged app origins.
- Secrets: dedicated agent request UI, masked non-transcript entry, safe temporary storage/reference consumption and expiration/cancellation. Secret contents must not leak to ordinary timeline text, logs, diffs, analytics or screenshots in the handoff.

## Phase 7 — complete usage and limits, with Antigravity as a required case

Current verified gap: Tabs' `apps/web/src/components/usage/usageProviders.ts` includes Antigravity, but `apps/server/src/usage/UsageService.ts` resolves historical transcript roots only for Claude and Codex. Do not treat the existing icon/table row or runtime token meter as completion.

References: T3 `usage/UsageService.ts`, `antigravityUsageReader.ts`, `opencodeUsageReader.ts`, `cursorUsageReader.ts`, transcript/caching/aggregation code, usage contracts, providers' usage-limit readers, reset-credit coordinator, and `docs/user/usage.md`.

- Ingest Antigravity's real local conversation SQLite/protobuf usage metadata and Tabs-managed profiles. Include configured instances and explicit custom data roots; read live databases read-only with bounded, cancellation-friendly work and deterministic deduplication.
- Match upstream historical coverage for Claude, Codex, Grok, OpenCode and Cursor; preserve Tabs' additional provider support and ingest actual data for them where available. Never manufacture tokens from prompt text or assign unsupported providers fake zeros as if measured.
- Discover account-specific homes/environment overrides, disabled accounts with retained history, shared/shadow homes, and canonical paths. Deduplicate the same directory/account across instances and environments without conflating different machines.
- Aggregate day/hour buckets using the requested reporting timezone, time filters and stable source identity. Handle growing/rotated files, database retries, malformed records, cumulative usage updates, interrupted scans, cache persistence and force-refresh.
- Show provider/model/environment breakdowns, token categories/cache savings, reasoning-as-output-subset, estimated versus provider-reported/unpriced cost, speed premiums where available, model-price overrides/remapping, and source coverage notices. Cost estimates are not subscription invoices.
- Implement environment filters and progressive/partial results. Offline, unreadable, missing and genuinely empty sources must be distinguishable; one failed environment cannot erase successful totals.
- Complete subscription-limit coverage for the providers upstream actually supports, pooled account/window deduplication, plan/reset/credits details, guarded reset redemption, refresh throttling, `/usage-limits`, and usage hub behavior.
- Antigravity historical usage is mandatory. Do not invent an Antigravity quota endpoint: show authentic quota/window data only if supported by the actual runtime/source, otherwise clearly state unavailable. Historical usage and remaining subscription allowance are different metrics.
- Persist price edits to selected environments with mixed-value indication, per-destination outcome and retry-failed-saves behavior. Preserve unknown-model tokens even when pricing is unavailable.

Test sanitized SQLite/protobuf and transcript fixtures, unknown model IDs, retries, multiple roots, same source through two hosts, distinct machines with identical paths/hostnames, timezone boundaries, token double-counting, source errors, and pricing changes. Demonstrate a real available Antigravity history scan without printing credential values or conversation contents. If no real profile exists, include fixture proof and mark that live check unverified.

## Phase 8 — provider onboarding, capabilities, auth, and maintenance

- Generic ACP Registry search/add/remove and arbitrary local ACP commands: distribution/version resolution, checksum verification when published, managed installation, environment compatibility, literal argument handling, auth browser/terminal flow, live models/options/modes/skills, supported native-session list/import, and rollback/session reset behavior.
- ACP v2 features with explicit v1 negotiation/fallback. Preserve Tabs' built-in ACP integrations and existing user instance/session identities; do not force migration to a generic entry by deleting them.
- Pi integration: native install discovery, model/thinking catalog, skills/extensions/dialogs, context reporting, native session resume/fork/rollback and permission hook semantics. Unsupported native extension behavior must be visible and accurately documented.
- OpenCode version probing and correct 1.x versus 2.x runtime ownership, external-server support, session-scoped MCP credentials and permissions, updates and cleanup. One instance's session must not access another thread's MCP entry or grant another supervised session permanent permissions.
- Managed ChatGPT/Codex connection: actual setup flow, managed runtime/home, multiple accounts, callback ownership for local/remote environments, disconnect/reconnect and usage-management links. Inspect external registration requirements; do not fabricate OpenAI client IDs, consent capabilities or public callback services.
- Preserve installed Codex CLI login and shared/shadow-home account workflows. Account isolation must hold across model discovery, turns, helpers, refresh, sign-out and removal.
- Antigravity profile isolation, auth callback routing, skill discovery, managed installation/version leases and accurate empty/error catalog behavior. Health checks must not start login flows, run hooks or consume user work as an unintended side effect.
- Provider install/auth/update/remove flows must follow the actual owning installer and instance/environment. Update-all should target supported outdated installations, avoid shared-install races, preserve active process leases, and report each result.
- Verify native goals, compaction, async questions, app permission requests, structured feedback, subagents and background tasks for installed provider versions. Generated schema support without an active handler/UI is not completion.

Test auth cancellation/expiry, wrong callback/environment, profile collisions, disconnect during install, stale model catalogs, authoritative empty catalogs, provider-version mismatch, unsupported operations, and permission isolation. Preserve all Tabs-only providers and current text-generation selectors.

## Phase 9 — thread/sidebar and project behavior

- Projectless threads with durable scratch folders and correct absence of Git controls. Deleting a conversation must follow the documented policy for its generated files.
- Background submission and multi-model submission, each with the intended independent thread/worktree, stable draft defaults and failure reporting.
- Server-owned active/pinned ordering, cross-section drag/drop, settle/unsettle/wake actions, bulk selection, custom snooze, per-thread auto-settle override, optional working section, undo and correct scroll/focus behavior.
- PR/inactivity settlement rules that do not hide live work, unresolved requests or newly resumed conversations. Safe idle-terminal behavior and server-side operation when clients are closed.
- Accurate activity/work-log grouping, elapsed/status display, native/app child relationships, and thread details. A cancellation request or wait result is not proof of successful completion.
- Search across threads, archived work and linked PRs with correct environment/project identity, highlighting and navigation. Preserve existing Tabs project grouping and commands.
- Project creation/clone/publish/import/setup scripts, progress/cancellation, managed folders, repository identity, icons, default branches, actions and inherited defaults. Preserve existing Tabs-specific project-file support while adapting applicable T3 repository configuration semantics.

## Phase 10 — settings, remote environments, source control and maintenance

- Complete project/environment settings scope: inheritance source/chain, reset, mixed values, bulk edits to connected environments, per-environment provider/diagnostics pages, offline results and schema compatibility. Preserve existing client-local preferences.
- Direct/LAN/SSH/Tailscale/managed relay connection behavior, pairing/revocation, multiple routes to one environment, route failover and reconnect/wake. Reuse Tabs identities and transport rather than creating duplicate machines for each route.
- Resource-aware new-thread load balancing with preferences/manual override, unavailable metrics and stable selection once a branch/worktree is chosen.
- Desktop-managed WSL backend/environment lifecycle and path mapping on Windows; shared contracts mentioning WSL are not an implementation. Keep Code-OSS remote extensions distinct from app-owned backend management.
- Unified safe storage policies: custom worktree root, age/merged/unchanged/deleted-thread cleanup and per-project overrides; retention for browser captures and rotated logs. Protect active/shared/dirty/unmanaged worktrees, ignored files, live terminals and unreadable roots. Test eligibility without deleting real user data.
- Complete CLI serve/status/stop, service install/repair/status/restart/uninstall, version/channel update/relaunch, and applicable theme commands. Use the actual supported OS service managers and package/install ownership. Protect saved data and expose disruption/restart decisions.
- Protocol-aware remote updates, rollback on supported failed updates, correct target-host guidance and restart continuation. Preserve Tabs' updater work; do not import unrelated task branches or publish release artifacts.
- GitHub/GitLab/Bitbucket/Azure DevOps parity plus Forgejo/Gitea. Retain Tabs' existing richer forge behavior. Cover PR templates, list/search/filter, create/edit/draft, reviews/comments/reactions/reviewers/labels/checks, merge policy and stacks where the forge supports them.
- Persistent files-viewed progress, multiple linked PRs, agent watch/unwatch and correct thread context/settlement. Feature availability follows actual forge capabilities and permissions.
- Themes/custom import/export/environment defaults, accessible diff palettes, fonts/motion, configurable keyboard commands/contexts, notifications and OS badges, command-palette focus/precedence. Preserve Tabs defaults where an upstream shortcut conflicts with an existing product command; expose equivalent configurable commands.
- Expand SnapShots to the active-window workflow: shortcut/setup, app/window metadata, optional accessibility content, pending capture persistence, direct draft insertion, customization/feedback and supported platform behavior. Missing platform permission produces a useful state, not a silent failure.

Public hosting, managed relay secrets, OAuth registrations, signing/notarization, and missing OS hardware may be external dependencies. Implement and test all local/integration contracts possible; report exact remaining dependencies. Do not silently omit a whole feature family because one external path is unavailable.

## Phase 11 — performance, terminal bounds, accessibility and regression protection

Bring over applicable upstream improvements in bounded shell/thread snapshots, cursor-paged HTTP history, sequence-resumed live streams, archived history loading, incremental rendering/highlighting, turn/tool log budgeting, and request latency/resource attribution. Preserve Tabs' existing stream coalescing and timeline optimizations; measure before replacing a working equivalent.

Keep terminal scrollback bounded by lines **and bytes**, including a huge single line, restored history and reconnect output. Preserve ANSI/Unicode/chunk semantics, streaming output, labels, split sessions, primary-selection paste, and process lifecycle. Async startup must not steal focus from the composer after the user returns to typing.

All added surfaces require keyboard-only operation, explicit ARIA roles/names, visible focus, shortcut precedence, focus return, reduced-motion behavior and theme contrast. Native browser/Code-OSS focus cannot bypass a modal or trigger an unrelated shortcut. Test app activation, detached Agents windows if supported, layout restore and minimized/hidden native surfaces.

Preserve existing Code, Browser, Git, Terminal, Testing, project/session, provider, updates and privacy behavior. Add meaningful regression coverage for changed paths, not tests that merely mirror helper implementations.

## Validation and definition of completion

Work in dependency order and commit reviewable phases. Keep the ledger and progress record current across long runs/context resets. Do not leave a feature “done” until its contract, owner, persistence, UI/tool entry point, and failure paths are connected.

Run relevant focused unit/integration/browser/desktop tests as each phase changes, then the required complete validation. From your actual `tabs-app` directory verify the available commands and run:

- `bun run typecheck`
- `bun run lint`
- `bun run fmt:check`
- `bun run test`
- `bun run build`
- `bun run test:desktop-smoke`
- Relevant `apps/web` browser tests through the existing `test:browser` script.
- Repository-required `vp check` and `vp run typecheck` where available/configured. If unavailable, record that fact and the actual equivalent checks; do not label an unrun command passed.

Run hygiene for edited VS Code/runtime files according to the applicable skill. Verify contract/provider/client-runtime consistency. If necessary build tools, provider binaries, credentials or a platform are absent, record the exact limitation and validated substitute coverage. Do not disable tests, weaken assertions, add blanket skips, suppress type errors or fabricate pass totals. Fix regressions introduced by your work. An unresolved baseline failure must remain visible.

Interactive acceptance must use the real Electron app with isolated data and demonstrate at least:

1. Upgrade of a populated legacy fixture; old histories and resources remain accessible after restart.
2. Existing provider thread continuation and cross-provider switch with context, then a history-preserving fork/worktree flow.
3. Delegated task progress/completion, parent stop and a routed approval/input request.
4. A scheduled follow-up surviving UI closure/server restart, rate-reset continuation, and a local verified webhook delivery.
5. Agents companion panel with Browser/Files/Terminal/Diff/PR tabs while the main tools continue to work; no duplicate PTY/browser state or native overlay bugs.
6. Source/media file preview, save conflict, Code-OSS line handoff, file/terminal/review/thread context and a question attachment.
7. Real usage display for available Antigravity history plus multi-root/source deduplication, partial environments and true unavailable data.
8. Generic ACP/Pi/OpenCode2 paths to the extent binaries are available, with capability/error behavior for unavailable providers.
9. HTML reply sandbox isolation and a secret request without transcript leakage.
10. Reconnect, protocol mismatch guidance, queued input, bounded terminal/history output, keyboard navigation and preserved Tabs-only features.

Use sanitized fixtures/replays for deterministically testing provider/platform cases that cannot be run live. Clearly label fixture, mock, protocol replay, real Electron and real-provider evidence. Screenshots alone do not prove backend behavior. Do not claim full parity while any applicable requirement is partial, failed, blocked or unverified.

## Required handoff to the user and Codex

Create these artifacts in the task worktree:

- `tabs-app/docs/t3-parity/requirements.md`: final requirement-to-evidence ledger, including discovered requirements and exclusions.
- `tabs-app/docs/t3-parity/architecture-and-migration.md`: runtime ownership/state transitions, data migration, protocol compatibility, isolation and rollback.
- `tabs-app/docs/t3-parity/walkthrough.md`: user-facing workflows with screenshots/recordings and exact reproduction steps.
- `tabs-app/docs/t3-parity/validation.md`: exact commands, cwd, exit status, counts where available, log paths, fixture-vs-live coverage, before/after performance observations and unresolved failures.
- `tabs-app/docs/t3-parity/codex-handoff.md`: review entry point, actual worktree/branch/base/tip SHA, ordered commits, changed subsystem/file index, dependencies/migrations, review hotspots, known defects, external blockers, remaining platform/provider checks and safe rollback steps.

Commit source and documentation in coherent units on the isolated branch; include all required new files. Do not leave temporary debugging or test processes behind. Report final Git status, exact task-owned processes stopped, and any intentionally retained artifacts. Preserve unrelated files.

Your final response must separate **implemented**, **tested**, **unverified**, and **blocked** work. Include the branch tip/diff base and handoff path so Codex can inspect the actual code, not only your narrative. If something is blocked by a real external dependency, complete independent work, describe exactly what is needed, and leave that requirement open. Do not substitute a success claim for the missing evidence.

Do not merge, push, deploy, publish or release. The next step is independent Codex review and repairs when the user supplies your walkthrough and branch details.
