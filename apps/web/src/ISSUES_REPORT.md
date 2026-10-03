# User-Facing Issue Audit

Generated from full read of all ~70+ source files in `apps/web/src/`.

## 1. Missing Loading States / Skeleton Screens

| #    | File                                   | Lines                 | Issue                                                                                                                                                                                                                                 |
| ---- | -------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `components/WorkspaceShell.tsx`        | 7572-7588             | `AgentsThreadList` receives `threads` prop with no loading skeleton when query is loading; the list instantly appears empty then populated — no shimmer/skeleton for the initial fetch                                                |
| 1.2  | `components/WorkspaceShell.tsx`        | ~910-930              | `GitHistoryView` no loading skeleton while `gitHistoryQuery` resolves; table appears blank then rows appear                                                                                                                           |
| 1.3  | `components/WorkspaceShell.tsx`        | ~780-800              | `GitStashList` no loading skeleton for stash list query                                                                                                                                                                               |
| 1.4  | `components/WorkspaceShell.tsx`        | ~1000-1050            | `GitConflictResolver` no loading indicator while AI proposal is being generated (`status: "sending"` has no spinner in the initial render path)                                                                                       |
| 1.5  | `components/ChatView.tsx`              | sendPhase transitions | When `sendPhase === "sending"` the composer send button shows a spinner, but there's no full-screen or overlay loading state when a turn is being processed (the messages area just shows old messages until the first event arrives) |
| 1.6  | `components/ChatView.tsx`              | ~3400                 | Initial thread load: `serverThread` might be undefined, showing a spinner via `localDraftError`, but no skeleton for the full chat view layout                                                                                        |
| 1.7  | `components/DiffPanel.tsx`             | ~specific lines       | Diff loading: the panel shows content once diffs are available, no skeleton during initial computation                                                                                                                                |
| 1.8  | `components/CloneRepositoryDialog.tsx` | all                   | Clone button shows spinner during `cloneMutation`, but the dialog itself has no skeleton while the form loads                                                                                                                         |
| 1.9  | `routes/_chat.settings.tsx`            | ~whole file           | Settings page: providers list, models list, git config data all fetched via React Query but the page has no loading skeleton; it renders full layout then fields populate abruptly                                                    |
| 1.10 | `routes/_chat.$threadId.tsx`           | all                   | Route component simply renders ChatView — no loading skeleton while the route data loads                                                                                                                                              |
| 1.11 | `components/WorkspaceShell.tsx`        | ~6900-7000            | `ProjectScriptsControl` section: scripts list fetched via query, no loading skeleton while scripts load                                                                                                                               |
| 1.12 | `components/WorkspaceShell.tsx`        | ~7100-7200            | `GitBranchesList` within branch selector: no skeleton while branches load                                                                                                                                                             |
| 1.13 | `components/WorkspaceShell.tsx`        | ~5600-5700            | `GitStatusList` loading state: uses condition but no shimmer/skeleton for changed files                                                                                                                                               |
| 1.14 | `components/WorkspaceShell.tsx`        | ~5900-6000            | `GitHistoryView` commit list: no skeleton during history query fetch                                                                                                                                                                  |

## 2. Missing Error Boundaries

| #    | File                                     | Lines  | Issue                                                                                                                                                                         |
| ---- | ---------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | `components/WorkspaceShell.tsx`          | ~9000  | The entire content area renders `{content}` — no ErrorBoundary wrapping the active tool content (if ChatView, GitLayout, BrowserTool, etc. crash, the entire shell collapses) |
| 2.2  | `components/ChatView.tsx`                | ~3800+ | No ErrorBoundary wrapping the MessagesTimeline; if a message render crashes, all messages disappear                                                                           |
| 2.3  | `components/ChatView.tsx`                | ~4100  | No ErrorBoundary wrapping the ComposerPromptEditor; if the Lexical editor crashes, the composer is gone                                                                       |
| 2.4  | `components/DiffPanel.tsx`               | all    | No ErrorBoundary; if diff rendering crashes, the diff panel shows nothing                                                                                                     |
| 2.5  | `components/DiffPanelShell.tsx`          | all    | No ErrorBoundary                                                                                                                                                              |
| 2.6  | `routes/_chat.settings.tsx`              | all    | No ErrorBoundary wrapping the settings form; a crash in any settings section takes down all settings                                                                          |
| 2.7  | `components/WorkspaceShell.tsx`          | ~8900  | `AgentsThreadList` for agents tool kind — no ErrorBoundary                                                                                                                    |
| 2.8  | `components/GitCommitComposer.tsx`       | all    | No ErrorBoundary around commit form                                                                                                                                           |
| 2.9  | `components/PatchViewer.tsx`             | all    | No ErrorBoundary around patch rendering                                                                                                                                       |
| 2.10 | `components/PullRequestThreadDialog.tsx` | all    | No ErrorBoundary                                                                                                                                                              |
| 2.11 | `components/ThreadTerminalDrawer.tsx`    | all    | No ErrorBoundary around terminal (xterm.js crashes could crash the whole drawer)                                                                                              |
| 2.12 | `components/PlanSidebar.tsx`             | all    | No ErrorBoundary                                                                                                                                                              |

## 3. Data Fetching Issues

| #    | File                            | Lines                              | Issue                                                                                                                                                 |
| ---- | ------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1  | `lib/gitReactQuery.ts`          | queryOptions helpers               | Several queries use `staleTime: Infinity` which means they never refetch on mount; user must manually refresh to see updated branch/status/diff state |
| 3.2  | `lib/gitReactQuery.ts`          | `gitBranchesQueryOptions`          | No `refetchInterval` for polling; if another tool creates a branch, the branch selector won't update until manual refresh                             |
| 3.3  | `lib/gitReactQuery.ts`          | `gitStatusQueryOptions`            | No `refetchInterval`; git status can become stale during active work                                                                                  |
| 3.4  | `lib/gitReactQuery.ts`          | `gitDiffQueryOptions`              | No `refetchInterval`; diffs can become stale                                                                                                          |
| 3.5  | `lib/projectReactQuery.ts`      | `projectSearchEntriesQueryOptions` | No refetch interval for file search results; search could become stale                                                                                |
| 3.6  | `lib/serverReactQuery.ts`       | `serverConfigQueryOptions`         | staleTime unknown; server config changes (model additions) won't be reflected without manual refresh                                                  |
| 3.7  | `components/WorkspaceShell.tsx` | ~5600 `gitStatusQuery`             | The status is fetched once but not invalidated after commits, branch switches, etc.                                                                   |
| 3.8  | `components/ChatView.tsx`       | ~490 `serverThread`                | Derives thread from store's `threads` array; if the store isn't updated after a WebSocket reconnection, stale thread data is shown                    |
| 3.9  | `components/WorkspaceShell.tsx` | ~1600-1700                         | `gitHistoryQuery` fetches on mount but has no invalidation after commit/stash operations                                                              |
| 3.10 | `components/WorkspaceShell.tsx` | ~7800-7900                         | `recentProjects` fetched via `projectListQueryOptions` — no refetch interval; recently created projects may not appear                                |

## 4. Missing Empty States

| #    | File                               | Lines                              | Issue                                                                                                                                                                             |
| ---- | ---------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1  | `components/ChatView.tsx`          | MessagesTimeline area              | When a thread has no messages yet (new thread), the messages area is empty — no welcome/empty state guidance shown                                                                |
| 4.2  | `components/ChatView.tsx`          | ~3800+                             | When `messagesTimeline` is empty after filtering, nothing is rendered — no "no messages" empty state                                                                              |
| 4.3  | `components/WorkspaceShell.tsx`    | ~5600-5700 `GitStatusList`         | When status is clean, only shows empty list — no "Working tree clean" empty state                                                                                                 |
| 4.4  | `components/WorkspaceShell.tsx`    | ~5900-6000 `GitHistoryView`        | When no commits exist (new repo), shows empty list — no "No commits yet" empty state                                                                                              |
| 4.5  | `components/WorkspaceShell.tsx`    | ~7800-7900 `RecentProjects`        | Has "No recent projects yet" empty state — **GOOD**                                                                                                                               |
| 4.6  | `components/DiffPanel.tsx`         | all                                | When no diffs to show, may render empty area — no "No changes to display" empty state                                                                                             |
| 4.7  | `components/GitCommitComposer.tsx` | all                                | When no staged changes, shows an empty diff area — no "No staged changes" message                                                                                                 |
| 4.8  | `components/WorkspaceShell.tsx`    | ~7100-7200 `BranchesSelector`      | When no branches exist, shows empty list — no "No branches" empty state                                                                                                           |
| 4.9  | `components/WorkspaceShell.tsx`    | ~6600-6700 `GitStashList`          | When stash is empty, shows empty list — no "No stashes" empty state                                                                                                               |
| 4.10 | `components/WorkspaceShell.tsx`    | ~6900-7000 `ProjectScriptsControl` | When no scripts configured, shows empty — no "No project scripts" empty state                                                                                                     |
| 4.11 | `components/ChatView.tsx`          | ~4100+                             | Composer area: when prompt is empty and there is no draft, shows empty composer — no placeholder guidance text for first-time users (beyond the `resolveBaseComposerPlaceholder`) |

## 5. Form Validation

| #    | File                                   | Lines                                        | Issue                                                                                                                                                           |
| ---- | -------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1  | `components/CloneRepositoryDialog.tsx` | URL input                                    | URL field is a free text input with no URL format validation; any string can be submitted                                                                       |
| 5.2  | `components/CloneRepositoryDialog.tsx` | directory input                              | No validation for path format (valid filesystem path chars, length limits)                                                                                      |
| 5.3  | `routes/_chat.settings.tsx`            | API key inputs                               | Provider API key fields: no validation for key format before saving                                                                                             |
| 5.4  | `routes/_chat.settings.tsx`            | custom instructions textarea                 | No character/byte length validation before sending to server                                                                                                    |
| 5.5  | `routes/_chat.settings.tsx`            | model selection inputs                       | No validation that selected model exists in provider's model list                                                                                               |
| 5.6  | `components/GitCommitComposer.tsx`     | commit message input                         | No validation for empty commit message before allowing commit                                                                                                   |
| 5.7  | `components/WorkspaceShell.tsx`        | `BrowserViewportSelector` custom size inputs | Free text numeric inputs (`inputMode="numeric"`) accept empty strings and non-numeric text on desktop; `Number.parseInt` silently returns NaN for invalid input |
| 5.8  | `components/WorkspaceShell.tsx`        | new project name dialog                      | No validation for project name format (empty name, special chars, length)                                                                                       |
| 5.9  | `components/WorkspaceShell.tsx`        | rename branch dialog                         | No validation for branch name format (Git branch naming rules)                                                                                                  |
| 5.10 | `components/WorkspaceShell.tsx`        | new file name input                          | No validation for filename format (empty, path separators, illegal chars)                                                                                       |

## 6. Keyboard Shortcut Issues

| #   | File                            | Lines                    | Issue                                                                                                                                            |
| --- | ------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 6.1 | `keybindings.ts`                | pass-through logic       | Custom keybindings that match default browser shortcuts may not prevent default behavior; `preventDefault` calls may be missing for certain keys |
| 6.2 | `components/ChatView.tsx`       | ~composer area           | Composer has keyboard shortcuts for submit (Enter/Shift+Enter) but `Cmd/Ctrl+Enter` may conflict with native shortcuts                           |
| 6.3 | `components/ChatView.tsx`       | ~terminal integration    | Terminal keyboard shortcuts defined in `keybindings.ts` may conflict with code editor shortcuts in compact mode                                  |
| 6.4 | `components/WorkspaceShell.tsx` | shell-level shortcuts    | Project-level keyboard shortcuts (e.g., `Cmd+K`, `Cmd+T`) not handled at shell level — shortcuts only work when a specific tool is focused       |
| 6.5 | `components/WorkspaceShell.tsx` | Escape handling          | Escape key behavior for closing modals/dialogs inconsistent across different dialogs (some use `onOpenChange` with escape, some don't)           |
| 6.6 | `routes/_chat.settings.tsx`     | settings page            | No keyboard shortcut to navigate back from settings (e.g., Escape should go back)                                                                |
| 6.7 | `components/WorkspaceShell.tsx` | ~BrowserViewportSelector | The custom width/height inputs don't handle Enter to confirm; user must click outside to trigger update                                          |

## 7. Missing Confirmation Dialogs

| #    | File                            | Lines                       | Issue                                                                                                                      |
| ---- | ------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 7.1  | `components/WorkspaceShell.tsx` | deleteProject               | `handleDeleteProject` via `deleteProjectMutation` — no confirmation dialog before deleting a project                       |
| 7.2  | `components/WorkspaceShell.tsx` | requestCloseProject         | Closing a project with unsaved work — no confirmation dialog                                                               |
| 7.3  | `components/ChatView.tsx`       | deleteThread                | `handleDeleteThread` — no confirmation dialog before deleting a thread (used via `onDeleteThread` in `WorkspaceShell.tsx`) |
| 7.4  | `components/ChatView.tsx`       | clearComposerDraftContent   | Clearing composer content with images/terminal contexts attached — no confirmation                                         |
| 7.5  | `components/WorkspaceShell.tsx` | branch delete               | No confirmation dialog before deleting a branch                                                                            |
| 7.6  | `components/WorkspaceShell.tsx` | stash drop                  | No confirmation before dropping a stash                                                                                    |
| 7.7  | `components/WorkspaceShell.tsx` | discard changes             | `handleGitDiscardChanges` — no confirmation before discarding uncommitted changes                                          |
| 7.8  | `components/WorkspaceShell.tsx` | hard reset                  | Hard reset/checkout operations — no confirmation                                                                           |
| 7.9  | `components/WorkspaceShell.tsx` | unlink project              | Removing a project from the workspace — no confirmation                                                                    |
| 7.10 | `components/WorkspaceShell.tsx` | ~archiveThread              | Archiving a thread — no confirmation dialog                                                                                |
| 7.11 | `components/WorkspaceShell.tsx` | ~handleCloseTerminal        | Closing terminal with running process — no "Terminal will be killed" warning                                               |
| 7.12 | `components/WorkspaceShell.tsx` | ~discardAllChanges          | "Discard All" in git status panel — no confirmation                                                                        |
| 7.13 | `components/ChatView.tsx`       | clear persisted attachments | Clearing all composer attachments — no confirmation                                                                        |

## 8. Client State Sync Issues

| #    | File                            | Lines                               | Issue                                                                                                                                                           |
| ---- | ------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1  | `store.ts`                      | `syncServerReadModel`               | Zustand store syncs data from the server read model; if server sends partial updates, local state may drift from server state                                   |
| 8.2  | `components/ChatView.tsx`       | ~490 `serverThread`                 | Derives `serverThread` from store during render; if store hasn't synced yet (e.g., after reconnect), the wrong thread data is displayed for a frame             |
| 8.3  | `components/ChatView.tsx`       | optimisticUserMessages              | Optimistic messages are stored in local state, not synced to the store; if the component unmounts and remounts, optimistic messages are lost                    |
| 8.4  | `components/WorkspaceShell.tsx` | workspaceState                      | Workspace state is derived from store; multiple components read `workspaceState.session.activeProjectId` without a single source of truth for "current project" |
| 8.5  | `components/ChatView.tsx`       | composerTerminalContexts            | Stored in Zustand composerDraftStore but also mirrored in local refs (`composerTerminalContextsRef`); these can desync if updates interleave                    |
| 8.6  | `components/ChatView.tsx`       | attachmentPreviewHandoffByMessageId | Stored in both state and ref (`attachmentPreviewHandoffByMessageIdRef`) with timeout IDs in another ref; TTL-based cleanup can cause race conditions            |
| 8.7  | `lib/terminalContext.ts`        | context expiration                  | Terminal contexts have a TTL (defined server-side) but the client doesn't proactively invalidate them; stale terminal context could be sent                     |
| 8.8  | `hooks/useLocalStorage.ts`      | cross-tab sync                      | Uses `StorageEvent` custom events for cross-tab sync but this only works in browser tabs, not in Electron windows with multiple webviews                        |
| 8.9  | `terminalStateStore.ts`         | terminal state                      | Terminal state stored per-thread; if a thread is deleted/archived, its terminal state persists in the store                                                     |
| 8.10 | `hooks/useSettings.ts`          | split settings                      | Settings are split between "client" (localStorage) and "server" (fetched); if server settings change while client settings don't, they can conflict             |

## 9. Missing Interactive States (Loading/Disabled/Transition)

| #    | File                                   | Lines                                   | Issue                                                                                                                               |
| ---- | -------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 9.1  | `components/CloneRepositoryDialog.tsx` | clone button                            | Shows spinner during mutation but does not disable the button; user can click multiple times                                        |
| 9.2  | `components/ChatView.tsx`              | send button                             | Send button state is derived from `composerSendState` — disabled when empty. But it's not disabled during `sendPhase === "sending"` |
| 9.3  | `components/ChatView.tsx`              | command menu items                      | `ComposerCommandItem` click handlers don't show loading state while command is being processed                                      |
| 9.4  | `components/WorkspaceShell.tsx`        | git action buttons                      | Commit, Push, Pull, Fetch, Branch buttons have no loading/disabled state while their respective mutations are in flight             |
| 9.5  | `components/WorkspaceShell.tsx`        | `BrowserViewportSelector` preset select | Changing device preset doesn't show transition state while the iframe resizes                                                       |
| 9.6  | `components/WorkspaceShell.tsx`        | project tab switches                    | Switching between projects via `ProjectTabs` doesn't show a loading state while the new project's data loads                        |
| 9.7  | `components/WorkspaceShell.tsx`        | branch switch                           | Switching branches via branch selector doesn't show loading state; the UI remains interactive                                       |
| 9.8  | `components/WorkspaceShell.tsx`        | stash operations                        | Apply/drop stash buttons have no loading state while mutation is in flight                                                          |
| 9.9  | `components/WorkspaceShell.tsx`        | `AgentsThreadList` thread delete        | Delete button has no loading state during deletion                                                                                  |
| 9.10 | `components/WorkspaceShell.tsx`        | settings save                           | Settings save button has no loading state while persisting                                                                          |
| 9.11 | `components/DiffPanel.tsx`             | checkpoint navigation                   | "Revert to checkpoint" button is not disabled during `isRevertingCheckpoint` at the button level (only checked in handler)          |
| 9.12 | `components/ChatView.tsx`              | approval actions                        | Approval/Reject buttons in `ComposerPendingApprovalActions` — not disabled while `respondingRequestIds` contains the request ID     |
| 9.13 | `components/ChatView.tsx`              | user input submit                       | Submit button for pending user input — not disabled while `respondingUserInputRequestIds` contains the request ID                   |
| 9.14 | `components/WorkspaceShell.tsx`        | `BrowserViewportHiddenNotice`           | The notice has no dismiss animation/transition when closed                                                                          |

## 10. Missing Null Checks / Optional Chaining

| #     | File                            | Lines            | Code                                                                                              | Issue                                                                                                                                   |
| ----- | ------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 10.1  | `components/ChatView.tsx`       | ~490             | `const serverThread = threads.find((t) => t.id === threadId);`                                    | `serverThread` can be undefined; consumer code assumes it exists                                                                        |
| 10.2  | `components/ChatView.tsx`       | ~587             | `serverThread.messages`                                                                           | Accessed without null check on `serverThread`                                                                                           |
| 10.3  | `components/ChatView.tsx`       | ~600-700         | `serverThread.session`                                                                            | Accessed without null check                                                                                                             |
| 10.4  | `components/WorkspaceShell.tsx` | ~9000            | `activeProject` access via store                                                                  | `activeProject` could be null but several code paths assume it's defined                                                                |
| 10.5  | `components/WorkspaceShell.tsx` | ~9079            | `activeProject && availableTools.length > 0`                                                      | Checks exist before rendering ProjectToolBar, but later code accesses `activeProject.id` without the guard                              |
| 10.6  | `components/WorkspaceShell.tsx` | ~8900-9000       | `activeTool?.kind`                                                                                | The switch uses `activeTool?.kind` which can be undefined, falling through to `browserTool`; if `activeTool` is null, browserTool shows |
| 10.7  | `components/WorkspaceShell.tsx` | ~547             | `thread.terminalState`                                                                            | Assumes thread exists when accessing `terminalState` — no optional chaining                                                             |
| 10.8  | `lib/gitReactQuery.ts`          | mutation options | Callback parameters like `variables` are typed but not checked for null/undefined at runtime      |
| 10.9  | `lib/serverReactQuery.ts`       | providers list   | `providers` could be an empty array; consumer code that maps over it with index access could fail |
| 10.10 | `components/ChatView.tsx`       | ~400             | `composerMenuItemsRef.current[0]`                                                                 | Accessing first item assumes array is non-empty                                                                                         |
| 10.11 | `components/ChatView.tsx`       | ~1200            | `serverThread.session`-based computations                                                         | Multiple session fields accessed without null-safety                                                                                    |
| 10.12 | `components/WorkspaceShell.tsx` | ~800-900         | `gitStatusResult`                                                                                 | Git status result structure assumes certain response shape without defensive checks                                                     |
| 10.13 | `components/WorkspaceShell.tsx` | ~3400            | `messages.at(-1)`                                                                                 | No null check on the last message before accessing its properties                                                                       |
| 10.14 | `components/WorkspaceShell.tsx` | ~6900            | `scripts` array                                                                                   | Mapped without check that each script has required `id` property                                                                        |

## 11. Accessibility Issues

| #     | File                                   | Lines                      | Issue                                                                                                   |
| ----- | -------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------- |
| 11.1  | `components/ChatView.tsx`              | message area               | Messages are rendered as divs without proper `role="log"` or `aria-live="polite"` for screen readers    |
| 11.2  | `components/ChatView.tsx`              | composer textarea/editor   | The Lexical editor doesn't have `aria-label` or `aria-describedby` for screen readers                   |
| 11.3  | `components/ChatView.tsx`              | image attachments          | Images in composer are rendered without `alt` text — screen readers see blank images                    |
| 11.4  | `components/ChatView.tsx`              | send button                | Send button has no `aria-label` — screen reader says "button" with no context                           |
| 11.5  | `components/WorkspaceShell.tsx`        | project tabs               | `ProjectTabs` tab buttons have no `aria-selected` or `role="tab"` attributes                            |
| 11.6  | `components/WorkspaceShell.tsx`        | toolbar buttons            | Multiple icon-only buttons throughout the shell (`Button` with only icon children) have no `aria-label` |
| 11.7  | `components/WorkspaceShell.tsx`        | branch selector            | Select component doesn't have `aria-label` for branch selector                                          |
| 11.8  | `components/DiffPanel.tsx`             | diff content               | Diff lines don't have `role="region"` or `aria-label` identifying the file                              |
| 11.9  | `components/WorkspaceShell.tsx`        | `BrowserViewportSelector`  | Custom width/height inputs lack `aria-label`; screen readers see only "Input"                           |
| 11.10 | `components/WorkspaceShell.tsx`        | `GitConflictResolver`      | Conflict resolution buttons lack `aria-label` describing the action                                     |
| 11.11 | `components/ChatView.tsx`              | approval buttons           | Approve/Reject buttons lack `aria-label`                                                                |
| 11.12 | `components/WorkspaceShell.tsx`        | close buttons              | Multiple close (X) buttons throughout lack `aria-label="Close"`                                         |
| 11.13 | `components/WorkspaceShell.tsx`        | loading spinners           | `LoaderIcon` spinners have no `aria-label="Loading"` or `role="status"`                                 |
| 11.14 | `components/ChatView.tsx`              | scroll-to-bottom button    | Has no `aria-label`                                                                                     |
| 11.15 | `components/WorkspaceShell.tsx`        | terminal drawer            | Terminal xterm.js container has no `aria-label`                                                         |
| 11.16 | `components/CloneRepositoryDialog.tsx` | form fields                | URL input and path input lack `aria-label` and `aria-required`                                          |
| 11.17 | `components/ChatView.tsx`              | message timestamps         | Timestamps are plain text with no `aria-label` for relative times ("2m ago")                            |
| 11.18 | `components/WorkspaceShell.tsx`        | tool menu                  | Tool kind selector buttons lack `aria-current` for active tool                                          |
| 11.19 | `components/ChatView.tsx`              | collapse/expand buttons    | Message thread collapse buttons lack `aria-expanded`                                                    |
| 11.20 | `components/ChatView.tsx`              | checkbox-based UI elements | Terminal context checkboxes lack proper `aria-labelledby` association                                   |
| 11.21 | `components/ChatView.tsx`              | Command menu               | Custom command menu items don't use `role="option"` or `aria-selected` — not ARIA-compliant listbox     |

## 12. Race Conditions / Async Safety

| #     | File                            | Lines                               | Issue                                                                                                                                                                                                                                                        |
| ----- | ------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 12.1  | `components/ChatView.tsx`       | ~800-900                            | `handleSendTurn` triggered while another send is in flight (`sendInFlightRef` used to guard). But `sendInFlightRef` is a ref — if two sends are queued synchronously, the second is dropped silently with no feedback                                        |
| 12.2  | `components/ChatView.tsx`       | ~900-1000                           | Optimistic message flow: `setOptimisticUserMessages` is called, then the async send starts. If the thread unmounts before the send completes, `setOptimisticUserMessages` from the unmounted component will fire (React state update on unmounted component) |
| 12.3  | `components/ChatView.tsx`       | ~600-700                            | Thread transitions: `routeToThread` navigates to a new thread while an async send for the previous thread is still in flight; no cancellation mechanism                                                                                                      |
| 12.4  | `components/ChatView.tsx`       | attachmentPreviewHandoffByMessageId | TTL-based cleanup with `setTimeout` stored in a ref; if the component unmounts, timeouts aren't cleared, leading to state updates on unmounted component                                                                                                     |
| 12.5  | `components/ChatView.tsx`       | composer cursor sync                | `composerCursor` and `composerTrigger` state updates derived from the prompt; if two rapid prompt updates happen, cursor state may be stale                                                                                                                  |
| 12.6  | `components/ChatView.tsx`       | refs vs state sync                  | Multiple refs shadowing state (`promptRef`, `composerTerminalContextsRef`, `optimisticUserMessagesRef`, etc.) — if a ref update and state update interleave incorrectly, stale ref values are used                                                           |
| 12.7  | `components/WorkspaceShell.tsx` | focusProject                        | Called with `void focusProject(projectId)` — fire-and-forget; if two `focusProject` calls happen rapidly, the second might start before the first finishes                                                                                                   |
| 12.8  | `components/WorkspaceShell.tsx` | handleCreateProject                 | Creates a project then navigates to it; if the user clicks "New Project" multiple times quickly, multiple projects are created                                                                                                                               |
| 12.9  | `components/WorkspaceShell.tsx` | requestCloseProject                 | Uses `.then()` callback; if the component unmounts during the async operation, the callback runs on unmounted component                                                                                                                                      |
| 12.10 | `components/DiffPanel.tsx`      | checkpoint revert                   | `isRevertingCheckpoint` is a boolean ref; if two reverts are triggered, the second proceeds without guard (race condition for the first revert's completion)                                                                                                 |
| 12.11 | `components/WorkspaceShell.tsx` | mutation callbacks                  | Multiple `useMutation` callbacks update the query cache — if two mutations complete in rapid succession (e.g., stage two files), cache invalidation may interleave                                                                                           |
| 12.12 | `components/ChatView.tsx`       | ~1100-1200                          | `handleApproveAction` and `handleRejectAction` use `respondingRequestIds` state; if two approval/reject actions fire simultaneously, the state update may be stale                                                                                           |

## 13. WebSocket / Reconnection Issues

| #     | File                            | Lines                   | Issue                                                                                                                                              |
| ----- | ------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13.1  | `components/ChatView.tsx`       | ~500                    | `isConnecting` state is declared but never used in the UI — no "Reconnecting..." banner when WebSocket reconnects                                  |
| 13.2  | `components/ChatView.tsx`       | ~490                    | `serverThread` derived from store; if WebSocket reconnects and store hasn't been updated yet, shows old/empty thread                               |
| 13.3  | `components/ChatView.tsx`       | `syncServerReadModel`   | Called after WebSocket messages; if messages arrive out of order after reconnect, the store could be updated with stale data                       |
| 13.4  | `lib/storage.ts`                | all                     | localStorage-based persistence; when WebSocket reconnects, local state may contain pending changes that conflict with server state                 |
| 13.5  | `components/ChatView.tsx`       | ~optimistic messages    | Optimistic messages are local-only; if WebSocket disconnects and reconnects, these messages are never confirmed by the server and remain in the UI |
| 13.6  | `components/WorkspaceShell.tsx` | activeProject           | When WebSocket reconnects, `activeProject` might change server-side (project closed by another client); the UI doesn't detect this drift           |
| 13.7  | `components/ChatView.tsx`       | pending send            | If a send is in flight when WebSocket disconnects, the user sees an indefinite spinner; no recovery mechanism for in-flight sends                  |
| 13.8  | `components/ChatView.tsx`       | ~3400                   | `ThreadErrorBanner` might show connection errors but there's no "reconnect now" button — user must wait for automatic reconnection                 |
| 13.9  | `store.ts`                      | WebSocket event handler | If the WebSocket emits "session expired" or "auth required", there's no UI mechanism to handle this gracefully                                     |
| 13.10 | `components/WorkspaceShell.tsx` | embed mode              | When running in embed mode (`?embed=1`), WebSocket reconnection isn't communicated to the embedding host                                           |

## 14. Error Toast / Error Handling UX

| #     | File                                   | Lines                          | Issue                                                                                                                                                                 |
| ----- | -------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14.1  | `components/ChatView.tsx`              | ~800-900                       | `handleSendTurn` catch block: errors are handled generically with `toastManager.error` — no differentiation between network/validation/server errors                  |
| 14.2  | `components/ChatView.tsx`              | ~1100-1200                     | `handleApproveAction`/`handleRejectAction` error handling: caught but no toast shown to user on failure                                                               |
| 14.3  | `components/WorkspaceShell.tsx`        | mutation error callbacks       | Multiple `onError` callbacks log to console but don't show user-facing toasts (e.g., branch create, stash operations, git operations)                                 |
| 14.4  | `components/CloneRepositoryDialog.tsx` | clone error                    | Clone mutation error is set via `setError` state but the error display only appears if the error is a string — structured errors are swallowed                        |
| 14.5  | `components/DiffPanel.tsx`             | checkpoint revert error        | No error toast or error state shown when checkpoint revert fails                                                                                                      |
| 14.6  | `components/WorkspaceShell.tsx`        | `handleDeleteProject`          | Delete mutation error not displayed to user (only console)                                                                                                            |
| 14.7  | `components/WorkspaceShell.tsx`        | branch delete error            | Branch deletion error not displayed to user                                                                                                                           |
| 14.8  | `components/WorkspaceShell.tsx`        | stash drop error               | Stash drop error not displayed to user                                                                                                                                |
| 14.9  | `components/WorkspaceShell.tsx`        | settings save error            | Settings save error is shown only in the settings page, but if a server push fails, there's no global error handling                                                  |
| 14.10 | `components/ChatView.tsx`              | image attachment error         | `readFileAsDataUrl` errors (file too large, invalid format) are only shown as a generic toast, not inline near the attachment UI                                      |
| 14.11 | `lib/gitErrorMessages.ts`              | git error messages             | `toGitUserFacingErrorMessage` translates known errors but unknown errors pass through as raw server messages to the user                                              |
| 14.12 | `components/WorkspaceShell.tsx`        | ~gate errors                   | `GitEnvironmentGate` shows error states for missing git, but non-git operations have no error handling                                                                |
| 14.13 | `components/ChatView.tsx`              | ~setStoreThreadError           | `setStoreThreadError` sets an error in the store, but the consumer (`ThreadErrorBanner`) only shows it if `serverThread.error` is truthy — no timeout-based dismissal |
| 14.14 | `components/ChatView.tsx`              | `composerError`                | Composer-level errors (e.g., command execution errors) may not be surfaced to the user — the command menu dismisses silently on failure                               |
| 14.15 | `components/WorkspaceShell.tsx`        | `CloneRepositoryDialog` errors | Server-side clone errors are displayed in a small text area; network errors (timeout, unreachable) may not be caught distinctly                                       |

## Summary Statistics

| Category                    | Issues Count |
| --------------------------- | ------------ |
| 1. Loading States/Skeletons | 14           |
| 2. Error Boundaries         | 12           |
| 3. Data Fetching            | 10           |
| 4. Empty States             | 11           |
| 5. Form Validation          | 10           |
| 6. Keyboard Shortcuts       | 7            |
| 7. Confirmation Dialogs     | 13           |
| 8. State Sync               | 10           |
| 9. Interactive States       | 14           |
| 10. Null Checks             | 14           |
| 11. Accessibility           | 21           |
| 12. Race Conditions         | 12           |
| 13. WebSocket/Reconnection  | 10           |
| 14. Error Toasts/UX         | 15           |
| **Total**                   | **173**      |
