# Ideas to make Tabs even better

Tabs' core idea: one window, every project, each in its own tab with its own
editor, agents, Dock, Git and browser. The ideas below lean into that. Each one
says what it is, why it matters for that idea, and what in the codebase it
builds on, so it can be scoped quickly. They are ranked by impact for the
effort, within each group.

Effort: **S** about a day, **M** a few days, **L** a week or more.

## 1. Agents that work while you don't

**✅ Shipped in 2.4 · Away digest (M).** When you come back after a while (screen unlock, window
focus after 20+ minutes), show one card per project: what each agent finished,
what is waiting for you, what failed, how long it ran and what it cost. One
click jumps to the item. This turns "go make coffee while agents work" into a
designed moment instead of hunting through tabs.
_Builds on:_ `BackgroundActivityReporter`, the notification history panel, usage data.

**✅ Shipped in 2.4 (as a Quick Actions glance; no mobile) · One approval inbox for every project (M).** Agents in different tabs ask for
permission or answers separately today. A single inbox (badge in the tab bar,
`⌘⇧A`) lists every pending request across projects with the context to decide
fast: approve, deny, or answer inline. (Mobile is out of scope for now.)
_Builds on:_ `t3_pending_request`, Relay/remote access, notifications.

**Task board across projects (M).** A board of every running, queued and
finished agent task across all tabs, with branch, elapsed time and spend.
Drag a task between columns to pause, resume or archive it.
_Builds on:_ the orchestration thread list, `t3_queue`, worktree tasks.

**Budget guard (S).** Per-project and per-day spend or token limits. At 80% it
warns; at 100% it pauses new work and asks. Nobody wants a surprise bill from
an agent stuck in a loop.
_Builds on:_ usage and limits data that Settings → Usage already collects.

**Scheduled agents calendar (M).** `schedule_task` exists; give it a calendar
view: "every weekday 9:00, update dependencies in api and open a PR". Shows
the last run's result inline.

## 2. Close the loop: change, see, ship

**See it before you ship it (M).** When an agent edits frontend files, the
project's Browser tool reloads the affected route, takes before/after
screenshots at the project's device sizes, and attaches the visual diff to the
task. You review pixels, not just code.
_Builds on:_ the browser automation broker (`preview_*`), device presets,
screenshot capture, Compare pages.

**✅ Shipped in 2.4 (browser console errors) · Errors become tasks (S).** Console errors in the Browser tool and errors in
Dock server logs show a quiet "Fix with agent" chip. One click starts a task
with the stack trace, URL, recent logs and the files involved already attached.
_Builds on:_ browser diagnostics, Dock process logs, the composer's attachments.

**Finish line (M).** When a task completes: run typecheck and tests, show the
diff, the visual diff and the results on one screen, and offer "Create PR",
"Ask for changes" or "Discard worktree". This makes "done" mean done.
_Builds on:_ Git tool, worktrees, the testing tool.

**Explain this change (S).** In Git, a one-line summary per file and a
"why" paragraph for the whole diff, drawn from the agent's own task history
rather than guessing.

## 3. Many projects, one window

**✅ Browser part shipped in 2.4 as a Labs option · Tab hibernation (M, big performance win).** Projects you have not touched
for a while release their browser, editor and extension views and keep a
snapshot, the way Chrome discards tabs. Switching back restores them in the
background while the snapshot shows. Memory stays flat no matter how many
projects are open.
_Builds on:_ the native view stack coordinator and the snapshot backdrop added
for the browser and extension views.

**Live project switcher (S).** `⌃Tab` shows every open project as a live
thumbnail with its status (agent running, server down, unsaved files). Hold
and release to switch, like the app switcher.
_Builds on:_ the same view capture used for menu backdrops.

**Workspace recipes (M).** Opening a repo for the first time detects what it
needs (dev server command, port, browser URL, env file, test command) and sets
up Dock, Browser and terminals in one click. Recipes can be saved and shared.
_Builds on:_ server presets, `resolveProjectDefaultBrowserUrl`, project settings.

**Port and environment manager (S).** Detects two projects fighting over a
port, offers the next free one, and shows which project owns which port in one
place.
_Builds on:_ `useDiscoveredLocalServers`, Dock.

**Resume exactly where you were (M).** After a crash, reboot or update:
servers restart, browser tabs return to the same URL and scroll position,
terminals reopen in the same folder, and agents that were mid-task say so
instead of silently stopping.

## 4. Quality of life

**Focus mode per project (S).** Mute notifications from every other project
for an hour and batch them into the away digest.

**Paste anything into any tab (S).** Paste a screenshot, error text or URL
anywhere in a project and get "Start a task with this", pre-filled.

**Secret guard (S).** Before a commit or when an agent writes a file, warn if
it contains something that looks like a key or token, with the line
highlighted.

**Battery-aware background work (S).** On battery or under thermal pressure,
pause idle dev servers and lower background agent concurrency; restore on
power.

**Move in from VS Code or Cursor (M).** Import keybindings, theme, font and
extension-equivalent settings on first run, so day one feels like home.

**Daily summary (S).** A short end-of-day note per project: what changed, what
agents did, what is still open. Copy it into a standup in one click.

## 5. Extensions (next steps)

API 1.9 shipped Quick Actions entries, color themes and Command Palette
entries. The highest-value next steps, from
[extensions-platform-roadmap.md](extensions-platform-roadmap.md):

1. **Status items:** small live badges in the toolbar (CI status, deploys,
   uptime) fed by an extension's logic command.
2. **Events:** read-only `project.changed`, `thread.finished`,
   `git.changed` so extensions can react instead of polling.
3. **Agent tool registry:** every toolbar tool, built-in or extension, can
   publish typed actions that agents call through the existing MCP broker.

## Suggested order

1. Tab hibernation, approval inbox, errors become tasks: big wins, they build
   on code that already exists, and they make every other feature cheaper.
2. Away digest and budget guard: the "agents while you are away" story.
3. See it before you ship it and finish line: close the loop from change to PR.
4. Everything else, in any order.
