# Tabs IDE — Upstream T3 Parity: Autonomous Babysitting & Execution Prompt for Codex

> **Copy and paste this prompt directly into Codex to begin autonomous babysitting and execution.**

---

````markdown
# TASK: Complete Non-Mobile Upstream T3 Parity for Tabs IDE

You are pair programming with the user to achieve 100% feature and reliability parity between **Tabs IDE** and upstream **T3 Code** (pinned commit: `76d3c96fd5b89cca2c06aeaceaea16100c75084a`).

You must act as an autonomous, detail-oriented senior systems engineer: **babysit, inspect, implement, and verify each remaining task step-by-step** without skipping steps or making unauthorized assumptions.

---

## 1. Environment & Workspace Context

- **Host Repository**: `/Users/rushil.dev/Desktop/tabs`
- **Active Task Worktree**: `/Users/rushil.dev/Desktop/tabs/.worktrees/t3-parity-goal-2026-10-06/tabs-app`
- **Active Task Branch**: `codex/t3-parity-goal-2026-10-06`
- **Reference Upstream Checkout**: `/Users/rushil.dev/Desktop/tabs/t3code-main` (pinned at `76d3c96f`)
- **Base Baseline Commit**: `117643e40e33ee3a897bd00571186f9c674c25a7`
- **Package Manager**: `bun` (monorepo managed with Turborepo: `apps/server`, `apps/web`, `apps/desktop`, `packages/contracts`, `packages/shared`, `packages/client-runtime`, etc.)

---

## 2. Mandatory Rules & Operational Invariants (CRITICAL)

1. **Strict Process Limit (≤ 1 Electron Instance)**:
   - NEVER allow more than ONE (1) instance of Tabs to run at any time.
   - Each Electron + backend launch consumes substantial memory/disk. Multiple instances will freeze the machine.
   - ALWAYS verify before launching:
     ```bash
     ps aux | grep -iE "tabs-dev-root|dist-electron|apps/server/dist" | grep -v grep
     ```
   - If anything appears, terminate only with narrow scoped patterns:
     ```bash
     pkill -9 -f "tabs-dev-root"
     pkill -9 -f "dist-electron/main.js"
     pkill -9 -f "apps/server/dist/index.mjs"
     ```
   - **NEVER** run broad `pkill -f "electron"`, `pkill -f "node"`, or `pkill -f "bun"`.
2. **Desktop Shell Launch Protocol**:
   - The ONLY correct command to run the real app is:
     ```bash
     bun run dev:desktop
     ```
   - NEVER run `bun run dev` (browser-only) expecting it to represent the real application. Native IPC bridges, WebSocket tokens, WebContentsView partitions, and Code-OSS require Electron.
3. **No Destructive Git Commands**:
   - NEVER run destructive commands: `git reset --hard`, `git clean -fd`, `git stash drop`, `git stash clear`.
   - Never alter or wipe uncommitted files outside the explicit task scope.
4. **No Native Browser Popups**:
   - Do NOT use `window.confirm`, `window.alert`, or `window.prompt`. Always use custom accessible components (`useConfirm`, custom modals).
5. **Pre-flight Completion Gate**:
   - `bun run typecheck` (`turbo run typecheck`) across all 12 packages MUST pass with 0 errors.
   - Relevant test suites must pass before declaring any milestone complete.

---

## 3. What Has Already Been Completed (Do NOT Re-do)

1. **Foundational Contracts & Effect 4 Alignment**:
   - `@tabs/contracts` and `@tabs/shared` ported and compiling cleanly with 0 type errors.
   - Contracts unit tests: **823/823 tests pass (56/56 files)**.
   - Shared unit tests: **1,159/1,159 tests pass (84/84 files)**.
2. **Server Orchestration V2 & Core Engine**:
   - V2 durable outbox (`EffectOutbox.ts`, `EffectWorker.ts`), monotonic run tokens, and request lifecycles.
   - Agent MCP Toolkits (22 suites, 201 tests passing).
   - Scheduled tasks & webhook routes (`ScheduledTaskService.ts`, `webhookRoute.ts`, 63 tests passing).
   - Antigravity historical SQLite & protobuf usage reader (`antigravityUsageReader.ts`, 142 usage tests passing).
3. **Web Client Companion Side Panel (`RightPanelTabs.tsx`)**:
   - Embedded right-hand companion panel beside `ChatView` with 6 tabs: **Diffs**, **Browser**, **Files**, **Terminal**, **PRs**, and **Stash & Queue**.
   - Side-by-side desktop `flex-row` layout with default-open (`isOpen: true`) state.
   - Retains existing top toolbar tool buttons (Browser, Code, Git, Terminal, Testing).
4. **Recent Visual Polish & Fixes**:
   - **Startup Hydration Freeze Fixed**: Provided missing Effect services (`CodexResetCreditCoordinator`, `ProviderEventLoggers`, `ProjectionSnapshotQuery`) and corrected CLI WebSocket server boot.
   - **Multi-Branch Pinned Divergence Tracking**: Up to 4 branches pinned in agents header and Divergence space.
   - **Corner Radii & Buttons**: Modernized app-wide buttons to pill styling (`rounded-full`), unified `DivergencePanel` heights (`h-8`), and updated `ProjectIconPickerDialog` to shared `SegmentedControl`.
   - **Git Settings Panel**: Reorganized into 3 clean categorized sub-tabs (`AI & Review`, `Branches & Tracking`, `Repository & Identity`).
   - **Code-OSS Unavailable Fallback**: Redesigned into a centered glassmorphic card with copyable build command.
   - **Gemini Models**: Updated to Gemini 2.5 Flash, Pro, and 2.0 Flash.

---

## 4. Backlog of Remaining Tasks (Your Execution Roadmap)

Please babysit, execute, and verify the following remaining tasks in order:

### Task 1: Server Unit Test Mock & Fixture Reconciliation (`apps/server`)

- **Problem**: While runtime code compiles cleanly (0 type errors under `tsc --noEmit`), running `bun run test` in `apps/server` (which runs Vitest under Node ≥ 22 via `scripts/test.ts`) hits outdated test mocks and schema definitions in legacy provider/adapter test suites (e.g., `ProviderRegistry.test.ts`, `CursorAdapter.test.ts`, `wsServer.test.ts`).
- **Goal**:
  - Run `apps/server/scripts/test.ts` or `bun run --cwd apps/server test`.
  - Identify failed mock assertions or outdated test layers.
  - Update mock service layers to provide the required Effect 4 Beta 78 services.
  - Ensure `apps/server` test suites run green without modifying production runtime invariants.

### Task 2: Background Server-Owned Queue Dispatcher

- **Problem**: Currently, message queue dispatch (`MessageQueuePanel.tsx`) evaluates auto-dispatch conditions within the mounted chat component. If the chat window is closed, switched, or backgrounded, queued messages may not dispatch.
- **Goal**:
  - Mirror T3 upstream server worker behavior (`apps/server/src/orchestration-v2/`): have the backend track queued messages and dispatch turns when the provider/agent fiber becomes idle, surviving frontend unmounts.
  - Ensure client store (`messageQueueStore.ts`) synchronizes with server dispatch state.

### Task 3: Client-Runtime Keybinding Compatibility & Test Fixes

- **Problem**:
  - `packages/client-runtime/src/rpc/session.test.ts` has tests (such as `reaches ready when a newer server sends unknown config members`) that expect `ServerConfig` schema decoding to tolerate unknown future keys, but strict Effect schema parsing rejects unknown properties.
  - Fix: Ensure `ServerConfig` or its RPC schema decoder accepts extra/unknown keys or uses non-strict object schemas (`Schema.Struct(...).pipe(Schema.annotations({ ... }))` or `Schema.passthrough`).
  - Verify all 74 tests in `packages/client-runtime` pass with `bun test packages/client-runtime`.

### Task 4: Code-OSS Pre-Commit Hook & Hygiene Reconciliation

- **Problem**: The local commit hook attempts to invoke vendored Code-OSS hygiene checks which fail if `event-stream` is missing in `tabs-code-oss`. Additionally, formatting checks report pre-existing formatting issues across unrelated files.
- **Goal**:
  - Verify `npm list` / dependencies in `../tabs-code-oss` or ensure standard Git commit hooks execute cleanly without requiring bypass flags.
  - Ensure all newly modified files adhere to project style, imports, and strict TypeScript rules.

### Task 5: End-to-End Live Launch & Validation Verification

- **Goal**:
  - Run full monorepo typecheck:
    ```bash
    bun run typecheck
    ```
    (Ensure 12 / 12 packages pass cleanly via Turborepo).
  - Verify no leftover processes, then launch:
    ```bash
    bun run dev:desktop
    ```
  - Verify:
    1. App boots past splash screen into workbench immediately.
    2. Agents workspace mounts chat with companion side panel open.
    3. File tree, Browser localhost preview, PTY Terminal, and Diffs function properly.
    4. Git Settings tabs (`AI & Review`, `Branches & Tracking`, `Repository & Identity`) work cleanly.
  - Safely terminate the instance and confirm 0 orphaned processes.

---

## 5. Babysitting Protocol (How to Work)

1. **One Subsystem at a Time**: Pick Task 1, diagnose, write/adjust code, run targeted tests (`bun test <path>`).
2. **Never Break Typechecking**: After any edit, run `bun --cwd <package> typecheck` to confirm zero new errors.
3. **No Assumptions / No Shortcuts**: If an upstream behavior is ambiguous, inspect `/Users/rushil.dev/Desktop/tabs/t3code-main` (pinned commit `76d3c96f`) for the exact reference implementation.
4. **Log Progress**: Report clear summaries of what was fixed, test outputs, and next steps as you complete each task.
````
