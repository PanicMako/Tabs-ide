# Agents companion surfaces: T3 comparison and fixes

Reviewed on 2026-10-08. Scope: the Agents right panel, its surface toolbar, and the existing services those surfaces use. Mobile, the rest of the application, and the broader Antigravity parity handoff are outside this review.

## Reference

Pulled `/Users/rushil.dev/Desktop/tabs/t3code-main` with `git pull --ff-only`. The reference is T3 commit `85489611b5477050d7d777a4195c1c50ac0ce6be` (`fix(server): missing project folders no longer log favicon warnings (#16757)`).

Implementation is in `/Users/rushil.dev/Desktop/tabs/.worktrees/t3-parity-goal-2026-10-06/tabs-app`, the checkout used by the running desktop app.

Relevant upstream source:

- `apps/web/src/components/RightPanelTabs.tsx`: resource-backed surface tabs.
- `apps/web/src/components/preview/PreviewPanel.tsx` and `PreviewChromeRow.tsx`: native preview lifecycle, navigation and secondary browser actions.
- `apps/desktop/src/preview/DesktopBrowserHost.ts`: desktop page hosting.
- `apps/web/src/components/files/FileBrowserPanel.tsx` and `FilePreviewPanel.tsx`: directory tree, file search, source/editor and rich media previews.
- `apps/web/src/components/ThreadTerminalDrawer.tsx`, `DiffPanel.tsx`, `chat/QueuedRunsControl.tsx`, and `promptStashStore.ts`: terminal, review, queued runs and saved composer drafts.

## Findings and changes

| Surface | Confirmed issue in Tabs' Agents panel | Change in this pass | Remaining work relative to T3 |
| --- | --- | --- | --- |
| Browser | An iframe attempts to embed arbitrary sites. Google refuses embedding. The toolbar simulates history and advertises guessed localhost ports. Browser state is discarded when the surface unmounts. | Reuses Tabs' existing native desktop browser and shared responsive toolbar. Navigation defaults public domains to HTTPS and localhost to HTTP. Native back/forward, reload, loading/error recovery, Capture, Tools and View controls become available. Session URLs are retained across surface changes; sessions are separated by environment and thread. Initial URL follows the project's browser setting. Removed the misleading static port strip. The address bar stays available in Agents. | Multiple independently managed browser resources per thread; a compact project-server launcher integrated with the companion panel; deeper validation of recording, annotation and agent-control flows from this location. Desktop native browsing is required for sites that block framing; web-only clients expose the existing unavailable/external-browser fallback. |
| Files | Only the initial 200 entries are searched locally. Clicking a file moves the user into Code. Read failures and truncation are hidden. | Searches the whole workspace through the existing server search API, uses the selected thread's worktree, previews text inside Agents, and provides refresh, clear search, back, retry and truncation notices. Opening Code is an explicit separate action. | A true lazy directory tree, highlighted/editable source, image/audio/video/PDF/CSV previews, file operations/context menus, annotations and composer attachment actions. The list is bounded; users search to narrow truncated results. |
| Terminal | Uses the real shared terminal implementation, but its project target can differ from the requested panel thread. Draft threads lose their ID. “Add selection to context” is a no-op. | Resolves the requested thread/draft and cwd. Connects terminal selections to that environment's composer draft using the existing context store. Retains shared terminal tabs, splitting, selection and close actions. | Validate simultaneous bottom-drawer/companion usage, terminal switching under reconnects, and remote environments. |
| Pull requests | Branch is an empty string; “Create pull request” does nothing. Connection/status loading and failures lack a proper gate. The Git component's theme-token scope is missing. | Reads the current branch, connects the existing PR creation dialog/API, invalidates Git queries on success and reports creation errors. Adds loading/error/retry handling and the shared Git theme scope. Existing PR review/check/provider functionality remains in use. | Live authenticated PR creation and provider-specific review workflows need end-to-end testing. No PR was published during verification. |
| Diff | Already uses the actual shared DiffPanel and worker pool rather than a placeholder. | Kept its existing implementation and theme-aware surface shell. | A separate review of file annotations, split-thread targeting, review actions and large-diff performance is needed before asserting full T3 parity. |
| Stash | Already stores and restores composer drafts through PromptStashPanel. This surface means saved prompts, not Git stashes. | Preserved existing search, draft restoration and attachment behavior. | Cross-environment restore and attachment recovery deserve additional scenario tests. Git stashes remain in the Git tool. |
| Queue | Existing panel supports queue ordering, deletion and scheduling. Dispatch lives in ChatView. The companion does not offer Send Now because no handler is supplied. | Preserved existing queue operations. | Background dispatch independent of a mounted chat and safe restoration after a failed send need a dedicated follow-up. No queued messages were sent, reordered or deleted during this review. |
| Surface toolbar | The plus is pinned beyond unused space. | Places plus immediately after the open tabs while expand/close remain at the far right. Keeps theme colors, the prototype launcher character, compact tabs and stable plus hover. | Persistent per-thread resource lists, duplicate instances of the same surface, and overflow navigation are larger parity items. |

## Validation

- Focused browser tests cover the shared narrow/wide browser toolbar, surface keyboard navigation/close/reopen/hover geometry, plus placement, project-wide file search, in-panel reads, file-read error/retry, and environment-scoped terminal context attachment.
- Live desktop verification: Google and Google Books render as native pages; the real PR dialog opens with repository branches; the companion terminal reaches a shell prompt. Plus is 4 CSS pixels after the tab list. Localhost and inline file checks are recorded below after completion.
- Full type checking passed across all 12 packages before the final browser default-URL adjustment; the final web check is recorded below.
- Scoped formatting/lint runs pass for companion files. WorkspaceShell already has unrelated unused-variable warnings.
- Full `vp check` fails on 143 existing formatting issues across the repository. These files were not broadly reformatted.
- Full `vp run test` fails in the existing two `effect-codex-app-server/src/client.test.ts` cases because the child Codex process exits with code 1; Turbo stops other test tasks.

This pass fixes confirmed broken integration and adds usable workflows. It does not establish full T3 feature parity. The highest-value next step is the file tree and rich preview layer, followed by persistent per-thread surface resources and a dedicated queue reliability review.
