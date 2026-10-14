# Tabs IDE — Upstream T3 Parity User Walkthrough

> **Scope**: Non-mobile parity with pinned T3 Code (`76d3c96fd5b89cca2c06aeaceaea16100c75084a`)  
> **Worktree**: `/Users/rushil.dev/Desktop/tabs/.worktrees/t3-parity-goal-2026-10-06`  
> **Branch**: `codex/t3-parity-goal-2026-10-06`  
> **Base SHA**: `117643e40e33ee3a897bd00571186f9c674c25a7`

---

## 1. Quick Start: Launching the Real Desktop Application

To run Tabs with full T3 non-mobile parity features (including the **Agents Companion Side Panel**, **Antigravity Usage Reader**, **Orchestration V2**, and **Agent MCP Toolkits**):

```bash
# 1. Ensure any previous Tabs Electron instance is terminated
pkill -9 -f "tabs-dev-root"
pkill -9 -f "dist-electron/main.js"

# 2. Enter the isolated parity worktree
cd /Users/rushil.dev/Desktop/tabs/.worktrees/t3-parity-goal-2026-10-06/tabs-app

# 3. Launch the native desktop application
bun run dev:desktop
```

> **Important**: Do not launch from `/Users/rushil.dev/Desktop/tabs/tabs-app` (`main` branch) or run `bun run dev` (browser-only). Desktop IPC, native window bridges, and fat Code-OSS runtime require Electron execution from the task worktree.

---

## 2. Interactive Feature Workflows

### Workflow 1: Agents Companion Side Panel
1. Launch the app and select or create an Agent thread.
2. Observe the **Companion Side Panel** automatically opened on the right-hand side in a desktop `flex-row` side-by-side layout.
3. Chat with an agent in the left pane while concurrently interacting with companion views on the right:
   - **Diffs Tab**: Inspect git diffs for modified files in the thread's worktree with syntax-highlighted hunks.
   - **Browser Tab**: Browse localhost servers (`:3000`, `:5173`, `:8080`, `:4321`), navigate history, reload, or pop out.
   - **Files Tab**: Search workspace files in real-time, click to focus and open in Code-OSS.
   - **Terminal Tab**: Run shell commands in an embedded PTY session, split horizontally/vertically, and stream agent output.
   - **PRs Tab**: Review pull requests, inspect review comments, and view status checks for the active repository.
   - **Stash & Queue Tab**: View saved prompt drafts and inspect queued steering messages.
4. Toggle the companion panel open/closed using the `PanelRightIcon` toggle button in the thread header.
5. Notice that existing top-level Tabs toolbar buttons (**Browser**, **Code**, **Git**, **Terminal**, **Testing**) remain fully functional for dedicated full-workspace views.

### Workflow 2: Orchestration V2 & Resilient Execution
1. Send a complex coding task to the agent.
2. Note the deterministic request resolution:
   - Each action creates an idempotent command receipt.
   - Monotonic run tokens ensure that canceled, stopped, or restarted threads cannot leak old provider turns into new executions.
3. If an agent task is interrupted or closed, durable effect intent is safely reconciled upon reopening.

### Workflow 3: Cross-Provider Context Switching & Thread Forks
1. Start a thread with one provider (e.g., Claude).
2. Use the provider switcher in the thread settings to switch to another provider (e.g., Codex or Cursor).
3. The context handoff budget automatically attributes, orders, and formats conversation history into the target provider's context window.
4. Fork the thread at any conversation turn into either the current checkout or a dedicated git worktree.

### Workflow 4: Agent Task Delegation & MCP Toolkits
1. Instruct the agent: *"Delegate building the test fixtures to a background task."*
2. The agent calls `tabs_orchestrator_delegate_task`, spawning a durable, server-owned child task.
3. The parent agent receives completion events without continuous polling.
4. Approvals and input requests route through the parent interface seamlessly.

### Workflow 5: Scheduled Follow-ups & Webhooks
1. Open thread automations or configure a scheduled task:
   - Cron-based recurring reminders (e.g., `0 9 * * 1-5` for morning standup checks).
   - Interval-based monitoring.
2. Close the UI: scheduled occurrences are tracked and claimed server-side.
3. Test local webhook triggers by sending a POST request to `/api/webhooks/:token` with an HMAC signature.

### Workflow 6: Antigravity Historical Usage Ingestion
1. Open the **Usage** dashboard in Settings.
2. Tabs automatically scans local Antigravity conversation SQLite databases and protobuf metadata:
   - Ingests real token usage (prompt, completion, cache read/write, reasoning).
   - Maps costs by model without fabricating placeholder metrics.
   - Deduplicates identical sessions across shadow homes or multiple project mounts.
3. View hourly and daily usage breakdowns in your chosen timezone.

### Workflow 7: Sandboxed HTML Replies & Masked Secrets
1. Request an HTML visualization: the agent calls `publish_html`.
2. The HTML reply is safely rendered inside an isolated, sandboxed iframe synced with the current theme palette.
3. Request sensitive credentials: the agent calls `request_secret`.
4. A secure, masked input dialog opens in the UI. The secret is held in temporary memory and never written to transcripts or disk logs.

---

## 3. Verification & Acceptance Checklist

| Feature | Surface | Expected Behavior |
| :--- | :--- | :--- |
| **Companion Panel** | Agents workspace | Side-by-side flex-row layout, 6 tabs functional, toggleable via header |
| **Top-Level Tools** | Workspace toolbar | Browser, Code, Git, Terminal remain independently usable |
| **Usage Hub** | Settings / Usage | Real Antigravity SQLite tokens ingested and aggregated |
| **Orchestration V2** | Background worker | Monotonic tokens prevent turn resurrection; durable outbox |
| **MCP Toolkits** | Provider session | 22 toolkits registered and active (`orchestrator`, `thread`, etc.) |
| **Webhooks** | Server HTTP API | `/api/webhooks/:token` validates signature and dispatches event |
