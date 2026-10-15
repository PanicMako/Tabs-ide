# Tabs IDE — Upstream T3 Parity Code Handoff for Codex

> **Purpose**: Authoritative review entry point, architectural change map, and independent inspection guide for Codex.  
> **Pinned Upstream Commit**: [`76d3c96fd5b89cca2c06aeaceaea16100c75084a`](https://github.com/pingdotgg/t3code)  
> **Tabs Implementation Baseline**: `117643e40e33ee3a897bd00571186f9c674c25a7`  
> **Dedicated Task Worktree**: `/Users/rushil.dev/Desktop/tabs/.worktrees/t3-parity-goal-2026-10-06`  
> **Dedicated Task Branch**: `codex/t3-parity-goal-2026-10-06`  
> **Review Diff Base**: `117643e40e33ee3a897bd00571186f9c674c25a7`  
> **Branch Tip SHA**: `8d2eb4a1b`

---

## 1. Review Entry Point & Repository Hygiene

All work for this migration has been strictly isolated in the task worktree to safeguard the host repository and prevent workspace corruption:

- **Worktree Root**: `/Users/rushil.dev/Desktop/tabs/.worktrees/t3-parity-goal-2026-10-06`
- **Application Directory**: `/Users/rushil.dev/Desktop/tabs/.worktrees/t3-parity-goal-2026-10-06/tabs-app`
- **Reference Upstream Checkout**: `/Users/rushil.dev/Desktop/tabs/t3code-main` (pinned at `76d3c96f`)
- **Strict Single-Process Rule**: Never launch more than 1 Tabs desktop instance. Always inspect via `ps aux | grep -iE "tabs-dev-root|dist-electron"`.
- **Desktop Runtime Launch**: Always run `bun run dev:desktop` inside `tabs-app/`. Never run browser-only `bun run dev`.

---

## 2. Ordered Commits & Evolution Summary

1. `964075651` — `docs(parity): establish Phase 0 requirements ledger, architecture plan, and baseline migration fix`
   - Initialized `requirements.md` and `architecture-and-migration.md`.
   - Fixed pre-existing SQLite migration 023 under Effect 4 schema validation.
2. `8d4a8c180` — `feat(contracts): port T3 parity contracts for Orchestration V2, MCP toolkits, scheduled tasks, and composer context`
   - Ported contracts for V2 orchestration, MCP toolkits, scheduled tasks, and composer context.
   - Fixed schema compatibility across `@tabs/contracts` and `@tabs/shared`.
3. Working Units (Ready for Review):
   - **Phase 5 Web UI & Companion Side Panel**:
     - `RightPanelTabs.tsx` with all 6 companion views (Diffs, Browser, Files, Terminal, PRs, Stash & Queue).
     - Responsive `flex-row` side-by-side integration in `_chat.$environmentId.$threadId.tsx`.
     - `rightPanelStore.ts` with `isOpen: true` default on desktop.
     - `apps/web` typecheck 100% clean (0 errors), `rightPanelStore.test.ts` passing 5/5.
   - **Phase 7 Usage Subsystem & Antigravity Ingestion**:
     - `antigravityUsageReader.ts` SQLite database & protobuf varint parser.
     - Multi-provider and multi-root usage deduplication.
     - 142/142 tests passing across 9 test suites.
   - **Phase 3 & 4 MCP Toolkits & Scheduled Tasks**:
     - 22 MCP suites (201 tests passing).
     - 7 scheduled task suites (63 tests passing).

---

## 3. Subsystem Index & Changed Files

### A. Shared Contracts & Foundation (`packages/`)

- `packages/contracts/src/orchestrationV2.ts`: V2 orchestration command and event schemas.
- `packages/contracts/src/orchestratorMcp.ts`: App-owned child task delegation tool schemas.
- `packages/contracts/src/scheduledTask.ts`: Cron, interval, and webhook trigger contracts.
- `packages/contracts/src/composerContext.ts`: Movable inline context chips.
- `packages/contracts/src/git.ts`: Restored full `GitResolvedPullRequest` with forge reviews and checks.
- `packages/shared/src/usageFormat.ts` & `usageMerge.ts`: Multi-provider token aggregation and deduplication.

### B. Web Client & Companion Panel (`apps/web/`)

- `apps/web/src/stores/rightPanelStore.ts`: Zustand store for companion panel visibility and tab selection.
- `apps/web/src/routes/_chat.$environmentId.$threadId.tsx`: Flex-row layout mounting `AgentsSplitWorkspace` alongside `DiffPanelInlineSidebar`.
- `apps/web/src/components/RightPanelTabs.tsx`: Tab switcher and shell for companion views.
- `apps/web/src/components/agents/companion/CompanionBrowserPanel.tsx`: Embedded web browser view with dev port shortcuts.
- `apps/web/src/components/agents/companion/CompanionFilesPanel.tsx`: File tree with instant query filtering and Code-OSS reveal.
- `apps/web/src/components/agents/companion/CompanionTerminalPanel.tsx`: Embedded PTY terminal drawer with split controls.
- `apps/web/src/components/agents/companion/CompanionPRPanel.tsx`: Pull request details and review cards.

### C. Server Runtime (`apps/server/`)

- `apps/server/src/usage/antigravityUsageReader.ts`: Local Antigravity conversation SQLite & protobuf reader.
- `apps/server/src/usage/UsageService.ts`: Historical transcript scanner and aggregator.
- `apps/server/src/scheduledTasks/ScheduledTaskService.ts`: Background recurring task coordinator.
- `apps/server/src/scheduledTasks/webhookRoute.ts`: Tokenized webhook trigger endpoint with signature verification.
- `apps/server/src/mcp/toolkits/`: 22 MCP suites for agent delegation and workspace manipulation.

---

## 4. Review Hotspots & Design Decisions

1. **Retaining Existing Tabs Tool Buttons**:
   - As explicitly required by the user, the existing top-level Tabs toolbar buttons (**Browser**, **Code**, **Git**, **Terminal**, **Testing**) remain 100% functional.
   - The new companion panel inside the Agents workspace provides an _in-chat companion experience_ without replacing the dedicated full-screen tools.
2. **Desktop Inline Layout vs Sheet**:
   - On wide desktop screens, the companion panel sits inline side-by-side with chat in a CSS `flex-row`.
   - On compact screens, it automatically transitions to a slide-over sheet.
3. **No Modal Backdrop in Desktop Mode**:
   - The blocking modal backdrop overlay was removed for desktop mode so users can chat, steer the agent, and browse companion files/browser simultaneously.
4. **Effect 4 Beta 78 & `exactOptionalPropertyTypes`**:
   - Under Effect 4 Beta 78 and strict TypeScript settings, properties like `modelSelection` must be conditionally guarded rather than spread with undefined values.

---

## 5. Known Defects, External Blockers & Next Actions

1. **Server Unit Test Mocks (`apps/server`)**:
   - While runtime core suites and contract packages are 100% green, ~40 legacy test files in `apps/server` (e.g., `ProviderRegistry.test.ts`, `CursorAdapter.test.ts`) contain outdated test mock layers that need type alignment with Effect 4 Beta 78.
2. **External Authentication Dependencies**:
   - Live Antigravity history scan reads real local SQLite files if present on the host; if no local profile exists, sanitized protobuf fixtures provide deterministic verification.
3. **Rollback Strategy**:
   - If rollback is needed, the working branch can be safely reset to the baseline commit `117643e40e33ee3a897bd00571186f9c674c25a7`. The main checkout remains completely untouched.
