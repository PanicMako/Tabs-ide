# T3 Code parity brief

Goal: bring Tabs to full parity with T3 Code for everything except T3's phone app: every feature, setting, keyboard command and quality-of-life detail T3 has and Tabs lacks or does worse. Build each one in Tabs' own UI and personality, verify it, and commit area by area on one branch.

# 1. Context
- **Repo:** `/Users/rushil.dev/Desktop/tabs/tabs-app`: an Electron desktop app (`apps/desktop`), a Node/Effect server (`apps/server`) and a React/Vite UI (`apps/web`), plus `packages/contracts` (schemas only) and `packages/shared`.
- **Relationship to T3:** Tabs started as an MIT-licensed fork of T3 Code, and T3 Code is MIT too, so porting logic is allowed. Keep T3's copyright notice in files where you port substantial code. Many Tabs files have been renamed or merged since the fork; Tabs' desktop code lives largely in `apps/desktop/src/main.ts`.
- **Reference:** clone https://github.com/pingdotgg/t3code read-only into `~/tmp/t3code-ref` (outside this repo). Never import from it.
  - Server logic may be ported and adapted (`@t3tools/*` → `@tabs/*`, fitted into Tabs' architecture: `orchestration-v2`, the provider instance registry, existing stores).
  - UI is never copied. Design every screen in Tabs' language.
- **T3's own feature catalogue:**
  - `docs/user/*.md`: one file per feature.
  - `apps/web/src/components/settings/settingsSearch.ts`: every setting.
  - `packages/contracts/src/keybindings.ts`: every keyboard command.

# 2. Rules (from `tabs-app/CLAUDE.md`; read it in full first)
- **Look:**
  - No "AI-generated" look: no glows, coloured accent edges, gradient washes or floating bubbles.
  - Use neutral surfaces, hairline borders, real type hierarchy, and blur over imagery.
- **Corner radius:** only the tokens in `apps/web/src/radii.css` (`--radius-surface`, `--radius-control`, and the `data-shape` roles `preview`, `thumbnail`, `tile`). Never hardcode a radius.
- **Dialogs:** no native ones (`window.confirm`/`alert`/`prompt`). Use `showCustomConfirm` and the UI kit in `apps/web/src/components/ui/`.
- **Testing:** never launch the Tabs desktop app or the Electron smoke tests. Verify with:
  - `vp check` (0 errors) and `vp run typecheck`.
  - `vp run test` in `apps/web` and `apps/server`.
  - Browser tests (`npx vitest run --config vitest.browser.config.ts <files>` in `apps/web`).
  - `bun run build:desktop`.
- **Git:** no destructive git commands, and no git worktrees. Work on a new branch named `t3-parity` in the main checkout, commit each feature separately with its tests, and never push.
- **Scope:**
  - Leave T3's mobile app (`apps/mobile`) out.
  - The **Devices / simulators** feature (section 5.2) is desktop work and is wanted.
  - Skip T3's own cloud services: T3 Connect relay, Clerk sign-in, hosted pairing, ChatGPT sharing.
  - Skip T3 branding, star prompts and marketing.
- **Additive:** add new features alongside Tabs' existing ones. Where Tabs already has something, keep its UI and raise the behaviour to T3's level.

# 3. What "Tabs style" means
- **Obvious to a first-time user:**
  - Plain-language labels, with a one-line explanation under each setting.
  - Sensible defaults.
  - Empty states that say what to do next.
  - Actions that say what they will do ("Move to composer", not "Restore").
  - Every new setting findable from Settings search.
- **Personality:** Tabs has a playful streak. For example, the side panel launcher ("Open a surface") swaps each name into a different face on hover from `apps/web/src/approvedFonts.css`. Use that kind of touch where it fits, never at the cost of clarity.
- **Motion:** smooth GSAP motion through `apps/web/src/components/agents/companion/designs/motion.ts`:
  - `useCompanionMotion`, `useStaggerIn`, `useSurfaceEnter`, `useSegmentThumb` and `launchFromHome`.
  - They respect reduced motion and the app's animation setting. Animate transform, opacity and filter only.
  - The native browser view cannot follow a CSS transform, so never animate it.
- **Side panel:** new right-panel UI follows the redesigned panel, with its tokens and patterns in `apps/web/src/components/agents/companion/designs/designs.css`:
  - A segmented surface bar.
  - Page-style sub-tabs for multiple instances (`SurfaceSubTabs` in `designs/shared.tsx`).
  - Ledger-style rows.
  - Neutral focus (`--ring` is neutral inside text fields).

# 4. Phase 0: inventory (commit this before any feature)
For every item in section 5, and anything else you find in T3's docs, settings search or keybindings:
1. Read the T3 files named.
2. Find the Tabs equivalent by **behaviour**, not by file name.
3. Classify it as **Have**, **Weaker** or **Missing**.

Write `tabs-app/docs/t3-parity.md` as a table: area, item, T3 files, Tabs files, status, planned Tabs design. Then build every **Missing** and **Weaker** item area by area, in the order in section 6. Keep the table up to date as you go.

# 5. Checklist
The T3 paths below are relative to the clone. `web/` is `apps/web/src`, `server/` is `apps/server/src`, `desktop/` is `apps/desktop/src`.

## 5.1 Providers and accounts
- **Antigravity stays signed in across updates.** T3: "updates keep your profile" (`server/provider/antigravityCliRelease.ts`, `managedRelease.ts`, `Drivers/AntigravityUsage.ts`, `docs/user/providers-antigravity.md`). Tabs today makes the user sign in with Google again after every Antigravity update. Start in `apps/server/src/provider/AntigravityAuth.ts`, `AntigravityInstallation.ts`, `antigravityAuthSupport.ts` and `Drivers/AntigravityDriver*.ts`, and find where the credentials live and why an update loses them. Add a test that simulates an upgrade and keeps the session.
- **Antigravity sign-in methods:** Google account, Gemini Enterprise, Gemini API key and Vertex AI. Also let the user paste the return URL to finish a sign-in started from another device.
- **Antigravity models come from the account,** including Claude and GPT models when the plan has them (Tabs shows only 3). See `server/provider/codexModelCatalog.ts`, `ClaudeCodeModelRoutes.ts`, and Tabs' `provider/ModelManifest.ts`.
- **Multiple accounts per provider:**
  - T3: `web/components/settings/AddProviderInstanceDialog*.tsx`, `AddProviderInstanceWizardSteps.tsx`, `AddCodexAccountDialog.tsx`, `ProviderInstanceCard.tsx`, `ProviderAccentColorPicker.tsx`, `MultipleAccountsNote.tsx`, and "Add provider" at the bottom of Settings → Providers.
  - Each account gets its own auth home, a user-chosen name ("Work", "Personal"), an accent colour, a status, and its own entry in the composer's model picker (`apps/web/src/components/chat/FusedModelPicker.tsx`).
  - Show a gentle note, never a block: which accounts to use is always the user's choice.
- **Provider health check interval and provider update checks** (`server/provider/ProviderHostLive.ts`).
- **"Update everything":** one place that updates the app and every provider CLI, with release notes (`web/components/sidebar/UpdateEverythingDialog.tsx`, `updateEverything.logic.ts`, `SidebarUpdatePill.tsx`, `SidebarUpdateReleaseNotes.tsx`, `SidebarProviderUpdatePill.tsx`, `ServerUpdateAction.tsx`).
- **Compact idle threads** (`server/orchestration-v2/IdleCompaction*.ts`).
- **Text generators:** the model that writes thread titles, commit messages and PR text (`server/textGeneration/*`, `TextGeneratorsSettings.tsx`, `docs/user/text-generation.md`).
- **Usage providers and limit sources** (`UsageProviderSettings.tsx`, `AddUsageLimitSourceDialog*`, `server/usage/CodexUsageHistory.ts`, `Drivers/claudeUsage.ts`, `codexUsage.ts`).
- **Load balancing across accounts** (`LoadBalancingSettings.tsx`).
- **Custom model editor** (`CustomModelEditor.tsx`, `customModelEditor.logic.ts`).
- **ACP registry search and session management** (`AcpRegistrySearchStep.tsx`, `AcpSessionManagementSection.tsx`, `server/provider/AcpRegistrySessions.ts`). Tabs has some ACP support; compare.
- **Model defaults:** default model, fallback model, text-generation model and thread title instructions (`ThreadTitleInstructionsSettings.tsx`, `server/orchestration-v2/modelSwitch.ts`, `placeholderThreadTitle.ts`).

## 5.2 Devices and simulators (high priority: the user specifically asked for this)
**What T3 does:** read `docs/user/devices.md` in full; it is the spec. A **Device** surface in the right panel streams a live iOS Simulator or Android Emulator beside the thread. The user taps, drags and types on it, while agents drive the same device through `device_*` tools and the `agent-device` command line. It is how you build a mobile app with an agent and watch it run.

**What Tabs already has, server side** (re-check every file against T3 before reusing it): `apps/server/src/device/` (`DeviceService`, `DeviceHost`, `LocalDeviceHost`, `SshDeviceHost`, `localSshDeviceHost`, `DeviceHubProxy`, `DeviceActions`, `DeviceToolchain`, `deviceToolMaintenance`, `AgentDeviceShim`, `AgentDeviceTarget`, `sshDeviceScript`) and the agent tools in `apps/server/src/mcp/toolkits/device/`.

**What Tabs is missing:** the whole user-facing feature. There is no `components/device/` in the web app, no Device surface, no settings, and no stream viewer.

**Build it.** T3 reference: `web/components/device/*` (`DevicePanel`, `DeviceWorkspace`, `DeviceStreamView`, `deviceStreamSession`, `DevicePhoneViewport`, `DeviceControlsRail`, `DeviceToolsPanel`, `DeviceSetup`, `DeviceLoadingView`, `DeviceHostAvailability`, `DeviceHostUpdates`, `DeviceToolVersions`, `deviceHubApi`, `deviceHubAtoms`, `deviceModels`, `deviceFrameLayout`, `mountDeviceViewer`, `phoneTrackpad`, `useDeviceControls`, `deviceFold`, `DeviceDuo*`, `DeviceAndroidFoldControls`), `web/routes/_chat.settings.devices.tsx`, `DeviceSourcesSettings.tsx`, `DeviceHostEditor.tsx`, `deviceHostsSettings.logic.ts`, `deviceHostConnectionChecks.ts`, `useHostConnectionChecks.ts`, `server/device/DeviceHubOperations.ts`, `mjpegStillFrame.ts`.
- **A new "Device" surface:**
  - Add it to `RightPanelTab` in `apps/web/src/stores/rightPanelStore.ts`, to the `surfaces` list in `apps/web/src/components/agents/companion/SurfaceTabs.tsx` (with a key, a tint and its own hover font), to the segmented bar in `designs/GroupedDesign.tsx`, and to the body switch in `apps/web/src/components/RightPanelTabs.tsx`.
  - `useCompanionSurfaceStore.open` should create a new tab every time for devices, as it does for browsers.
  - Device tabs appear in the `SurfaceSubTabs` row and can be renamed (double-click, or a context menu).
  - Only the visible tab streams; switching tabs keeps every device running.
- **First-run setup in three plain steps:**
  1. Start the device hub.
  2. Check iOS support (macOS + Xcode) and Android support (SDK tools, an emulator, ffmpeg with libx264 for emulator video).
  3. Choose whether agents may use devices.

  Opening the panel alone must not download or start anything. Explain every missing dependency with the exact fix. If the hub is already installed, say so and reuse it.
- **The device picker:** running devices first, with **Start** beside stopped ones, grouped by host when there are several. Device activity also appears in the thread timeline.
- **The live screen:**
  - The stream sits inside a realistic device frame. Click and drag to touch, type while focused.
  - A controls rail: Home, Back and Recents on Android, rotate on iOS, power off, and a screenshot straight into the composer.
  - Live video needs a secure origin; fall back to still frames elsewhere.
  - **Float device over chat:** a draggable, resizable window, with **Open in right panel** to bring it back. Reuse `useNativeSurfaceOverlaySuspension` where it overlaps the native browser view.
  - 3D view and foldable postures may come after the core works.
- **The Tools drawer:** the foreground app, light/dark mode, text size, accessibility toggles and element-frame overlay, a fake location, and app permissions. On iOS also Liquid Glass, colour filters, VoiceOver and a test push notification; on Android also orientation and network. Show only what the platform supports, and reflect the value read back from the device.
- **Agents:**
  - When an agent opens a device, it floats over the chat like the agent-driven browser does, following the "Auto-show floating preview" setting.
  - "Agents can use devices" gates the tools and the CLI install.
  - Say plainly that an agent session must restart to pick up access, and that the first iOS tap builds a test runner once, which takes a couple of minutes.
- **Settings → Devices:** Use devices, Agents can use devices, device sources (this machine, or a machine over SSH with a test connection and Node 22.12+ checks), devices at once, and tool versions with **Check versions**.
- **Optional, behind Labs:** Simlock pools and Expo/EAS (`SimlockDeviceHost.ts`, `EasDeviceHost.ts`, `ExpoApi.ts`), only once everything above works.
- **Tests:** port and adapt T3's device tests with their fakes. Never boot a real simulator in tests.

## 5.3 Threads, limits and the sidebar (`web/routes/_chat.settings.threads.tsx`, `docs/user/thread-sidebar.md`)
- **Resume after usage limits, and snooze until limits reset:** the thread continues by itself when limits reset. Also snooze presets and a custom snooze (`SnoozePresetsSettings*`, `web/components/CustomSnoozeDialog.tsx`, `web/components/Sidebar.snooze.ts`, `server/scheduling/DueHint.ts`, `orchestration-v2/manualContinuation.ts`, `DispatchModeLimit.ts`).
- **Auto-settle:** inactive threads, merged threads, the number of days, and keeping threads that have a PR (`web/settleAndAdvance.ts`).
- **New-thread options:** response streaming, permission defaults, where "add project" starts, cloning into host folders, and project defaults with per-project overrides and inheritance (`SettingInheritance.tsx`, `scopedSettings.ts`, `settingsScope*.ts`, `ProjectDefaultsSettings*`).
- **Sidebar:**
  - Fold working threads, group by project, pin and reorder threads, and pin projects (`ProjectPinButton.tsx`).
  - Start a thread in the background, start a thread without a project (a scratch project, `useScratchProject.ts`), side chats, and link a PR to a thread.
  - An archived threads page and multi-select of threads (`web/threadSelectionStore.ts`).
  - Undo after archiving or deleting (`SidebarThreadUndoNotice.tsx`).
  - Thread hover cards (`ThreadHoverCard.tsx`) and thread status indicators (`ThreadStatusIndicators.tsx`).
  - A resizable sidebar width (`threadSidebarWidth.ts`).
- **Navigation:** reopen a closed view (`closedViewStore.ts`, `reopenClosedView.ts`, `ReopenClosedViewShortcut.tsx`), back and forward history including swipe (`HistorySwipeNavigation.tsx`, `navigationHistory.ts`), and moving keyboard focus between workspace areas (`keybindingsFocus`, `docs/user/keyboard-focus.md`).
- **Notifications:** thread notifications and background-thread announcements (`threadNotifications.ts`, `ThreadNotificationCoordinator.tsx`, `BackgroundThreadAnnouncer.tsx`).
- **Search:** across message text (`server/orchestration-v2/messageSearchIndex.ts`, migration `069_ThreadMessageSearch.ts`, `ThreadSearchMatch.tsx`) and across project content (`web/components/search/ProjectContentSearchDialog.tsx`).
- **Restarts:** continue threads after the app restarts.
- **Empty state:** a no-projects welcome (`NoProjectsHero.tsx`).

## 5.4 Composer and chat (`docs/user/composer.md`, `web/routes/_chat.settings.chat.tsx`)
- **Prompt editing:** edit an earlier prompt, recall a sent prompt, a suggested next prompt, goals, quoting an assistant reply, send while the agent works, and follow-up behaviour.
- **Sending options:** send in the background, send and start a new thread, and an alternate send.
- **Rich text composer, as an optional toggle:** code blocks with a language picker, list continuation, markdown copy and paste, mentions, inline chips and token paste, undo grouping, and text direction (`web/components/ComposerPromptEditorTiptap.tsx`, `composer-*.ts`, `composerInline*.ts`, `markdown-clipboard.ts`, `textDirection.ts`).
- **Composer settings:** send shortcut, show skills in the slash menu, tool calls in chat.
- **Accessibility:** screen reader announcements and window title (`useLiveRegion.ts`), and an activity log with hidden tool calls (`docs/user/activity-log.md`).
- **Message rendering:** math, GitHub alert boxes (`markdownGithubAlerts`), incremental markdown, chat width, effort display, thread details, composer context, and a find bar inside the chat (`chat.find`).
- **Attachments and files:** attachment upload progress (`useAttachmentUploadProgress.ts`), files in question answers (`questionAttachments.ts`), files outside the workspace, and paths truncated from the start so the file name stays visible (`StartTruncatedPath.tsx`).

## 5.5 Files and previews (`web/components/files/*`)
Compare Tabs' file viewer with T3's previews and fill the gaps:
- **Documents:** PDF pages (`PdfViewer.tsx`, `DocumentPages.tsx`, `server/preview/PdfDocumentNavigation.ts`) and Office documents (`OfficeViewer.tsx`, `OpenXmlOfficeViewer.tsx`).
- **Data and diagrams:** notebooks (`NotebookPreview.tsx`), Mermaid (`MermaidViewer.tsx`) and CSV/TSV tables (`DelimitedTablePreview.tsx`).
- **Media and other files:** fonts (`FontViewer.tsx`), audio (`AudioPreview.tsx`), large text (`LargeTextViewer.tsx`), binary files, and media actions (`web/components/media/*`).
- **Navigation:** breadcrumbs (`FileBreadcrumbs.tsx`) and the project file picker (`ProjectFilePicker*`).

## 5.6 Source control, pull requests and diffs (`web/routes/_chat.settings.source-control.tsx`, `_chat.settings.diffs.tsx`, `docs/user/source-control.md`)
- **Pulling:** automatic pull and a git fetch interval (`server/vcs/VcsAutomaticFetchInterval.ts`).
- **Merging:** default merge method, removing agent credits when merging, and following PR templates.
- **Writing:** commit and PR writing with a writer model (`SourceControlWritingSettings.tsx`), and review guides with their own model and instructions (Tabs has review guides; compare).
- **Accounts:** source-control accounts, app sign-in and tokens (`SourceControlAccountSettings*`, `SourceControlAppSignInSettings.tsx`, `SourceControlTokenSettings.tsx`, `server/sourceControl/SourceControlSignIn.ts`).
- **Projects:** start, clone or publish a project (`server/vcs/CheckoutCloner.ts`).
- **Watching PRs:** a PR watch service and per-file change breakdown (`server/pullRequest/PullRequestWatchService.ts`, `pullRequestChangeBreakdown.ts`), PR routing and sharing settings, and opening the PR and changes panels proactively (`useProactivePanels.ts`).
- **Linking:** a link-PR dialog and candidate picker (`LinkPullRequestDialog.tsx`, `PullRequestCandidatePicker.tsx`), a checks popover (`PullRequestChecksPopover.tsx`), and copy PR number (`pullRequest.copyNumber`).
- **Pages:** a dedicated pull requests page (`web/routes/_chat.pull-requests.tsx`), mark files as viewed, GitHub stacks, and linked pull requests.
- **Diffs:**
  - A file tree (`DiffFileTree.tsx`) and a hide-test-files toggle (`useHideTestFiles.ts`).
  - Inline diff comments (`DiffCommentAnnotation.tsx`; Tabs has review comments, so compare) and scroll restore.
  - Default file state, layout, hide whitespace changes, and diff colours.
- **The PR UI everywhere:**
  - Tabs' side panel PR surface was just redesigned: single-line rows, a compact header with Filters beside New PR, an open PR as a full page with a back button, and `PullRequestPageHead`. It is gated by `redesigned = compact` in `apps/web/src/components/git/PRsPanel.tsx`, with styles under `[data-companion-design]` in `designs.css`.
  - Move the `pr-*` styles to a shared stylesheet and use the same rows, header and page in the Git tool.
  - Redesign the PR detail tabs, inspired by T3's Summary / Timeline / Code (`PullRequestDetailLayout.tsx`, `PullRequestDetailPanel.tsx`, `PullRequestCodeTab.tsx`, `PullRequestComposer.tsx`). Include reviewers and labels with inline add, an editable description, checks, and merge and check-out actions that explain what they will do.
  - Design brief from the user: do not copy T3; make it intuitive and fun for someone new.
  - Update `GitWorkflows.browser.tsx` and `CompanionPRPanel.browser.tsx`.

## 5.7 Worktrees (`web/routes/_chat.settings.worktrees.tsx`, `docs/user/project-settings.md`)
- **Creating:** worktree location, branch naming (`BranchNamingSettings.tsx`), a base-branch picker (`WorktreeBaseBranchPicker.tsx`), start from remote, submodules, and keeping the default branch current.
- **Cleaning up:** cleanup, keeping worktrees with local changes, and restoring a missing worktree (`web/worktreeCleanup.ts`, `server/vcs/worktreeRemoval.ts`, `server/workspace/restoreMissingWorktree.ts`).
- **Speed:** fast checkout on macOS (`server/vcs/worktreeCheckoutCache.ts`, `server/noCopyOnWrite.ts`).
- **Composer:** jump to the previous worktree from the composer (`composer.previousWorktree`).

## 5.8 Connections, environments and access (`_chat.settings.connections.tsx`, `_chat.settings.access.tsx`, `docs/user/remote-access.md`)
- **Environments:** the environments list, linked environments, local environment and PR sharing (`ConnectionsSettings*`, `LinkedEnvironmentsSettings.tsx`, `EnvironmentRoutesList.tsx`, `AddEnvironmentDialog.tsx`, `EnvironmentIconPicker.tsx`), and switching host from the composer (`composer.host`, `composer.cycleHost`).
- **SSH and WSL environments** (`desktop/ssh/*`, `desktop/wsl/*`).
- **Network:** Tailscale HTTPS and network access (Tabs has Tailscale; compare).
- **Devices:** require approval for new devices, authorized clients, and connect-device approval.
- **Guest links:** read-only thread shares (`server/guest/*`, `docs/user/guest-links.md`).
- **Outside agents:** Tabs as an MCP server for other assistants, with sign-in approval (`server/mcp/*`, `server/auth/McpOAuth.ts`, `docs/user/outside-agents.md`). Tabs has MCP pieces; compare.

## 5.9 Browser and preview (`_chat.settings.browser.tsx`)
- **Defaults:** search engine; default appearance, profile, viewport and zoom; browser profiles; agent browser access; auto-show floating preview; "open links in".
- **Recording:** frame rate, and showing key presses and mouse presses.
- **Import and identity:** import sessions from other browsers (`desktop/preview/BrowserImport/*`), passkeys (`desktop/preview/Passkey*`), and using Tabs as the default browser (`docs/user/default-browser.md`).
- **Other:** port discovery (`portDiscoveryState.ts`), the preview mini player (`previewMiniPlayerStore.ts`), browser history and favicons, and find in page (`preview.find`).

## 5.10 General and appearance
- **General:** time format, project grouping and order, the working section, and confirmations (archive, delete, unpin).
- **Quitting:** a quit shortcut with a hold-to-quit overlay (`QuitHoldOverlay.tsx`, `desktop/window/QuitHold.ts`).
- **Notifications:** in-app notifications.
- **Language:** i18n is optional; record it if skipped.
- **Fonts:** separate code, prompt and terminal fonts, font smoothing, contrast and glass opacity.
- **Display:** environment identification and word wrap.
- **Themes:** cycle appearance and select a theme by keyboard, a theme editor (`themeEditor.toggle`), and theme import from VS Code and Open VSX (`vscodeThemeImport.ts`, `openVsxThemes.ts`).
- **Errors:** a render error boundary that keeps the rest of the app usable (`RenderErrorBoundary.tsx`), and a toast for slow requests (`SlowRpcRequestToastCoordinator.tsx`).

## 5.11 Voice (`VoiceSettingsPanel.tsx`; Tabs has voice settings, so compare)
Per-project dictionary, cleanup model and transcript cleanup, correction cue, silence filtering, streaming transcription, transcription language, model unloading, and test microphone / test model.

## 5.12 Terminal
Terminals that persist per thread across navigation (`PersistentThreadTerminals.tsx`), terminal history (`docs/user/terminal.md`), and closing terminals cleanly (`web/components/terminal/*`).

## 5.13 Maintenance, storage and diagnostics
- **Storage and logs:** artifacts and log cleanup with "Delete now", and database maintenance with reclaim space (`server/persistence/DatabaseMaintenance.ts`, `DatabaseStorage.ts`).
- **Background running:** background activity, keep awake while agents work (`server/background/KeepAwake.ts`), and a background service (`docs/user/background-service.md`).
- **Diagnostics:** OpenTelemetry export, resource telemetry and diagnostics.
- **Optional:** managed policy (`server/policy/*`).

## 5.14 Automation and capture
- **Scheduled tasks and webhook automations** (`ScheduledTasksSettings.tsx`, `server/scheduledTasks/webhookFilter.ts`, `webhookDedupe.ts`). Tabs has scheduled tasks; compare.
- **SnapShot screen capture into a thread:** shortcut, flash, sound, animations, and including app text (`desktop/snapShot/*`, `SnapShotSettings*`).

## 5.15 Usage (`web/routes/_chat.usage.tsx`, `web/components/usage/*`, `docs/user/usage.md`)
A usage page with limits (pooled across accounts), per-provider charts, custom model prices, tokens and cost views by day, week, month and quarter (`usage.*` shortcuts), a CLIProxyAPI hub, and a subscription usage widget.

## 5.16 Keyboard commands
Tabs lacks these T3 commands (`packages/contracts/src/keybindings.ts` in both repos). Add each with a sensible default binding, show it in keybinding settings and the command palette, and avoid clashes with Tabs' existing bindings:
- **Appearance and themes:** `appearance.cycle`, `theme.select`, `themeEditor.toggle`.
- **Chat:** `chat.find`, `chat.newWithoutProject`.
- **Composer:** `composer.branch`, `composer.cycleHost`, `composer.decreaseEffort`, `composer.effort`, `composer.host`, `composer.increaseEffort`, `composer.mode`, `composer.previousWorktree`, `composer.sendAlternate`, `composer.sendAndNewThread`, `composer.sendBackground`, `composer.stash`, `composer.workspace`.
- **Navigation and view:** `navigation.back`, `navigation.forward`, `view.reopenClosed`, `workspace.focusNext`, `workspace.focusPrevious`.
- **Panels and preview:** `preview.find`, `pullRequest.copyNumber`, `rightPanel.close`, `rightPanel.new`, `rightPanel.toggleMaximized`, `threadPanel.toggle`.
- **Usage:** `usage.open`, `usage.cost`, `usage.tokens`, `usage.limits`, `usage.period.day`, `usage.period.week`, `usage.period.month`, `usage.period.quarter`.

## 5.17 Everything else
- **Sharing and handoffs:** prompt links and sharing a thread (`web/components/promptLinks/*`, `docs/user/prompt-links.md`), portable handoffs (Tabs has handoffs; compare), and visual replies / MCP apps (`server/mcpApps/*`, `docs/user/html-renders.md`).
- **Issues:** issue triage (`server/triage/*`, `useStartTriage.ts`, `docs/user/triage.md`).
- **Onboarding:** a welcome page (`docs/user/welcome-page.md`, `web/components/onboarding/*`).
- **Command line:** a `tabs` CLI with doctor, install and thread commands (`server/cli/*`, `desktop/app/DesktopCliShim.ts`, `InstallT3Commands.tsx`).
- **Updates:** a stable or beta update track (`desktop/updates/updateChannels.ts`, `UpdateTrackSwitchDialog.tsx`). Keep Tabs' own release pipeline.
- **Command palette:** parity for themes, projects, threads and add project (`web/components/CommandPalette*`).
- **Migration:** migrating threads from older versions (`docs/user/thread-migration.md`).
- **Anything else** you find in T3's docs, settings search or components that Tabs lacks: add it to the inventory and build it if it is small, or list it as a follow-up if it is large.

# 6. Order of work and commits
1. Phase 0 inventory, committed alone.
2. Then 5.1 → 5.17 in order. 5.2 (Devices) may run in parallel with 5.1.
3. Inside each section, do first the items that remove the most daily friction.
4. One commit per feature, each with its tests (unit tests for logic, browser tests for UI). After each section, run the full check list in section 2 before moving on.

# 7. Definition of done
- Everything in section 2's testing list passes at the end.
- `docs/t3-parity.md` ends with a final table showing every item as done, partial (what is left) or skipped (why), the files changed, and a short "how to check it by hand" for each, so a person can verify it in the running app.
- Never mark something done unless its tests pass. When time or scope runs out, stop and record the remaining items in the doc instead of half-building them.
