# Recovery of local UI overwritten during consolidation

The previous handoff overstated integration. Archives preserved local files, but the active combined implementation replaced parts of the local design. Unit tests and the earlier launch smoke did not establish visual equivalence.

## Confirmed losses and repairs

- ChatHeader lost its `workspace-actions.css` import, capsule identity/navigation structure, Run/Git/Agents tab panels, stored open/section preferences, branch-card styling hooks, pinned-branch capsules, and opaque branch-picker styling.
- WorkspacePullRequest lost the class that applied the local card styling. The current linked-PR resolver and readiness behavior remain; the styling hook is restored.
- The Code shell rail changed from 60px to 48px, lost the joined native-panel treatment and spotlight isolation, and changed header geometry and search sizing. The exact usual-folder CSS is restored, together with its radius rules and default native tab height.
- The composer workspace tray had lost its wrapping layout, machine selector, PR shortcut and styling/data hook when BranchToolbar was refactored. Its local render structure and PR shortcut are restored while the shared interruption/metadata handlers remain.
- The branch picker also stayed open after successful checkout; it now closes on success and retains the shared checkout implementation, interruption preparation and thread metadata updates.

The outer Workspace Actions layout is restored from the exact usual-folder snapshot, while current checkout helpers, linked-PR lists, run context, script discovery and native lifecycle repairs are retained. Preference reads accept the previous project-scoped key; new updates remain scoped to environment/thread/workspace. Escape respects open dialogs/menus and returns focus to the toggle.

## Scope beyond those examples

`local-integration-differences.json` inventories all remaining differing files among the 832 captured usual-folder changes. Differences are not automatically losses: many are required upstream, release or T3 fixes. Comparing only the embedded native CSS missed the outer shell CSS, and choosing a functionally newer ChatHeader erased its locally designed render body.

The native `embeddedWorkbench.css`, native Tabs contribution CSS, workbench integration extension, icon assets, and theme derivation code match the exact usual-folder snapshot. CodeHost's current runtime priority correctly selects the Tabs fork; the legacy reference runtime is not a replacement for the customized fork.

Other reviewed categories include:

- Settings headings: local font-combination styling is retained in the shared SettingsPageTitle helper, including custom font size, weight, tracking and transform. Repeating old inline markup would undo that fix rather than recover a missing heading.
- BranchToolbar: selection logic was moved to shared helpers that keep thread ownership and linked-worktree metadata consistent. The restored card continues to use those helpers.
- WorkspaceShell: older-history loading/counting and search are additional behavior; restoring the whole older file would lose access to unloaded settled threads.
- WorkspaceAgents/Automations: current lineage, merge-back, authorization and provider selection behavior remains. Restoring the outer tab design does not revert those services.
- Onboarding: the newer SetupHeader and setup typography replace inline header markup; the wallpaper/music/skip actions and personalization flows remain. These are separate from the confirmed shell/action regressions.
- Provider, RPC, state and contract differences retain release/T3 correctness fixes. Those are not candidates for a wholesale snapshot overwrite.

Historical alternative worktrees remain exactly recoverable in the existing archives. This inventory is not a claim that every historical design alternative should be active simultaneously. The original usual-folder snapshot is the reference used for the confirmed UI repairs above.

## Verification of the repaired active UI

- Clean combined Chromium run: all 61 tests across ChatHeader, CodeChrome, WorkspacePullRequest, WorkspaceCardAcceptance, ChatView and BranchToolbar passed. This includes real screenshots at multiple widths, tab persistence/remount, opaque branch search, actual checkout invocation and close-on-success, native dialog chrome handling, rail spotlight/keyboard behavior, full-app composer layout, linked-PR behavior, zoom, themes, reduced motion and keyboard access to long script lists.
- Full workspace unit/integration suite: all 18 tasks passed, including 7,621 server tests (35 skipped).
- Final workspace typecheck: all 16 tasks passed.
- Formatting/lint: zero errors, 676 existing warnings.
- Final desktop/web/backend build: all four tasks passed.
- Isolated native editor smoke passed: Code OSS 1.143.0 starts, opens the real file, loads the Tabs CSS and executes an integrated terminal command. This native smoke exercises the backend/workbench; Code shell geometry is verified separately by the Chromium CodeChrome tests.
- The restored Code shell CSS and radius stylesheet, and the retained embedded native stylesheet, were compared byte-for-byte with the exact usual-folder snapshot.

Evidence/logs are under `/Users/rushil.dev/.codex/recovery/tabs-20261030/`. No push or release was performed.
