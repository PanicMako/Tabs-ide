# Extensions platform roadmap

Goal: anything a user dislikes about Tabs should be fixable with an extension
instead of a fork, the way Chrome extensions can reshape the browser. This is
the plan for getting there without giving up the security model in
[extensions.md](extensions.md) (sandboxed views, per-project grants, signed
Exchange packages).

## Where we are (API 1.9)

| Surface | Status |
| --- | --- |
| Toolbar tools (`contributes.tools`) | Shipped. A sandboxed HTML view per tool. |
| Logic commands (`contributes.commands`) | Shipped. Pure JSON commands in a QuickJS worker. |
| Agent tools (`aiCallable` + `ai-tools` grant) | Shipped. Exposed through the Tabs MCP server. |
| Quick Actions entries (`contributes.quickActions`) | Shipped in 1.8. Launcher entries that open a tool. |
| Color themes (`contributes.themes`) | Shipped in 1.9. Hex-only palettes in Settings → Themes. |
| Command Palette entries (`contributes.paletteCommands`) | Shipped in 1.9. Entries that open a tool. |
| Brokers | Storage, read-only workspace, git status, HTTPS GET, credential attach. |

## Principles

1. **Declarative first.** A contribution is data the host renders (a label,
   an icon name, a token value), so most extensions need no capability at all.
2. **Capabilities stay explicit.** Anything that reads or changes user data is
   a named capability with a per-project grant, listed at install time, and
   re-prompted when an update adds it (`extensionPermissionIncrease`).
3. **Replace by slot, not by patching.** Extensions never inject code into the
   Tabs renderer. They fill named slots the host owns, so a bad extension can
   be disabled without breaking the shell.
4. **One broker for people and agents.** If an extension can call something,
   an agent with the same grant calls it through the same broker, and the
   reverse.

## Phase 1: look and feel (no new capabilities)

- ✅ `contributes.themes` (1.9): hex-only palettes run through the custom
  theme engine. Still to come: named token sets (`--background`, `--primary`, radii,
  font stacks from an allowlist). Values are validated as colors/lengths, never
  raw CSS, so a theme cannot hide UI or exfiltrate data via `url()`.
- `contributes.splash`: a loader made of the same tokens plus a packaged
  raster/Lottie-free sequence, for the startup screen.
- `contributes.toolbarStyles`: icon + accent for each contributed tool.

## Phase 2: commands everywhere

- ✅ `contributes.paletteCommands` (1.9): entries that open a tool. Still to
  come: entries that run a logic command and show its result.
- `contributes.keybindings`: default shortcuts for those commands, shown in
  Settings → Keybindings and overridable there.
- `contributes.contextMenus`: entries on files (Code), changes (Git), links and
  selections (Browser). The host passes only the clicked item, scoped by the
  existing grants (a file path needs `workspace-read`).
- Quick Actions sub-actions from extensions (the fan-out beyond the ring).

## Phase 3: UI slots

Host-owned regions an extension view can occupy, each opt-in by the user:

- `statusItems`: small text/badge items in the toolbar's right edge, fed by the
  extension's logic command on an interval or event (no persistent runtime).
- `sidePanels`: a panel docked beside Agents/Code/Browser, sized by the host.
- `settingsPages`: a page under Settings → Extensions for the extension's own
  preferences, backed by its `profile-storage`.
- `replaces`: an extension may ask to stand in for a built-in surface (for
  example the new-tab page or the Dock). The user chooses per project; the
  built-in stays one click away.

## Phase 4: events and the agent bridge

- An event bus delivered to active views: `project.changed`, `tool.activated`,
  `thread.started/finished`, `git.changed`, `browser.navigated`. Read-only,
  filtered by the extension's grants.
- **Toolbar tools for agents.** Today agents drive the Browser through the
  Tabs MCP `preview_*` tools. Generalize that into a tool registry: every
  toolbar tool (built-in or extension) can publish typed actions
  (`code.open`, `git.diff`, `dock.list`, `ext:<id>:<command>`). Agents see the
  actions for tools that are on in the project and that the user granted, and
  each call is logged in the conversation like any MCP call. This is how an
  extension (or a user) gets an agent that can "look at and work with" every
  tool, without a separate protocol.
- Write brokers, each its own capability: `workspace-write` (patch proposals
  the user approves, never silent writes), `git-actions` (stage, commit on a
  branch), `terminal-run` (in a visible, killable terminal tab).

## Phase 5: lifecycle

- Background logic: short-lived scheduled invocations (cron-like, bounded),
  not a persistent process.
- Extension-to-extension messaging through declared `exports`.
- Exchange: signed updates, revocation, and permission diffs on update (the
  remaining items under "Not yet supported" in extensions.md).

## Order of work

Phase 1 and 2 are pure contribution points and can ship as API 1.9/1.10 with
validator, contract, docs and tests in the same shape as `quickActions`.
Phase 3 needs layout work in `WorkspaceShell` and the native view stack.
Phase 4 needs a security review of each broker before it ships.
