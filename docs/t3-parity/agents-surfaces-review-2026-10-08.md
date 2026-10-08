# Agents surfaces: redesign and verification

Implemented on 2026-10-08 in `.worktrees/t3-parity-goal-2026-10-06/tabs-app`, the checkout used by the desktop development app. Scope: Browser, Terminal, Files, Diff, Pull requests, prompt Stash, and message Queue inside Agents. Mobile and the broader Antigravity audit are excluded.

## T3 reference

Pulled `/Users/rushil.dev/Desktop/tabs/t3code-main` with `git pull --ff-only`. Reference: `85489611b5477050d7d777a4195c1c50ac0ce6be`.

Compared resource-backed surfaces, `preview/PreviewPanel.tsx`, `PreviewChromeRow.tsx`, `files/FileBrowserPanel.tsx`, `FilePreviewPanel.tsx`, `ThreadTerminalDrawer.tsx`, `DiffPanel.tsx`, and the upstream queue/stash flows. Tabs retains its own pastel launcher, expressive type, native browsing integration, and existing Git/agent services.

## Changes

| Surface               | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared UI             | Theme tokens throughout, consistent project headings, compact tools, readable error/retry states, pastel accents and serif empty states. Stable hover geometry, keyboard tab selection/closing, accessible controls, and existing expand/restore behavior. Add stays immediately after the open tabs.                                                                                                                                                                                       |
| Resource tabs         | Persisted per-environment/thread surfaces. Each Browser selection opens an independent native session with its own address, title, history and preview width. Other tools keep their own remembered surface. Switching tools retains file drafts.                                                                                                                                                                                                                                           |
| Browser               | Native events own the address/history state. Google-style bare domains normalize to HTTPS; localhost addresses use HTTP. Back/Forward no longer trigger a navigation back to stale React state. Fit/mobile/tablet widths, zoom, mute, reload, external open, devtools, screenshot, element annotations, recording, floating preview, comparison, page appearance, permissions and agent-control handoff reuse the desktop host. Closed browser tabs dispose their native sessions.          |
| Files                 | Lazy hierarchical folders, ignored entries included, project-wide search, keyboard tree navigation, source highlighting, editable text, Markdown preview, quoted CSV/TSV tables, images, audio, video and PDF. Text reads cap at 1 MB. Unsaved edits survive surface switches; discard needs confirmation. Saves read the disk again and compare against the edit's original content, including when the query cache refreshes in the background.                                           |
| Desktop file services | Registered the missing directory and signed-asset WebSocket requests in the legacy server actually launched by desktop. Reused workspace path validation and filesystem services. Exact-file signed media URLs support GET/HEAD, single byte ranges, expiry/signature validation, and descriptor validation. Browser callers can read Content-Range. Active HTML/SVG documents stay sandboxed. Schema errors preserve valid request IDs so callers fail promptly.                           |
| Diff                  | Working-tree and agent-turn sources, unified/split rendering, theme-aware syntax, refresh, empty/error/retry states and raw-patch fallback. Existing checkpoint review remains available. Untracked files remain in the Git workspace.                                                                                                                                                                                                                                                      |
| Terminal              | Existing real PTY, split/group/session and context-selection features remain. Thread/project heading and themed framing. Closing or restarting a session now closes its server process. The bottom drawer is hidden while the same terminal is displayed in the side panel.                                                                                                                                                                                                                 |
| Pull requests         | Consistent heading, project scope, loading/error/retry and empty states around the existing real branch/repository PR list, review details, checks and creation dialog. GitHub authentication and repository configuration remain necessary. No PR was published during verification.                                                                                                                                                                                                       |
| Prompt Stash          | Themed searchable cards, attachment details, replace confirmation and append flow. Newly stashed file attachments retain their bytes for restoration; older metadata-only file references request reattachment. Storage failures keep the composer draft. Async serialization cannot clear a newer draft.                                                                                                                                                                                   |
| Queue                 | Themed cards, schedule/reorder/remove/clear controls, send-next/retry, images and file attachments. Follow-ups retain terminal/preview/review context. Enqueue persists before clearing the composer, prevents duplicate IDs, and preserves newer drafts during serialization. Dispatch waits for an idle agent and an empty composer; messages are removed only after a successful turn start. Failed sends remain queued with an explicit retry state. Invalid schedules do not dispatch. |

## Browser follow-up

The browser now uses a single 45px navigation row below the surface tabs. The redundant page/project heading and separate viewport row are removed; preview widths, zoom, audio, screenshot, external browser and advanced tools remain in the keyboard-accessible tools menu. The page title remains in the status strip. The menu fits without horizontal scrolling.

Both inline and sheet routes now pass their actual open state to the panel. A hidden panel unmounts its browser view, immediately publishes hidden native bounds, and cancels its overlay observer and startup subscription. The native session itself is retained until its tab closes. Reopening restores the existing page and history. Closing during startup cannot activate a stale page.

## Files follow-up

Replaced the redundant Files/project heading with a single 45px search row. The project name is a subtle label, refresh remains available, and the tree and preview toolbars align when a file opens. The tree remains visible beside previews by default and can be hidden with its toggle. Theme colors and the existing folder hierarchy are retained.

File and folder rows now support dragging into the chat composer as real context mentions, including quoted paths with spaces. Same-workspace references remain relative; another workspace in the same environment uses an absolute path. Cross-environment drops are rejected with an explanation. The editor's plain-text drop handling cannot insert an additional path alongside the context mention.

Hover/focus actions offer Add to chat and Copy path. Double-click and Cmd/Ctrl+C copy the absolute path. Tree navigation and folder expand/collapse shortcuts remain available. The same actions work in search results.

Validation for this follow-up: all **203 web unit suites / 1,528 tests passed**, **six Files Chromium UI tests passed**, and all **12 packages passed type checking**. Live Electron verifies the compact header, Add to chat, and both file and folder drops in the actual composer. Scoped formatting/lint passes; full formatting currently reports 157 unrelated files. The built-in `vp test` runner exposes an Effect/Vitest runner-version mismatch in the catalog storage suite; the package's `vp run test` command passes that suite and the complete web suite.

## Verification

- Complete web unit suite: **200 files / 1,510 tests passed**.
- Focused Chromium UI tests: **15 passed**, including independent tab selection, stable hover geometry, expand/restore controls, lazy folders, search, error/retry, editing/saving, signed images, and protecting edits after background refresh.
- Focused store, native-browser controller, URL, file classification/CSV, WebSocket transport and asset tests: **60 passed**. Includes queue quota failures, duplicate IDs and failed-send retention.
- Server integration and existing asset/filesystem suites: **124 passed**. Covers directory requests, signed PDF range/HEAD requests, invalid ranges, altered asset paths/signatures, safe workspace reads/writes, and existing terminal routing.
- Desktop suite in the workspace run: **51 files / 447 tests passed**.
- Restored the upstream mock peer fixture omitted from this checkout; all **36 effect-codex-app-server tests passed** in the workspace run.
- Live Electron: Back and Forward update the URL; two native browser sessions retain separate pages and histories; real directory listing and signed image preview load. Media requests return 206 with correct bytes/Content-Range, and altered paths return 404.
- Browser follow-up regressions cover compact chrome and tools, closing while its menu is open, restoring its session, and closing during startup. Live Electron verifies the 45px row, native Back/Forward, close/reopen and retained forward history.
- Full `vp run typecheck`: **12 packages passed**.
- Live Electron also verifies panel expand/restore and light/dark media preview styling.
- Scoped formatting/lint passes for the changed files. The complete `vp check` has 146 pre-existing formatting failures across the checkout; unrelated files were not broadly reformatted.
- Complete `vp run test` remains blocked by existing failures in `packages/client-runtime/src/rpc/session.test.ts` (unknown future config/keybinding compatibility) and `packages/shared/src/composerContextLegacy.test.ts` (an astral Unicode character adjacent to a legacy terminal reference). These were also reproduced in isolated package runs.

## Practical limits

This verifies the redesigned surfaces and repaired integrations; it does not certify every feature in upstream T3 or every provider/account configuration. Queue auto-dispatch still runs in the mounted chat rather than a server-side background scheduler. Native browsing requires the desktop host. Unsupported media codecs show a recovery message. Working-tree diff covers tracked changes; the Git workspace remains the home for untracked files. GitHub write actions were not exercised against the user's account.

Concurrent workspace-card, Git, appearance and settings edits in this checkout are excluded from the surface commit. Shared files are staged by hunk to preserve those edits.

The commit hook could not start the vendored Code OSS hygiene check because its `event-stream` dependency is missing. The surface commits use a command-local hook bypass after the Tabs checks; Git hook configuration is unchanged.
