# T3 Code Mobile App: Complete Architecture, Structure & Design Context

> **Target Audience:** Product Designers, UI/UX Engineers, and Mobile Architects preparing a comprehensive redesign and restructuring of the T3 Code mobile client.
> **Location in Repository:** [`t3code-main/apps/mobile`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile)
> **Analysis Mode:** Read-only ground-truth architectural extraction. No code modified, refactored, or invented.

---

## 1. Stack and Setup

### 1.1 Core Framework & Platform Versions
- **Core Runtime:** React 19.3.0, React Native 0.88.0-rc.3, Expo SDK 58.0.2.
- **Hermes JavaScript Engine:** Running on Hermes runtime (with Hermes profiling support via `profile:android:hermes`).
- **Expo Prebuild / Dev Client:** Bare workflow using Expo Prebuild (`expo prebuild --clean`). Expo Go is **NOT** supported due to extensive custom C++/Swift/Kotlin native modules. Development requires the custom Expo Dev Client (`APP_VARIANT=development expo start --dev-client`).
- **Application Variants:** Configured in [`app.config.ts`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/app.config.ts) via `APP_VARIANT`:
  - `development`: App name `T3 Code Dev`, URL scheme `t3code-dev://`, bundle identifier `com.t3tools.t3code.dev`. Uses `appVersion` runtime versioning policy.
  - `preview`: App name `T3 Code Preview`, URL scheme `t3code-preview://`, bundle identifier `com.t3tools.t3code.preview`. Uses native `fingerprint` runtime versioning policy.
  - `production`: App name `T3 Code`, URL scheme `t3code://`, bundle identifier `com.t3tools.t3code`. Uses native `fingerprint` runtime versioning policy.

### 1.2 Navigation Library
- **Architecture:** React Navigation 7.x static navigation API (`createStaticNavigation` from `@react-navigation/native` v7.3.4).
- **Stack Implementation:** Uses a heavily customized native stack navigator layered over a patched `react-native-screens` (5.0.0-t3.27, local vendor archive `deps/react-native-screens-5.0.0-t3.27.tgz`).
- **Custom Navigators:**
  - [`createV5StackNavigator`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/native/createV5StackNavigator.tsx) & [`createV5SheetStackNavigator`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/native/createV5StackNavigator.tsx): Custom iOS/Android wrappers configuring UIKit native bar morphing, glass navigation bars, and form-sheet detents.
  - [`createWorkspaceStackNavigator`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/layout/createWorkspaceStackNavigator.tsx): Adaptive container projecting split-column layout on iPad / foldable screens and flat stacks on compact phones.
- **Screen Transitions:** Native UIKit push/pop on iOS (`animation: "simple_push"` inside sheets; standard UINavigationController push for root routes); Material shared axis and card slides on Android.

### 1.3 Styling & CSS Engine
- **Engine:** `uniwind` (v1.12.1) + `tailwindcss` (^4.0.0) + `tailwind-merge` (^3.5.0) + `clsx` (^2.1.1).
- **Methodology:** Utility-first Tailwind CSS classes compiled ahead-of-time and at Metro runtime into native stylesheets (`global.css` and `generated-uniwind-themes.css`).
- **Platform Variants:** Custom Uniwind variants `@variant android` and `@variant ios` configured for cross-platform overrides.
- **Dynamic Theming:** CSS variable tokens (`--color-screen`, `--color-card`, `--color-sheet`, `--color-thread-canvas`, etc.) injected at runtime by `AppearancePreferencesProvider` and `useUniwindTheme`.
- **StyleSheet Escape Hatch Policy:** Regulated by custom lint rules in `oxlint-plugin-t3code/rules/no-mobile-uniwind-theme-escape-hatches.ts`. Pure inline hex codes for theme roles are forbidden in application views.

### 1.4 Animation, Gesture & Bottom Sheet Libraries
- **Animations:** `react-native-reanimated` 4.7.0 (with `DISABLE_COMMIT_PAUSING_MECHANISM: true` flag enabled) and `react-native-worklets` 0.13.0.
- **Gestures:** `react-native-gesture-handler` ~3.2.1 (`GestureHandlerRootView`, `ReanimatedSwipeable`, `GestureDetector`).
- **Sheets & Modals:**
  - **iOS:** Native UIKit FormSheet presentation via `react-native-screens` native props (`presentation: "formSheet"`), supporting native detents (`sheetAllowedDetents: [0.55, 0.7, 0.92]`, `sheetGrabberVisible: true`).
  - **Android:** Custom `AppSheet` modal container, full-screen dialogs, or card presentations. (Android cannot host keyboard-focused inputs inside native form sheets without viewport clipping, so keyboard-heavy routes like comment composers promote to full-screen modals).

### 1.5 State Management & Data Fetching
- **Core Paradigm:** Functional reactive programming using [`effect`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/t3code-main/node_modules/effect) (v4.0.0-rc.112) and [`@effect/atom-react`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/t3code-main/node_modules/@effect/atom-react).
- **Atoms Registry:** Application-wide atom registry in [`src/state/atom-registry.ts`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/state/atom-registry.ts) provided via `<RegistryContext.Provider>`.
- **Query / RPC Engine:** Custom Effect RPC layer over WebSockets and HTTP (`packages/client-runtime/src/rpc`), with subscription streams, local caches, and automatic request batching.
- **Local Persistence:** `expo-sqlite` ~58.0.8 (structured storage for outbox queues, offline snapshots, and cached favicons) and `expo-secure-store` ~58.0.2 (cryptographic tokens and connection secrets).

### 1.6 List Engine
- **Library:** `@legendapp/list` (v3.0.0) (`LegendList`, `AnimatedLegendList`).
- **Usage:** Replaces React Native `FlatList` on high-throughput screens (the Thread Inbox feed, Thread Chat activity stream, and Pull Request list). Supports recycling, estimated item heights, and hardware keyboard scroll indexing.

### 1.7 Icons & Brand Imagery
- **iOS:** Native Apple SF Symbols via `expo-symbols` (~58.0.3) wrapped in [`AppSymbol.ios.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/components/AppSymbol.ios.tsx).
- **Android / Fallback:** `@tabler/icons-react-native` (^3.44.0) mapped 1:1 to SF Symbol names in [`AppSymbol.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/components/AppSymbol.tsx).
- **Custom Git SVGs:** Dedicated Tabler icons for Git operations (`file.diff`, `arrow.triangle.pull`, `arrow.triangle.merge`, `arrow.triangle.branch`, `git.commit`, `git.pull-request.closed`, `git.pull-request.draft`).
- **File Icons:** Pierre file icons synchronized via `scripts/sync-pierre-file-icons.mjs`.

### 1.8 Typography & Fonts
- **Font Family:** DM Sans (Google Fonts), loaded via `@expo-google-fonts/dm-sans` (^0.4.2):
  - `DMSans-Regular` (weight 400) -> `--font-sans`
  - `DMSans-Medium` (weight 500) -> `--font-medium` / `font-t3-medium`
  - `DMSans-Bold` (weight 700) -> `--font-bold` / `font-t3-bold` / `font-t3-extrabold` (weight 800)
- **Monospace:** Android uses system `"monospace"`; iOS uses system Menlo / SF Mono.

### 1.9 Notifications & Haptics
- **Notifications:** `expo-notifications` ~58.0.11 (with custom lock protection patch `patches/expo-notifications@57.0.15.patch`) and custom native module `modules/t3-agent-notifications`. Supports APNs and FCM push notifications, channel grouping on Android, and iOS Live Activities via `expo-widgets`.
- **Haptics:** `expo-haptics` ~58.0.4. Used on button taps (`selectionAsync`), swipe triggers (`impactAsync(Medium)`), scan successes (`notificationAsync(Success)`), and destructive deletes (`notificationAsync(Warning)`).

### 1.10 Custom Native Modules (under `apps/mobile/modules/`)
1. `modules/t3-agent-notifications`: Push payload decryption and background sync triggers.
2. `modules/t3-composer-editor`: Rich native text editor (`T3ComposerEditorView`) supporting inline pill tokens, image chips, and paste hooks.
3. `modules/t3-native-controls`: AVKit full-screen video (`T3NativeVideoPresentation.swift`), Quick Look preview (`T3NativeFilePresentation.swift`), and native glass blur.
4. `modules/t3-review-diff` (`@t3tools/mobile-review-diff-native`): High-speed native diff renderer.
5. `modules/t3-source-text` (`@t3tools/mobile-source-text`): Syntax-highlighted source code surface.
6. `modules/t3-subscription-widget`: iOS WidgetKit & Android Glance home screen widget for subscription usage.
7. `modules/t3-terminal` (`@t3tools/mobile-terminal-native`): Native ANSI VT100 PTY terminal emulator.
8. `modules/t3-widget-expiry`: Background widget lifecycle coordinator.

### 1.11 Shared Monorepo Packages
- [`packages/contracts`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/packages/contracts): Effect/Schema types, wire protocols, RPC method descriptors, error classes.
- [`packages/client-runtime`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/packages/client-runtime): Connection supervisor, WebSocket driver, thread state reducers, VCS action managers, outbox processing.
- [`packages/shared`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/packages/shared): Theme palettes, OKLCH conversion, git models, project scripts, tool output formatters.
- Monorepo provider packages: `@t3tools/provider-core`, `@t3tools/provider-acp-registry`, `@t3tools/provider-cursor`, `@t3tools/provider-grok`, `@t3tools/provider-muse`, `@t3tools/provider-opencode`, `@t3tools/provider-pi`.

### 1.12 How to Run Locally
Run commands from the repository root:
- **Prerequisites:** Node 24+, pnpm 11+, Xcode 16+ (for iOS), Android Studio SDK 35+ (for Android).
- **iOS Local Dev Client:**
  ```bash
  # 1. Boot an iOS simulator
  # 2. Verify and build dev client:
  node scripts/mobile-native-client.ts ensure ios <simulator-udid>
  # 3. Start Metro packager:
  vp run --filter @t3tools/mobile dev:client
  # Or run full build and launch:
  vp run --filter @t3tools/mobile ios:dev
  ```
- **iOS Personal Team (Free Developer Account) Build:**
  ```bash
  T3CODE_IOS_PERSONAL_TEAM=1 \
  T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID=com.example.t3code.dev \
  vp run --filter @t3tools/mobile ios:dev
  ```
- **Android Local Dev Client:**
  ```bash
  node scripts/mobile-native-client.ts ensure android <emulator-serial>
  vp run --filter @t3tools/mobile android:dev
  ```
- **Static Native Checks (SwiftLint, Detekt, ktlint):**
  ```bash
  node scripts/mobile-native-static-check.ts
  ```

---

## 2. Folder Structure

```
apps/mobile/
├── app.config.ts                   # Dynamic Expo config: variants, entitlements, plugins, asset maps
├── global.css                      # Tailwind v4 theme layer, typography scale & utilities
├── generated-uniwind-themes.css    # Generated CSS variables for all palettes (OKLCH -> sRGB)
├── index.ts                        # Native app entrypoint; registers root App component
├── package.json                    # Mobile dependencies, native autolinking rules & scripts
├── modules/                        # Custom native Turbo/Expo modules (Swift, Kotlin, C++)
│   ├── t3-agent-notifications/     # Live Activity & background APNs/FCM handling
│   ├── t3-composer-editor/         # Native text view with attachment chips & tokens
│   ├── t3-native-controls/         # AVKit video player, Quick Look file preview, glass effects
│   ├── t3-review-diff/             # High-speed native diff syntax engine
│   ├── t3-source-text/             # Native text surface with syntax highlighting
│   ├── t3-subscription-widget/     # iOS WidgetKit & Android Glance usage widgets
│   ├── t3-terminal/                # Native VT100 PTY emulator surface
│   └── t3-widget-expiry/           # Widget freshness & expiration management
├── plugins/                        # Custom Expo config plugins (Xcode build phases, entitlements)
├── scripts/                        # Uniwind theme generation & Pierre icon synchronizers
└── src/
    ├── App.tsx                     # Root React tree: Providers, linking, keyboard & gesture roots
    ├── Stack.tsx                   # React Navigation 7 root static navigation graph & sheet stacks
    ├── components/                 # Reusable cross-platform UI components & design system tokens
    │   ├── AppSymbol.tsx           # Cross-platform SF Symbol / Tabler icon router
    │   ├── AppText.tsx             # Typography component binding DM Sans font weights
    │   ├── AppSheet.tsx            # Android custom sheet presentation surface
    │   ├── GlassSurface.tsx        # Liquid glass blur backdrop on iOS; solid fallback on Android
    │   ├── ListRow.tsx             # Standard list row with disclosure chevrons & trailing values
    │   ├── MaterialButton.tsx      # MD3-compliant elevated/filled/tonal buttons for Android
    │   ├── ScreenHeader.tsx        # Screen header with title, subtitle, search field, and menus
    │   └── ComposerToolbar.tsx     # Accessory toolbar with scrolling pills and key controls
    ├── connection/                 # Connection catalogs, machine metadata, and pairing models
    ├── features/                   # Domain features & route screens
    │   ├── archive/                # Archived threads listing and restoration
    │   ├── browser/                # Thread desktop browser preview (remote webview streaming)
    │   ├── cloud/                  # T3 Connect account onboarding, Clerk auth, relay pairing
    │   ├── connection/             # Environments list, manual IP connection & QR scanner
    │   ├── devices/                # Remote device simulator preview (shake detector, handles)
    │   ├── diagnostics/            # Local logs, memory dumps, and connection probe diagnostics
    │   ├── files/                  # Thread file tree browser, source viewer, media previews
    │   ├── home/                   # Main inbox screen: thread list v2, swipe actions, filter dock
    │   ├── keyboard/               # Hardware keyboard shortcuts (Cmd+K, Cmd+N, arrow navigation)
    │   ├── layout/                 # Adaptive layout: split-view columns for tablet vs single stack
    │   ├── projects/               # Add project wizard (local directory, git clone, templates)
    │   ├── pull-requests/          # PR inbox, file diffs, inline discussion, review submission
    │   ├── review/                 # Git working-directory diff review, hunk comment composer
    │   ├── settings/               # Settings screens: Appearance, Accounts, Server controls, Legal
    │   ├── terminal/               # Embedded terminal screen, virtual accessory keys, session tabs
    │   ├── threads/                # Chat/thread view, composer, approval cards, agent subagents
    │   ├── usage/                  # LLM quota progress, token charts, account pool breakdown
    │   ├── voice-input/            # Real-time microphone audio recording & transcription
    │   └── workspace/              # Root tabs wrapper (Threads vs PRs) & Android workspace navigation
    ├── lib/                        # Formatting, layout metrics, theme math, time helpers
    ├── native/                     # React Native bridge wrappers (glass, layout metrics, headers)
    ├── persistence/                # SQLite migrations, secure storage, and preference persistence
    ├── state/                      # Effect atom definitions, queries, commands, and outbox model
    └── widgets/                    # Subscription usage widget synchronizer & coordinators
```

---

## 3. Navigation Map

### 3.1 Route Hierarchy (ASCII Tree)
```
RootStack (AdaptiveWorkspaceLayout: Split-View on Tablet / Single Stack on Phone)
│
├── Home [Route: ""] (WorkspaceRootScreen)
│   ├── Tab: "threads" -> HomeRouteScreen (Thread List v2 Inbox)
│   └── Tab: "pullRequests" -> PullRequestsScreen (PR Workspace List)
│
├── Thread [Route: "threads/:environmentId/:threadId"] (ThreadRouteScreen -> ThreadDetailScreen)
│   ├── ThreadFiles [Route: ".../files"] (ThreadFilesTreeScreen)
│   │   └── ThreadFile [Route: ".../files/:path*"] (ThreadFileScreen - Syntax Highlighting)
│   ├── ThreadAttachment [Route: ".../attachments/:attachmentId"] (AttachmentFileScreen)
│   ├── ThreadTerminal [Route: ".../terminal"] (ThreadTerminalRouteScreen)
│   ├── ThreadReview [Route: ".../review"] (ReviewSheet - Multi-file Diff)
│   │   └── ThreadReviewComment [Sheet: ".../review-comment"] (ReviewCommentComposerSheet)
│   ├── ThreadDevicePreview [Modal: ".../devices"] (DevicePreviewRouteScreen - Remote Screen)
│   ├── ThreadBrowserPreview [Modal: ".../browser"] (BrowserPreviewRouteScreen - Remote Web Browser)
│   └── ThreadMcpApp [Modal: ".../apps/:itemId"] (McpAppFullscreenScreen - Interactive Webview)
│
├── Thread Modals & Form Sheets (Overlaid on Thread):
│   ├── ThreadSettingsSheet [Sheet] (ExistingThreadSettingsRouteScreen - Model, Provider, Mode)
│   ├── ThreadQueueSheet [Sheet] (ThreadQueueSheet - Queued & Outbox Prompts)
│   ├── ThreadAgentsSheet [Sheet] (ThreadAgentsSheet - Subagent Lineage & Status)
│   ├── CustomSnoozeSheet [Sheet] (CustomSnoozeSheet - Date/Time Snooze Picker)
│   ├── GitOverview [Sheet: ".../git"] (GitOverviewSheet - Status & Branch Summary)
│   │   ├── GitCommit [Sheet: ".../git/commit"] (GitCommitSheet - Commit Staged Changes)
│   │   ├── GitBranches [Sheet: ".../git/branches"] (GitBranchesSheet - Switch/Create Branch)
│   │   └── GitConfirm [Sheet: ".../git-confirm"] (GitConfirmSheet - Merge Back / Rebase Confirm)
│
├── PullRequest [Route: "pull-requests/:environmentId/:projectId/:repository/:number"] (PullRequestRouteScreen)
│   ├── PullRequestFile [Route] (PullRequestFileRouteScreen - Single File Diff)
│   ├── PullRequestFiles [Sheet] (PullRequestFilesRouteScreen - Changed Files List Drawer)
│   ├── PullRequestDiscussion [Route] (PullRequestDiscussionScreen - Comments & Timeline)
│   ├── PullRequestReviewers [Sheet] (PullRequestReviewersScreen - Edit Reviewers)
│   ├── PullRequestReview [Sheet] (PullRequestReviewSheet - Approve / Request Changes / Comment)
│   ├── PullRequestInlineComment [Sheet/Modal] (PullRequestInlineCommentScreen - Line Note)
│   └── PullRequestGuideStop [Route] (PullRequestGuideStopScreen - AI Review Guide Tour)
│
├── NewTaskSheet [Sheet: "new"] (NewTaskSheetStack)
│   ├── NewTask [Route: ""] (NewTaskRouteScreen - Project Picker & Scratch Project)
│   ├── NewTaskDraft [Route: "draft"] (NewTaskDraftRouteScreen - Prompt Composer)
│   │   ├── NewTaskEnvironment [Route: "draft/environment"] (NewTaskEnvironmentPickerRouteScreen)
│   │   ├── NewTaskBranch [Route: "draft/branch"] (NewTaskBranchPickerRouteScreen)
│   │   ├── NewTaskFile [Route: "draft/files/:path*"] (ThreadFileScreen)
│   │   ├── NewTaskAttachment [Route: "draft/attachments/:attachmentId"] (AttachmentFileScreen)
│   │   └── ThreadSettings [Sheet: "draft/settings"] (NewTaskThreadSettingsRouteScreen)
│   └── AddProject [Route: "add-project"] (AddProjectSourceRoute - Local vs Repository Clone)
│       ├── AddProjectRepository [Route: "add-project/repository"] (AddProjectRepositoryRoute)
│       ├── AddProjectDestination [Route: "add-project/destination"] (AddProjectDestinationRoute)
│       ├── AddProjectLocal [Route: "add-project/local"] (AddProjectLocalRoute)
│       └── AddProjectNew [Route: "add-project/new"] (AddProjectNewRoute)
│
├── Connections [Sheet/Card: "connections"] (ConnectionsRouteScreen - Environments List)
│   └── ConnectionsNew [Sheet: "connections/new"] (ConnectionsNewRouteScreen - QR & Manual Pairing)
├── ConnectOnboarding [Sheet: "connect-onboarding"] (ConnectOnboardingRouteScreen - T3 Connect GA Setup)
│
├── SettingsSheet [Sheet/Card: "settings"] (SettingsSheetStack)
│   ├── SettingsAuth [Route: "auth"] (SettingsAuthRouteScreen - Clerk Sign In/Up)
│   └── SettingsContent (SettingsContentStack)
│       ├── Settings [Route: ""] (SettingsRouteScreen - Settings Index)
│       ├── SettingsEnvironments [Route: "environments"] (SettingsEnvironmentsRouteScreen)
│       │   └── SettingsEnvironmentDetail [Route: "environments/:environmentId"]
│       ├── SettingsEnvironmentNewThreads [Route: "new-threads"] (Server New Thread Controls)
│       ├── SettingsEnvironmentSourceControl [Route: "source-control"] (Server Git Controls)
│       ├── SettingsEnvironmentAgentBehavior [Route: "agent-behavior"] (Server Agent Controls)
│       ├── SettingsEnvironmentMaintenance [Route: "maintenance"] (Server Disk/Cache Controls)
│       ├── SettingsProviderAccounts [Route: "provider-accounts"] (API Keys & Profiles)
│       ├── SettingsNotifications [Route: "notifications"] (APNs / Push Preferences)
│       ├── SettingsThreads [Route: "thread-preferences"] (Auto-settle & Snooze Rules)
│       ├── SettingsAppearance [Route: "appearance"] (Themes, Appearance Mode, Code Surface)
│       ├── SettingsProjectGrouping [Route: "project-grouping"] (Organization by Dir / Machine)
│       ├── SettingsProjectOverview [Route: "project"] (Project Scripts, Path & Stats)
│       ├── SettingsKeyboard [Route: "keyboard"] (Hardware Shortcut Cheatsheet)
│       ├── SettingsMicrophone [Route: "microphone"] (Voice Input & On-Device Dictation)
│       ├── SettingsFollowUp [Route: "follow-ups"] (Steer vs Queue Turn Dispatch Behavior)
│       ├── SettingsScheduledTasks [Route: "scheduled-tasks"] (Cron / Recurring Automations)
│       │   ├── SettingsScheduledTaskNew [Route: "scheduled-tasks/new"]
│       │   ├── SettingsScheduledTaskEdit [Route: "scheduled-tasks/:taskId"]
│       │   ├── SettingsScheduledTaskBranch [Route: "scheduled-tasks/branch"]
│       │   └── SettingsScheduledTaskModel [Route: "scheduled-tasks/model"]
│       ├── SettingsUsage [Route: "usage"] (Token Consumption & Model Quota Breakdown)
│       │   └── SettingsUsageAccount [Route] (Account Pooled Quota Detail)
│       ├── SettingsArchive [Route: "archive"] (ArchivedThreadsRouteScreen)
│       ├── SettingsClientStorage [Route: "client-storage"] (Local SQLite & Cache Wipe)
│       ├── SettingsDiagnostics [Route: "diagnostics"] (Log Inspector & Connection Probe)
│       ├── SettingsAbout [Route: "about"] (Version, Build, Commit)
│       ├── SettingsOpenSourceLicenses [Route: "open-source-licenses"]
│       │   └── SettingsOpenSourceLicense [Route: "open-source-licenses/:entryKey"]
│       └── SettingsLegal [FullScreenModal: "settings/legal"] (SettingsLegalRouteScreen)
│
└── NotFound [Route: "*"] (NotFoundScreen - Catch-all fallback)
```

### 3.2 Deep Linking Schema
- **URL Schemes:** `t3code://`, `t3code-dev://`, `t3code-preview://`, and HTTPS app linking.
- **Deep Link Patterns:**
  - `threads/:environmentId/:threadId` -> Directly opens thread chat.
  - `threads/:environmentId/:threadId/terminal` -> Opens terminal in that thread.
  - `threads/:environmentId/:threadId/review` -> Opens working directory diff.
  - `threads/:environmentId/:threadId/files/:path*` -> Opens file in thread worktree.
  - `pull-requests/:environmentId/:projectId/:repository/:number` -> Opens PR review view.
  - `new?prompt=...&repo=...&branch=...` -> Prefills new task draft.
  - `connections/new?pairingUrl=...` -> Launches pairing view with host prefilled (dev mode only).

### 3.3 Gestures & Interactive Dismissals
- **Interactive Full-Screen Back Gesture:** Standard iOS edge-swipe back is preserved across all stack screens. Custom horizontal scrollviews (such as diffs, code blocks, and markdown tables) explicitly yield to UIKit full-screen back gestures via native gesture delegates in the `react-native-screens` patch.
- **Interactive Sheet Drag:** Form sheets dismiss interactively by dragging down the native grabber or top surface.
- **Swipeable Rows:** In the Thread Inbox, rows swipe left/right with spring animations for fast Settle, Snooze, and Delete actions.
- **Physical Shake:** On `DevicePreviewRouteScreen`, shaking the phone triggers an accelerometer threshold that toggles the floating control overlay.

---

## 4. Screen-by-Screen Inventory

---

### Screen 1: Home / Thread Inbox (`WorkspaceRootScreen` & `HomeScreen`)
- **File Paths:**
  - Container: [`src/features/workspace/WorkspaceRootScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/workspace/WorkspaceRootScreen.tsx)
  - Route: [`src/features/home/HomeRouteScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/home/HomeRouteScreen.tsx)
  - List View: [`src/features/home/HomeScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/home/HomeScreen.tsx)
  - Row Elements: [`src/features/threads/thread-list-v2-items.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/threads/thread-list-v2-items.tsx)
- **Purpose:** Primary hub showing active agent work, approval alerts, inbox threads, and snoozed/settled history.
- **Layout (Top to Bottom):**
  1. **Native Header:** Compact brand logo (`T3 Code`), connection status pill (tap opens Environments), search icon, settings gear icon.
  2. **Filter & Search Bar:** Pinned search input with text debounce and filter pill row (Environment, Project, Working, Snoozed, Settled).
  3. **Working Shelf (Accordion):** High-priority shelf containing threads currently executing actions.
  4. **Active Inbox Section:** Flat list of threads needing attention or ongoing conversation.
  5. **Snoozed Shelf (Accordion):** Foldable shelf for threads deferred to a future time.
  6. **Settled Shelf (Accordion):** Compact list of finished threads with pagination ("Show N more").
  7. **Floating Action Dock / FAB:** Floating dock on iOS (Search, Filter, New Task pill); Material FAB on Android.
- **Wireframe:**
```
+-----------------------------------------------------------+
| [T3 Code] (o) Connected - Work Mac        [Search] [Gear] |
|-----------------------------------------------------------|
| [ Search threads...                                     ] |
| [All Envs v] [All Projects v] [Needs Action] [Working (2)] |
|-----------------------------------------------------------|
| v WORKING (2)                                             |
|   [*] tabs-app • feat/auth              2m ago • Sky Blue |
|       Fix token refresh loop in OAuth middleware          |
|-----------------------------------------------------------|
| INBOX                                                     |
|   [!] client-runtime • fix/pty           5m ago • Amber   |
|       APPROVAL: Run command `npm install node-pty`        |
|                                                           |
|   [?] tabs-mobile • design/theme        12m ago • Indigo  |
|       INPUT: Select primary accent color (5 options)      |
|                                                           |
|   [#] marketing • chore/copy            1h ago  • Normal  |
|       Changelog draft for v2.4 launch ready               |
|-----------------------------------------------------------|
| > SNOOZED (1)                                             |
| > SETTLED (14)                                            |
|   Show 10 more settled threads...                         |
|-----------------------------------------------------------|
|           [  (Filter)   (+) New Task   (Tabs)  ]          |
+-----------------------------------------------------------+
```
- **Data Shown & Sources:**
  - Thread Title (`thread.title`), Project Name (`project.title`), Branch Name (`thread.branch`), Relative Time (`thread.updatedAt`).
  - Status Badge: `approval` (Amber), `input` (Indigo), `working` (Sky), `waiting` (Muted), `failed` (Red), `done` (Emerald).
  - Outbox pending badges: `queuedMessages` count from `useQueuedThreadKeys()`.
  - Data sources: `environmentThreadShells.navigationThreadShellsAtom` via WebSocket stream `orchestrationV2.shellStream`.
- **Interactions:**
  - Tap row: Navigates to `ThreadRouteScreen`.
  - Swipe left: Settle (Emerald checkmark) or Un-settle.
  - Swipe right: Snooze presets menu or Delete confirmation.
  - Long press row: Context menu (Settle, Snooze, Pin, Rename, Regenerate Title, Fork, New Task on Branch, Delete).
  - Tap Header Connection: Opens `ConnectionsRouteScreen`.
  - Tap FAB / New Task: Opens `NewTaskSheet`.
- **States:**
  - `loading`: Full skeleton loader with pulsing row placeholders.
  - `empty`: Centered illustration with "No threads found" and "Create New Task" button.
  - `error`: Warning banner at top with reconnect trigger.
  - `connecting`: Header status pill pulses yellow with spinner.
- **Animations & Haptics:** Reanimated spring row entry/exit (`PR_ROW_ENTER`, `PR_ROW_EXIT`); medium haptic impact on swipe threshold.

---

### Screen 2: Thread / Chat Detail View (`ThreadRouteScreen` & `ThreadDetailScreen`)
- **File Paths:**
  - Route: [`src/features/threads/ThreadRouteScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/threads/ThreadRouteScreen.tsx)
  - Detail Screen: [`src/features/threads/ThreadDetailScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/threads/ThreadDetailScreen.tsx)
  - Composer: [`src/features/threads/ThreadComposer.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/threads/ThreadComposer.tsx)
  - Feed: [`src/features/threads/ThreadFeed.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/threads/ThreadFeed.tsx)
- **Purpose:** Full interactive workspace session with an AI agent; renders conversational history, live tools, diffs, approvals, subagents, and input prompt composer.
- **Layout (Top to Bottom):**
  1. **Native Glass Header:** Back button, Thread title, Project subtitle, Trailing actions (Files icon, Terminal icon, Review Diff icon, More options menu).
  2. **Notice Banners (Conditional):** Connection error banner, Worktree setup banner (`WorktreeSetupCard`), Usage limit warning (`UsageLimitRecoveryCard`).
  3. **Activity Feed (`LegendList`):**
     - User messages with file/image attachment chips.
     - Agent reasoning accordion (expandable markdown).
     - Tool call accordions (file reads, terminal runs, web searches).
     - Live file change cards (additions/deletions diff summary).
     - Proposed plan cards & interactive todo lists.
     - Interactive Approval Card (`PendingApprovalCard`) with Allow / Deny buttons.
     - Interactive Question Card (`PendingUserInputCard`) with single/multi-choice pills or custom input.
  4. **Floating Working Control:** Bottom-floating glass pill appearing while agent runs, showing live elapsed time ("Working 42s...") and Stop button.
  5. **Queued Edit Banner:** Shows when editing a prompt that was enqueued while the agent was running.
  6. **Composer Dock:** Expandable text box, attachment preview strip, Model Selection chip (e.g. `Claude 3.7 Sonnet`), Mode chip (`Normal` vs `Plan`), Dictation mic button, and Send/Stop button.
- **Wireframe:**
```
+-----------------------------------------------------------+
| [<] Fix OAuth token refresh          [Files] [>_] [Diff]  |
|     tabs-app • main                                       |
|-----------------------------------------------------------|
| [User Bubble]                                             |
| Can you investigate why tokens fail to refresh on iOS?    |
| [Attachment: screenshot.png]                              |
|-----------------------------------------------------------|
| [Agent]                                                   |
| > Thinking (expanded for 14s)                             |
|   Inspecting token exchange in authStore.ts...            |
|                                                           |
| [Tool: Read File] packages/shared/src/authStore.ts        |
|                                                           |
| [APPROVAL REQUIRED]                                       |
| Agent wants to execute:                                   |
| `curl -X POST https://api.t3.codes/auth/refresh`          |
| [ Deny ]                             [ Allow Once ]       |
|-----------------------------------------------------------|
|             (o) Working on task (24s)  [■ Stop]           |
|-----------------------------------------------------------|
| [Attachment: error.log (x)]                               |
| [Message agent...                                     (^) |
| [ Claude 3.7 Sonnet v ] [ Plan Mode ]       [Mic] [Send]  |
+-----------------------------------------------------------+
```
- **Data Shown & Sources:**
  - Messages and tool execution trees from `useSelectedThreadDetailState()`.
  - Live approval state: `activePendingApproval` (`OrchestrationV2RuntimeRequest`).
  - Questions: `activePendingUserInput` (`OrchestrationV2UserInputQuestion`).
  - Active model: `thread.modelSelection` (`ModelSelection`).
- **Interactions:**
  - Tap Files / Terminal / Diff in header: Opens respective sheets or screens.
  - Tap Allow / Deny on Approval: Submits RPC decision via `onRespondToApproval`.
  - Tap Question Option: Selects radio choice or enters custom text.
  - Tap Stop button on floating control: Aborts active agent run immediately.
  - Tap Model chip: Opens `ThreadSettingsSheet` to pick provider/model/effort.
  - Hold Mic button: Records audio dictation with real-time waveform metering.
  - Type `/` in composer: Opens slash command & custom skills popover.
- **States:**
  - `loading`: Shows centered `AppActivityIndicator` while initial snapshot hydrates over WebSocket.
  - `working`: Composer shows Stop icon; floating timer pill visible; cursor animates.
  - `approval-needed`: Feed scrolls automatically to anchor `PendingApprovalCard`; amber status pill in header.
  - `offline/unsent`: Messages added to outbox display a hollow clock icon; banners notify "Delivering when reconnected".

---

### Screen 3: Environments & Machines (`ConnectionsRouteScreen`)
- **File Path:** [`src/features/connection/ConnectionsRouteScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/connection/ConnectionsRouteScreen.tsx)
- **Purpose:** Lists all paired host machines (desktop laptops, remote servers, cloud containers) and GitHub routing configuration.
- **Layout (Top to Bottom):**
  1. Header with "Environments" title and `(+)` Add Environment button.
  2. **Connected Machines List:** Cards for each host displaying machine icon (MacBook, Linux tower, Mac Studio), host name, connection status dot (green/yellow/red), latency, and quick actions (Reconnect, Toggle, Remove).
  3. **GitHub Routing Settings:** Section configuring which paired machine handles background GitHub webhook triggers and PR auto-review agents.
- **Wireframe:**
```
+-----------------------------------------------------------+
| Environments                                          (+) |
|-----------------------------------------------------------|
| LOCAL & REMOTE ENVIRONMENTS                               |
| +-------------------------------------------------------+ |
| | [Laptop] MacBook Pro (Work)           (o) Connected   | |
| |          192.168.1.140:3000 • Protocol v2 • 12ms      | |
| |          [ Reconnect ] [ Machine Details v ]          | |
| +-------------------------------------------------------+ |
| +-------------------------------------------------------+ |
| | [Server] Dev Box (Ubuntu 24)          (x) Offline     | |
| |          dev.internal.t3.codes:8443                   | |
| |          [ Reconnect ] [ Remove ]                     | |
| +-------------------------------------------------------+ |
|                                                           |
| GITHUB ROUTING                                            |
| Routes incoming webhooks & PR events to a machine:        |
| [ Route to: MacBook Pro (Work)                          v]|
+-----------------------------------------------------------+
```
- **Data Shown:** Environment ID, machine shape (`platform.machine`), OS/Arch, pairing URL host, active connection phase (`connected`, `reconnecting`, `failed`), capability flags.
- **Interactions:**
  - Tap `(+)`: Navigates to `ConnectionsNewRouteScreen`.
  - Tap Reconnect: Triggers WebSocket reconnection via `useRemoteConnections().onReconnectEnvironment()`.
  - Tap Remove: Shows native alert confirmation to delete host credentials from SecureStore.

---

### Screen 4: Pairing & Add Environment (`ConnectionsNewRouteScreen`)
- **File Path:** [`src/features/connection/ConnectionsNewRouteScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/connection/ConnectionsNewRouteScreen.tsx)
- **Purpose:** Pair the mobile app with a running desktop app or headless server via camera QR code scanning or manual address entry.
- **Layout (Top to Bottom):**
  1. Header: "Add Environment" with cancel button.
  2. **Camera QR Viewfinder:** Live `CameraView` with frosted glass cutout overlay and target reticle.
  3. **Instructions Text:** "Scan the QR code shown in T3 Code Desktop Settings -> Environments."
  4. **Manual Entry Section (Accordion / Form):**
     - Server Address input field (`hostInput`, e.g. `192.168.1.50:3000`).
     - Pairing Token input field (`codeInput`).
     - "Connect" prominent button.
  5. **Cloud Environments (T3 Connect):** If user is signed into Clerk, lists machines registered to their account with one-tap "Connect" buttons.
- **Wireframe:**
```
+-----------------------------------------------------------+
| [Cancel]               Add Environment                    |
|-----------------------------------------------------------|
| +-------------------------------------------------------+ |
| |               [ CAMERA SCANNER ACTIVE ]               | |
| |                      +---------+                      | |
| |                      | [QR BOX]|                      | |
| |                      +---------+                      | |
| +-------------------------------------------------------+ |
| Scan the pairing QR code in T3 Code Desktop               |
|                                                           |
| --- OR ENTER MANUALLY ----------------------------------- |
| Server Address:                                           |
| [ https://192.168.1.140:3000                            ] |
| Pairing Code / Token:                                     |
| [ 9b8c2e1f-4a3d-4c8e-90ab-1234567890cd                  ] |
|                                                           |
| [                   Connect Environment                 ] |
+-----------------------------------------------------------+
```
- **Interactions:**
  - Align camera with QR: Emits success haptic, extracts token, and navigates immediately.
  - Tap Connect: Encodes token in hash parameter, tests handshake, and saves record.

---

### Screen 5: Terminal (`ThreadTerminalRouteScreen` & `TerminalContextSheet`)
- **File Path:** [`src/features/terminal/ThreadTerminalRouteScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/terminal/ThreadTerminalRouteScreen.tsx)
- **Purpose:** Full PTY shell connected to the thread's worktree on the host machine.
- **Layout (Top to Bottom):**
  1. **Header:** Title (e.g. `Terminal: term-1`), Project subtitle, Session switcher dropdown, Font size controls (`A-` / `A+`), Kill session button.
  2. **Terminal Surface:** Native VT100 ANSI canvas (`NativeTerminalSurface`) rendering monospaced output buffer, cursor, and selections.
  3. **Output Action Bar:** "Attach visible output to prompt" button.
  4. **Virtual Key Accessory Bar (Fixed above soft keyboard):**
     - Horizontal scrolling keys: `ESC`, `CMD`, `CTRL`, `ALT`, `TAB`, `PASTE`, `CLEAR`, `↑`, `↓`, `←`, `→`, `~`, `|`, `/`, `-`.
     - Keyboard dismiss button.
- **Wireframe:**
```
+-----------------------------------------------------------+
| [<] Terminal (term-1)                    [A-] [A+] [Kill] |
|     tabs-app • term-1 (zsh)                               |
|-----------------------------------------------------------|
| rushil@MacBook-Pro tabs-app % git status                  |
| On branch feat/auth                                       |
| Changes not staged for commit:                            |
|   modified:   apps/server/src/auth.ts                     |
|                                                           |
| rushil@MacBook-Pro tabs-app % pnpm test                   |
| PASS apps/server/src/auth.test.ts                         |
|                                                           |
| █                                                         |
|-----------------------------------------------------------|
| [  [+] Attach visible terminal output to thread prompt  ] |
|-----------------------------------------------------------|
| [ESC] [CMD] [CTRL] [TAB] [PASTE] [CLEAR] [↑] [↓] [←] [→] [v]
| [ Q ] [ W ] [ E ] [ R ] [ T ] [ Y ] [ U ] [ I ] [ O ] [ P ]
+-----------------------------------------------------------+
```
- **Data & Transport:** Streamed over WebSocket via RPC calls `terminal.write`, `terminal.resize`, and subscription `terminal.observe`.
- **Interactions:** Tap accessory key sends raw ANSI escape code (e.g. `\u001b` for ESC, `\t` for TAB, arrow sequences `\u001b[A`).

---

### Screen 6: File Browser & File Viewer (`ThreadFilesRouteScreen`)
- **File Paths:**
  - Tree & Viewer: [`src/features/files/ThreadFilesRouteScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/files/ThreadFilesRouteScreen.tsx)
  - Attachment Viewer: [`src/features/files/AttachmentFileScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/files/AttachmentFileScreen.tsx)
- **Purpose:** Browse directory tree of the repository/worktree; view source code with syntax highlighting, markdown preview, image/video playback, and audio previews.
- **Layout (Top to Bottom):**
  - **Tree Mode:** Header with search input; hierarchical folder list with disclosure icons, file extension icons (Pierre icons), and file sizes.
  - **Viewer Mode:** Breadcrumb path header, Raw/Preview toggle (for Markdown/HTML), syntax highlighted code surface (`SourceFileSurface` using Shiki or native text module) with line numbers.
- **Wireframe:**
```
+-----------------------------------------------------------+
| [<] Files: tabs-app                                       |
| [ Search repository files...                            ] |
|-----------------------------------------------------------|
| v apps/                                                   |
|   v mobile/                                               |
|     > src/                                                |
|       [TS] Stack.tsx                             41.5 KB  |
|       [TS] App.tsx                                4.5 KB  |
|       [CSS] global.css                            1.6 KB  |
|     [JSON] package.json                           7.8 KB  |
|   > server/                                               |
|   > web/                                                  |
| > packages/                                               |
| [MD] README.md                                    5.3 KB  |
+-----------------------------------------------------------+
```

---

### Screen 7: Git Diff & Review (`ReviewSheet` & `ReviewCommentComposerSheet`)
- **File Paths:**
  - Review Diff: [`src/features/review/ReviewSheet.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/review/ReviewSheet.tsx)
  - Line Comment: [`src/features/review/ReviewCommentComposerSheet.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/review/ReviewCommentComposerSheet.tsx)
- **Purpose:** Review uncommitted working directory changes or commit diffs; leave line-by-line comments for the agent.
- **Layout (Top to Bottom):**
  1. **Header:** Title (e.g. `Review Changes`), diff count pill (`+24 -12`), Changed files toggle drawer, Section selector (Working Directory vs Base Branch).
  2. **Diff Surface:** Unified/Split diff view with file headers, sticky hunk headers, syntax-colored additions (green) and deletions (red).
  3. **Comment Composer Sheet (When line tapped):** Line number context preview, text input to write feedback/correction, "Add to Prompt" button.
- **Wireframe:**
```
+-----------------------------------------------------------+
| [<] Review: feat/auth                    (+34 -12) [Files]|
|-----------------------------------------------------------|
| [Section: Uncommitted Changes v]                          |
|                                                           |
| apps/mobile/src/Stack.tsx                                 |
| @@ -14,6 +14,8 @@                                         |
|   import { View } from "react-native";                    |
| + import { ReviewSheet } from "./features/review";        |
| + import { TerminalSheet } from "./features/terminal";    |
|   import { HomeScreen } from "./features/home";           |
|                                                           |
| apps/server/src/auth.ts                                   |
| @@ -88,4 +88,2 @@                                         |
| - const oldToken = req.headers["token"];                  |
| + const bearer = req.headers.authorization;               |
|-----------------------------------------------------------|
| [Tap any line to attach a review comment for the agent]   |
+-----------------------------------------------------------+
```

---

### Screen 8: Git Overview & Actions (`GitOverviewSheet`, `GitCommitSheet`, `GitBranchesSheet`)
- **File Paths:**
  - Overview: [`src/features/threads/git/GitOverviewSheet.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/threads/git/GitOverviewSheet.tsx)
  - Commit: [`src/features/threads/git/GitCommitSheet.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/threads/git/GitCommitSheet.tsx)
  - Branches: [`src/features/threads/git/GitBranchesSheet.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/threads/git/GitBranchesSheet.tsx)
- **Purpose:** Full source control hub for the current thread: check branch status, stage/unstage files, draft commit messages, switch branches, push/pull, merge back.
- **Wireframe:**
```
+-----------------------------------------------------------+
| Git Overview                                          (X) |
|-----------------------------------------------------------|
| CURRENT BRANCH                                            |
| [Branch] feat/auth -> origin/feat/auth                    |
|          1 commit ahead, 0 behind                         |
|                                                           |
| WORKING TREE STATUS                                       |
| 3 changed files (2 staged, 1 unstaged)                    |
| [ Review Diffs ]                 [ Commit Staged (2) ]    |
|                                                           |
| ACTIONS                                                   |
| [Git Push] Push commits to origin                         |
| [Git Pull] Pull remote changes                            |
| [Branches] Switch or create new branch...                 |
| [Merge]    Merge back into main...                        |
+-----------------------------------------------------------+
```

---

### Screen 9: Pull Request Workspace (`PullRequestRouteScreen` & `PullRequestsScreen`)
- **File Paths:**
  - PR List: [`src/features/pull-requests/PullRequestsScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/pull-requests/PullRequestsScreen.tsx)
  - PR Detail: [`src/features/pull-requests/PullRequestRouteScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/pull-requests/PullRequestRouteScreen.tsx)
  - PR Review Sheet: [`src/features/pull-requests/PullRequestReviewSheet.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/pull-requests/PullRequestReviewSheet.tsx)
- **Purpose:** Full PR client supporting GitHub, Forgejo, GitLab: browse open PRs, read descriptions, inspect checks, review multi-file diffs with viewed markers, and submit approvals or change requests.
- **Layout (Top to Bottom):**
  1. Header with PR # and repository name, branch badges (`feat/auth` -> `main`).
  2. Tab Bar: Segmented control (`Overview`, `Files (8)`, `Discussion (4)`).
  3. Overview tab: Status pill (`Open`, `Merged`, `Closed`), checks status (`12/12 passing`), author avatar, markdown body, review decision cards.
  4. Files tab: List of changed files with checkboxes for "Mark as viewed", expandable syntax diffs, inline comments.
  5. Bottom Action Bar: "Submit Review" (Approve / Request Changes), "Merge PR", "Checkout in New Thread".

---

### Screen 10: New Task Flow (`NewTaskRouteScreen` & `NewTaskDraftRouteScreen`)
- **File Paths:**
  - Project Picker: [`src/features/threads/NewTaskRouteScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/threads/NewTaskRouteScreen.tsx)
  - Draft Screen: [`src/features/threads/NewTaskDraftRouteScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/threads/NewTaskDraftRouteScreen.tsx)
- **Purpose:** Start a new agent session. Choose an existing project or create a scratch task, select target environment/branch, compose initial prompt, and launch.
- **Wireframe:**
```
+-----------------------------------------------------------+
| [Cancel]               New Task                           |
|-----------------------------------------------------------|
| CHOOSE PROJECT                                            |
| [ + Scratch Workspace (Temporary directory)             ] |
|                                                           |
| RECENT PROJECTS                                           |
| [Folder] tabs-app           MacBook Pro • ~/Desktop/tabs  |
| [Folder] client-runtime     MacBook Pro • ~/repos/client  |
| [Folder] marketing-site     Ubuntu Server • /srv/web      |
|                                                           |
| [ (+) Add or Clone New Project...                       ] |
+-----------------------------------------------------------+
```
- In Draft Step: Shows prompt editor, attachments, model selector, branch picker, and "Start Task" button.

---

### Screen 11: Remote Device & Browser Previews (`DevicePreviewRouteScreen` & `BrowserPreviewRouteScreen`)
- **File Paths:**
  - Device: [`src/features/devices/DevicePreviewRouteScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/devices/DevicePreviewRouteScreen.tsx)
  - Browser: [`src/features/browser/BrowserPreviewRouteScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/browser/BrowserPreviewRouteScreen.tsx)
- **Purpose:** Stream live interactive mirrors of simulators, dev servers, or headless browser sessions running on the host machine.
- **Interactions:** Touch events forwarded over WebSocket; shake gesture or handle tap displays floating navigation toolbar (URL bar, reload, back, close).

---

### Screen 12: MCP App Fullscreen (`McpAppFullscreenScreen`)
- **File Path:** [`src/features/threads/McpAppFullscreenScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/threads/McpAppFullscreenScreen.tsx)
- **Purpose:** Dedicated modal webview running interactive UI widgets generated by Model Context Protocol tools (`ui/request-display-mode`).

---

### Screen 13: Settings Hierarchy (`SettingsRouteScreen` & sub-routes)
- **File Path:** [`src/features/settings/SettingsRouteScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/settings/SettingsRouteScreen.tsx)
- **Structure:**
  - **Connections:** T3 Account (Clerk login/profile), Environments list, Notifications.
  - **Interface:** Appearance (Theme switcher, OKLCH preview, font options), Keyboard (shortcuts), Microphone (dictation).
  - **Automations:** Scheduled Tasks (cron triggers, base branches, recurring prompts).
  - **Projects & Threads:** Organization (group by folder/machine), Thread behavior (auto-settle rules), Follow-ups (queue vs steer mode), Archived Threads.
  - **Server Settings:** Provider Accounts (API keys for Anthropic, OpenAI, Groq, Ollama), New Threads mode (worktree vs local), Source Control, Agent Behavior, Maintenance (disk clean, cache flush).
  - **App:** Usage (Token counters, daily charts), About T3 Code, Open Source Licenses, Client Storage.

---

## 5. Data Model and Transport

### 5.1 Verbatim Core Schemas (from `packages/contracts/src/orchestrationV2.ts`)

#### Thread Shell Schema
```typescript
export const OrchestrationV2ThreadShell = Schema.Struct({
  createdBy: OrchestrationV2Actor,
  creationSource: OrchestrationV2CreationSource,
  id: ThreadId,
  projectId: ProjectId,
  title: Schema.String,
  providerInstanceId: ProviderInstanceId,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  linkedPullRequest: Schema.optional(Schema.NullOr(ThreadLinkedPullRequest)),
  pullRequests: Schema.optional(Schema.Array(ThreadPullRequestLink)),
  branchPullRequest: Schema.optional(Schema.NullOr(ThreadLinkedPullRequest)),
  lineage: OrchestrationV2AppThreadLineage,
  forkedFrom: Schema.NullOr(OrchestrationV2AppThread.fields.forkedFrom),
  activeProviderThreadId: Schema.NullOr(ProviderThreadId),
  historyOrigin: Schema.optional(OrchestrationV2ThreadHistoryOrigin),
  latestRunId: Schema.NullOr(RunId),
  latestRunRequestedAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
  latestRunStartedAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
  latestRunCompletedAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
  activeRunId: Schema.NullOr(RunId),
  activityRunStartedAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
  activityRunStatus: Schema.optional(
    Schema.NullOr(Schema.Literals(["preparing", "starting", "running", "waiting"])),
  ),
  status: OrchestrationV2ShellThreadStatus,
  lastError: Schema.optional(Schema.NullOr(Schema.String)),
  lastErrorClass: Schema.optional(Schema.NullOr(OrchestrationV2ProviderFailureClass)),
  usageLimitResetAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  pendingRuntimeRequest: Schema.NullOr(OrchestrationV2PendingRuntimeRequestSummary),
  latestVisibleMessage: Schema.NullOr(OrchestrationV2LatestVisibleMessageSummary),
  latestUserMessageAt: Schema.NullOr(Schema.DateTimeUtc),
  latestUserAuthoredMessageAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
  hasActionableProposedPlan: Schema.Boolean,
  pendingBackgroundTasks: Schema.optional(Schema.Array(OrchestrationV2PendingBackgroundTask)),
  providerInstanceHistory: Schema.optional(Schema.Array(ProviderInstanceId)),
  goal: Schema.optional(Schema.NullOr(OrchestrationV2ProviderGoal)),
  itemCount: NonNegativeInt,
  visibleItemCount: NonNegativeInt,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
  settledOverride: Schema.NullOr(Schema.Literals(["settled", "active"])),
  settledAt: Schema.NullOr(Schema.DateTimeUtc),
  unsettledAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
  snoozedUntil: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
  snoozedAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
  limitRecovery: Schema.optional(Schema.NullOr(OrchestrationV2LimitRecovery)),
  pinnedAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
  autoSettleDisabledAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
  pinOrderKey: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  activeOrderKey: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
```

#### Turn Item / Message Schema
```typescript
export const OrchestrationV2TurnItem = Schema.Union([
  Schema.Struct({
    ...OrchestrationV2TurnItemBaseFields,
    type: Schema.Literal("notification"),
    ...OrchestrationV2Notification.fields,
  }),
  Schema.Struct({
    ...OrchestrationV2TurnItemBaseFields,
    ...OrchestrationV2CreationFields,
    type: Schema.Literal("user_message"),
    messageId: MessageId,
    scheduledTaskId: Schema.optional(ScheduledTaskId),
    senderThreadId: Schema.optional(ThreadId),
    inputIntent: OrchestrationV2UserMessageInputIntent,
    text: Schema.String,
    context: Schema.optional(OrchestrationMessageContext),
    attachments: Schema.Array(ChatAttachment),
  }),
  Schema.Struct({
    ...OrchestrationV2TurnItemBaseFields,
    type: Schema.Literal("assistant_message"),
    messageId: MessageId,
    text: Schema.String,
    attachments: Schema.optional(Schema.Array(ChatAttachment)),
    streaming: Schema.Boolean,
  }),
  Schema.Struct({
    ...OrchestrationV2TurnItemBaseFields,
    type: Schema.Literal("reasoning"),
    text: Schema.String,
    streaming: Schema.Boolean,
  }),
  Schema.Struct({
    ...OrchestrationV2TurnItemBaseFields,
    type: Schema.Literal("proposed_plan"),
    planId: PlanId,
    markdown: Schema.String,
    streaming: Schema.Boolean,
  }),
  Schema.Struct({
    ...OrchestrationV2TurnItemBaseFields,
    type: Schema.Literal("todo_list"),
    planId: PlanId,
    steps: Schema.Array(OrchestrationV2PlanStep),
    explanation: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    ...OrchestrationV2TurnItemBaseFields,
    type: Schema.Literal("user_input_request"),
    requestId: RuntimeRequestId,
    questions: Schema.Array(OrchestrationV2UserInputQuestion),
    questionAnswer: Schema.optional(UserInputAttachmentAnswerPayload),
    responseMode: Schema.optional(Schema.Literal("message")),
  }),
  Schema.Struct({
    ...OrchestrationV2TurnItemBaseFields,
    type: Schema.Literal("file_change"),
    fileName: TrimmedNonEmptyString,
    additions: Schema.optional(NonNegativeInt),
    deletions: Schema.optional(NonNegativeInt),
    diffStr: Schema.optional(Schema.String),
    oldStr: Schema.optional(Schema.String),
    newStr: Schema.optional(Schema.String),
    changes: Schema.optional(Schema.Array(OrchestrationV2FileChangeDetail)),
  }),
  Schema.Struct({
    ...OrchestrationV2TurnItemBaseFields,
    type: Schema.Literal("command_execution"),
    commandId: CommandId,
    command: Schema.String,
    cwd: Schema.String,
    exitCode: Schema.NullOr(Schema.Int),
    output: Schema.String,
    streaming: Schema.Boolean,
  }),
]);
```

#### Runtime Request (Approvals & Input)
```typescript
export const OrchestrationV2RuntimeRequest = Schema.Struct({
  id: RuntimeRequestId,
  nodeId: NodeId,
  providerTurnId: Schema.NullOr(ProviderTurnId),
  nativeRequestRef: Schema.NullOr(OrchestrationV2ProviderRef),
  kind: Schema.Union([
    ProviderRequestKind,
    Schema.Literals(["dynamic_tool_call", "user_input", "auth_refresh"]),
  ]),
  status: Schema.Literals(["pending", "resolved", "expired", "cancelled"]),
  responseCapability: Schema.Union([
    Schema.Struct({ type: Schema.Literal("live"), providerSessionId: ProviderSessionId }),
    Schema.Struct({ type: Schema.Literal("message") }),
    Schema.Struct({ type: Schema.Literal("not_resumable"), reason: Schema.String }),
  ]),
  createdAt: Schema.DateTimeUtc,
  resolvedAt: Schema.NullOr(Schema.DateTimeUtc),
  decision: Schema.optional(ProviderApprovalDecision),
  answers: Schema.optional(ProviderUserInputAnswers),
});
```

#### Terminal Session Snapshot (from `packages/contracts/src/terminal.ts`)
```typescript
export const TerminalSessionSnapshot = Schema.Struct({
  threadId: Schema.String.check(Schema.isNonEmpty()),
  terminalId: Schema.String.check(Schema.isNonEmpty()),
  cwd: Schema.String.check(Schema.isNonEmpty()),
  worktreePath: Schema.NullOr(TrimmedNonEmptyStringSchema),
  status: TerminalSessionStatus,
  pid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  history: Schema.String,
  exitCode: Schema.NullOr(Schema.Int),
  exitSignal: Schema.NullOr(Schema.Int),
  label: Schema.String.check(Schema.isMaxLength(128)),
  updatedAt: Schema.String,
  sequence: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
```

#### Offline Queued Message (from `apps/mobile/src/state/thread-outbox-model.ts`)
```typescript
export interface QueuedThreadMessage {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly commandId: CommandId;
  readonly text: string;
  readonly context?: OrchestrationMessageContext;
  readonly attachments: ReadonlyArray<DraftComposerAttachment>;
  readonly modelSelection?: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: ProviderInteractionMode;
  readonly dispatchMode?: ComposerDispatchMode; // "auto" | "queue" | "steer" | "restart"
  readonly creation?: QueuedThreadCreation;
  readonly createdAt: IsoDateTime;
}
```

### 5.2 Transport, Sync & Offline Mechanics
- **Connection Transport:**
  - WebSocket primary duplex RPC channel (`EnvironmentSupervisor` in `packages/client-runtime/src/connection/supervisor.ts`).
  - RPC calls follow JSON-RPC over WebSocket using Effect schemas.
  - HTTP Fallback / Blobs: HTTP chunked endpoints for bounded thread snapshots (`/orchestration/thread-snapshot`), large diffs, image uploads, and terminal scrollback history.
- **Real-Time vs Polled:**
  - **Real-time (Streamed):** Thread shells (`orchestrationV2.shellStream`), Turn events and reasoning tokens (`orchestrationV2.threadStream`), Terminal stdout (`terminal.observe`), Device/Browser mirrors.
  - **Polled / Periodic:** Pull request review checks, remote app updates (foreground check), OTLP telemetry flush.
- **Pairing & T3 Connect:**
  - **Local / LAN / Tailscale:** Handshake via HTTP probe (`GET /environment/probe`) followed by WebSocket connection authenticated via Bearer token passed in hash (`#token=...`).
  - **T3 Connect Cloud Relay:** Authenticated via Clerk (`@clerk/expo`). Mobile client connects to cloud relay (`relay.t3.codes`), which tunnels duplex messages to the desktop machine even behind NATs/firewalls. Enables APNs and FCM push notifications.
- **Offline / Unsent Queue ("Outbox"):**
  - When connection is offline or in flight, messages are stored immediately in local SQLite database via `thread-outbox-storage.ts`.
  - Displayed in the UI with clock icon and pending banner. User can tap to edit (`queuedRunEdit`) or cancel.
  - On WebSocket reconnect, `ThreadOutboxDrainWorker` acquires a lock, checks server capability, sequentially delivers messages, uploads attachments, and updates thread lineage.
- **Cross-Device Sync:**
  - The server holds ground-truth state. When multiple mobile or desktop clients connect to the same server, all receive the exact same WebSocket shell and turn stream events. Reads and visits are synchronized across devices via server-persisted `threadVisitedTracking`.

### 5.3 Supported Agent Providers
- **Providers Configured:**
  1. `codex` (OpenAI Codex App Server) - Distinct icon, tool approvals, reasoning streams.
  2. `claudeAgent` (Anthropic Claude) - Terracotta Claude icon, plan mode, computer use.
  3. `antigravity` (Google Antigravity IDE agent) - Dedicated PNG brand mark.
  4. `cursor` - Custom cursor package driver.
  5. `grok` (xAI Grok) - Grok package driver.
  6. `muse` - Muse package driver.
  7. `opencode` - OpenCode driver.
  8. `pi` - Inflection Pi driver.
  9. `acpRegistry` - Dynamic Agent Client Protocol agents discovered from registry.
- **UI Distinctions:**
  - Dedicated brand SVG/PNG icons in [`ProviderIcon.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/components/ProviderIcon.tsx).
  - Provider initials badge if no SVG is available.
  - Capability badges (e.g. Plan Mode toggle shown only when provider advertises plan support; reasoning accordion rendered only when provider emits reasoning chunks).

---

## 6. Feature Catalog

| Feature | Status | Implementation Details / File Paths |
|---|---|---|
| **Thread Inbox & Filtering** | Complete | Flat LegendList with shelves, multi-criteria filtering (`HomeScreen.tsx`, `ThreadListFilters.tsx`) |
| **Interactive Approvals** | Complete | Command, file edit, and tool call accept/deny cards (`PendingApprovalCard.tsx`) |
| **User Input Questions** | Complete | Form cards for questions with multiple-choice pills & custom text (`PendingUserInputCard.tsx`) |
| **Snooze Thread** | Complete | Presets (1 hr, evening, tomorrow, next week) and custom date picker (`CustomSnoozeSheet.tsx`) |
| **Settle / Unsettle Thread**| Complete | Settle thread to archive active work; auto-settle on git branch merge (`threadSettled.ts`) |
| **Voice Input / Dictation** | Complete (iOS) / Partial (Android) | Live recording & metering via `expo-audio`; Apple SpeechKit dictation on iOS; Android fallback (`voice-input/`) |
| **Embedded Terminal** | Complete | Full ANSI VT100 PTY emulator with virtual modifier keys (`ThreadTerminalRouteScreen.tsx`, `modules/t3-terminal`) |
| **Working Diff Review** | Complete | Unified/split diff with hunk comments and file tree drawer (`ReviewSheet.tsx`, `modules/t3-review-diff`) |
| **Line-by-line Diff Comments**| Complete | Tap diff line to open comment composer and attach note to agent prompt (`ReviewCommentComposerSheet.tsx`) |
| **Git Source Control Hub** | Complete | Status overview, branch switching, stage/commit, push/pull, merge back (`features/threads/git/`) |
| **Pull Request Workspace** | Complete | Full GitHub/GitLab/Forgejo PR review, file viewed checkboxes, check statuses (`features/pull-requests/`) |
| **New Task Creation** | Complete | Choose project, scratch workspace, branch selection, draft composer (`features/threads/NewTaskRouteScreen.tsx`) |
| **Add / Clone Project** | Complete | Clone Git repos directly on host or open local host folders (`features/projects/`) |
| **File Browser & Viewers** | Complete | Directory tree browser with Shiki syntax highlighting, Markdown, Media, Audio previews (`ThreadFilesRouteScreen.tsx`) |
| **Camera QR Pairing** | Complete | Live camera viewfinder to scan desktop QR pairing codes (`ConnectionsNewRouteScreen.tsx`) |
| **T3 Connect (Cloud Relay)**| Complete | Remote access over Clerk auth relay; APNs/FCM background pushes (`features/cloud/`, `relay.ts`) |
| **Subagent Lineage & Groups**| Complete | Hierarchical rendering of child subagent tasks with progress pills (`ThreadAgentsSheet.tsx`, `thread-subagent-group.tsx`) |
| **Interactive MCP Apps** | Complete | Interactive webview modals running MCP tools with bidirectional messaging (`McpAppFullscreenScreen.tsx`) |
| **Device / Simulator Preview**| Complete | Remote stream of host simulators/emulators with physical shake gesture to toggle controls (`DevicePreviewRouteScreen.tsx`) |
| **Remote Web Browser Preview**| Complete | Headless Chromium stream with URL bar and Picture-in-Picture (`BrowserPreviewRouteScreen.tsx`) |
| **Subscription Usage Widget**| Complete | Home screen widget on iOS (WidgetKit) and Android (Glance) displaying active token usage (`widgets/`) |
| **Scheduled Tasks** | Complete | Cron-based automated thread runs with branch and model selectors (`SettingsScheduledTasksRouteScreen.tsx`) |
| **Offline Outbox Queue** | Complete | Persistent SQLite queue; auto-drains and uploads attachments on reconnect (`thread-outbox-model.ts`) |
| **Live Activities (iOS)** | Complete | Lock-screen dynamic island & banner updating on agent turn progress (`modules/t3-agent-notifications`) |
| **Hardware Keyboard Nav** | Complete | Physical iPad/keyboard shortcuts (`Cmd+K`, `Cmd+N`, `Cmd+W`, `Cmd+1..9`) (`HardwareKeyboardCommandProvider.tsx`) |

### Feature Flags & Environment Variables:
- `EXPO_PUBLIC_SHOWCASE=1`: Activates headless screenshot capture harness for automated App Store asset generation.
- `EXPO_PUBLIC_REVIEW_HIGHLIGHTER_ENGINE=native|javascript`: Toggles between C++ Shiki native diff engine and JavaScript WebAssembly Shiki engine.
- `T3CODE_IOS_PERSONAL_TEAM=1`: Strips push, widgets, and Sign in with Apple entitlements for free developer certificates.
- `MOBILE_VERSION_POLICY=appVersion|fingerprint`: Toggles EAS OTA update matching strategy.

---

## 7. Design System as Implemented

### 7.1 Palette & Hex Values (from `packages/shared/src/themePalettes.ts`)

#### Light Theme (`T3_CODE_LIGHT_THEME_COLORS`):
- Canvas / Screen: `#fcfcfc`
- Chrome / Sheet Solid: `#fcfcfc`
- Surface (Card / Input): `#ffffff`
- Surface Raised: `#fcfcfc`
- Text (Foreground): `#27272a`
- Text Muted: `#71717b`
- Border: `#e4e4e7`
- Input Border: `#d4d4d8`
- Accent / Message Action (Primary Blue): `#1b4ed8`
- Primary Foreground: `#ffffff`
- Error / Danger: `#fb2c36` (Surface: `#fcebec`, Foreground: `#c10007`)
- Warning / Approval: `#fe9a00` (Surface: `#fcf4e8`, Foreground: `#bb4d00`)
- Sky (Working Indicator): `#0284c7`
- Indigo (Input Needed): `#4f46e5`
- Emerald (Done / Success): `#047857`
- Sidebar Background: `#fafafa`
- Sidebar Row Active: `#ffffff`

#### Dark Theme (`T3_CODE_DARK_THEME_COLORS`):
- Canvas / Screen: `#0a0a0a`
- Chrome / Sheet Solid: `#0a0a0a`
- Surface (Card / Input): `#111111`
- Surface Raised: `#111111`
- Text (Foreground): `#f5f5f5`
- Text Muted: `#818181`
- Border: `#191919`
- Input Border: `#1e1e1e`
- Accent / Message Action (Primary Blue): `#346bf1`
- Primary Foreground: `#ffffff`
- Error / Danger: `#fb414a` (Surface: `#301214`, Foreground: `#ff6467`)
- Warning / Approval: `#fe9a00` (Surface: `#312108`, Foreground: `#ffb900`)
- Sky (Working Indicator): `#38bdf8`
- Indigo (Input Needed): `#818cf8`
- Emerald (Done / Success): `#34d399`
- Sidebar Background: `#000000`
- Sidebar Row Active: `#1a1b1b`

### 7.2 Typography Scale (from `src/lib/typography.ts` & `global.css`)
| Token | Font Size | Line Height | Native Style Equivalent | Primary Usage |
|---|---|---|---|---|
| `--text-3xs` / `micro` | 11px | 14px | `{ fontSize: 11, lineHeight: 14 }` | Diff line numbers, badge micro-labels |
| `--text-2xs` / `caption` | 12px | 16px | `{ fontSize: 12, lineHeight: 16 }` | Timestamps, metadata pills, secondary captions |
| `--text-xs` / `label` | 13px | 17px | `{ fontSize: 13, lineHeight: 17 }` | Form field labels, list item secondary subtitles |
| `--text-sm` / `footnote` | 14px | 19px | `{ fontSize: 14, lineHeight: 19 }` | Compact buttons, sheet item text |
| `--text-base` / `body` | 16px | 23px | `{ fontSize: 16, lineHeight: 23 }` | Default message body, composer text input |
| `--text-lg` / `headline`| 18px | 23px | `{ fontSize: 18, lineHeight: 23 }` | Native navigation bar titles, modal headings |
| `--text-xl` / `title` | 21px | 28px | `{ fontSize: 21, lineHeight: 28 }` | Section headers, card titles |
| `--text-2xl` / `largeTitle`| 26px | 32px | `{ fontSize: 26, lineHeight: 32 }` | Large sheet banners, onboarding titles |
| `--text-3xl` / `display` | 30px | 36px | `{ fontSize: 30, lineHeight: 36 }` | Empty state hero headings |

### 7.3 Spacing & Border Radii
- **Radii:**
  - Pills / Badges: `rounded-full` (9999px)
  - Cards & Sheet containers: `rounded-2xl` (16px) or `rounded-3xl` (24px)
  - Buttons: `rounded-xl` (12px)
  - Inputs & Code blocks: `rounded-lg` (8px)
- **Spacings:** 4px grid (`p-1`=4px, `p-2`=8px, `p-3`=12px, `p-4`=16px, `p-5`=20px, `p-6`=24px).

### 7.4 Shared Design Components (under `src/components/`)
- [`ListRow.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/components/ListRow.tsx): Standard settings list row with leading icon, label, trailing text, and disclosure chevron.
- [`ListChoiceRow.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/components/ListChoiceRow.tsx): Selectable row with radio checkmark indicator.
- [`ListToggleRow.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/components/ListToggleRow.tsx): Row embedding native or Material switch.
- [`ControlPill.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/components/ControlPill.tsx): Compact chip with leading symbol, text, and optional trailing chevron (drives model selectors and filters).
- [`ControlPillMenu.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/components/ControlPillMenu.tsx): Wraps ControlPill in iOS native context menu (`@react-native-menu/menu`) or Android popup.
- [`GlassSurface.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/components/GlassSurface.tsx): Renders liquid frosted glass using `expo-blur` / native view on iOS; falls back to opaque card on Android.
- [`MaterialButton.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/components/MaterialButton.tsx): Material Design 3 button (`filled`, `tonal`, `outlined`, `text`).
- [`ConfirmDialogHost.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/components/ConfirmDialogHost.tsx): Global confirmation dialog replacing native alerts.

### 7.5 Theming Flexibility Assessment
- **Can it support multiple switchable themes?** **Yes.** The app already includes built-in themes: `t3-code`, `t3-chat`, `grove`, `ocean`, `ember`, `iris`, and dynamic `material-you` (on Android 12+).
- **How hard would it be to retheme?** **Very straightforward.** All colors are mediated through standard Uniwind CSS variables (`--color-screen`, `--color-sheet`, `--color-primary`, etc.) generated by `createMobileThemeVariables()` in `mobileTheme.ts`. A designer can supply a brand-new palette by editing the token table in `themePalettes.ts` without touching individual screen files.

---

## 8. Reusability and Constraints

### 8.1 Cleanly Separated Logic (Keep Untouched Under Redesign)
- **Contracts (`packages/contracts`)**: Pure schemas, zero React dependencies.
- **Client Runtime (`packages/client-runtime`)**: Connection supervisor, WebSocket reconnection, outbox processing, git actions, PR routing, and shell reducers.
- **Atom Registry (`src/state/`)**: Reactive atoms for threads, projects, environments, outbox, and terminal sessions.
- **Local Database (`src/persistence/mobile-database.ts`)**: SQLite persistence schema for offline queues, thread caches, and secure keys.

### 8.2 Tightly Coupled Code (Must Be Replaced or Adapted)
- **Native Stack Config (`src/Stack.tsx`)**: Directly hardcodes every screen, header options, and detent sizes.
- **Adaptive Workspace Shell (`AdaptiveWorkspaceLayout.tsx`)**: Hardcodes two-column split-view calculations for iPad and foldables.
- **Thread List V2 Items (`thread-list-v2-items.tsx`)**: Combines data binding with exact row card styling and LegendList configuration.
- **Composer Editor (`T3ComposerEditor.native.tsx`)**: Deeply coupled to custom native C++/Swift text views for token chip rendering.

### 8.3 Platform & Design Constraints
1. **iOS Glass Headers:** On iOS 26+, UIKit morphs navigation bar titles and back buttons during stack transitions. Navigators must avoid headerless-to-headered transitions to prevent jarring jumps.
2. **Form Sheet Keyboard Limits on Android:** Android's window manager cannot reliably resize form sheets when soft keyboards open. All keyboard-driven modals (comment composers, code editors) must use `presentation: "fullScreenModal"` or `card` on Android.
3. **Horizontal Gesture Conflicts:** Any horizontally scrollable element (diff viewer, terminal buffer, code snippet) must yield to the full-screen back gesture when scrolled to its leading edge.
4. **Safe Area Insets:** Dynamic island, home indicator bar, and notch insets must be accounted for on floating docks and bottom composer inputs (`useSafeAreaInsets()`).

---

## 9. Gaps and Opportunities

### 9.1 Data Available from Server but Not Shown in Mobile UI
1. **Granular Dollar Costs & Token Pricing:** The server streams `ThreadTokenUsageSnapshot`, `usagePriceOverrides`, and model aliases, but mobile only displays token counts and percentage progress bars—never estimated dollar cost ($) per thread or turn.
2. **Command Risk Signals & Policies:** Contracts define `CommandPolicy` with risk levels (`read_only`, `workspace_mutation`, `network`, `danger`), but the mobile approval card currently renders a generic warning without visualizing risk severity.
3. **Git Worktree Dirty File Counts:** Available on thread shells, but thread inbox rows do not display whether an uncommitted change is pending without opening the Git Overview sheet.
4. **Detailed PR CI Check Logs:** Contracts support `pullRequestChecks` with failure URLs and log summaries; mobile only shows passing/failing count badges.
5. **Multi-Environment Batch Operations:** Server supports batch maintenance and updates, but mobile UI requires navigating into each environment individually.

### 9.2 Missing Mobile UX Patterns
1. **Interactive Lock-Screen Controls:** Live Activities display turn progress, but do not provide quick action buttons (e.g. "Approve" or "Stop") from the iOS Dynamic Island or lock screen.
2. **Audio Dictation on Android:** Voice input is fully native with Apple Speech on iOS, but Android currently relies on soft keyboard dictation without custom voice wave streaming.
3. **Pull-to-Refresh on Chat Feed:** Inbox supports pull-to-refresh; thread conversation feed does not support pull-to-reload for partial stream recovery.

---

## 10. Key Files to Read

| # | File Path | Why It's Critical |
|---|---|---|
| 1 | [`apps/mobile/src/Stack.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/Stack.tsx) | Complete navigation graph, screen registry, deep links, and sheet detent options. |
| 2 | [`apps/mobile/src/features/workspace/WorkspaceRootScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/workspace/WorkspaceRootScreen.tsx) | Root workspace shell hosting Threads and Pull Requests tabs, toolbar, and adaptive layout. |
| 3 | [`apps/mobile/src/features/home/HomeScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/home/HomeScreen.tsx) | Main inbox feed layout using LegendList, project grouping, and swipe gesture gates. |
| 4 | [`apps/mobile/src/features/threads/thread-list-v2-items.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/threads/thread-list-v2-items.tsx) | Visual row components for active, working, snoozed, and settled threads; status badges. |
| 5 | [`apps/mobile/src/features/threads/ThreadDetailScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/threads/ThreadDetailScreen.tsx) | Core chat view: message feed, live approvals, user inputs, plan mode, floating timer. |
| 6 | [`apps/mobile/src/features/threads/ThreadComposer.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/threads/ThreadComposer.tsx) | Input dock with native text editor, attachments strip, voice mic, and model selector. |
| 7 | [`apps/mobile/src/features/pull-requests/PullRequestRouteScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/pull-requests/PullRequestRouteScreen.tsx) | Comprehensive PR review suite: Overview, File Diffs with viewed markers, Discussion. |
| 8 | [`apps/mobile/src/features/review/ReviewSheet.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/review/ReviewSheet.tsx) | Native and JS-powered diff viewer with hunk line commenting and file drawer. |
| 9 | [`apps/mobile/src/features/terminal/ThreadTerminalRouteScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/terminal/ThreadTerminalRouteScreen.tsx) | PTY terminal emulator with ANSI canvas and virtual accessory keyboard toolbar. |
| 10 | [`apps/mobile/src/features/files/ThreadFilesRouteScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/files/ThreadFilesRouteScreen.tsx) | Worktree file tree browser and syntax-highlighted source/media viewers. |
| 11 | [`apps/mobile/src/features/connection/ConnectionsNewRouteScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/connection/ConnectionsNewRouteScreen.tsx) | Pairing interface with live camera QR scanner, manual host/token inputs, and cloud list. |
| 12 | [`apps/mobile/src/features/threads/NewTaskRouteScreen.tsx`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/features/threads/NewTaskRouteScreen.tsx) | New task creation wizard: project selection, scratch workspaces, branch targeting. |
| 13 | [`apps/mobile/src/lib/mobileTheme.ts`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/lib/mobileTheme.ts) | Uniwind dynamic theme variable generator, OKLCH conversion, and contrast math. |
| 14 | [`packages/contracts/src/orchestrationV2.ts`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/packages/contracts/src/orchestrationV2.ts) | Authoritative Effect/Schema contracts for threads, messages, turn items, and approvals. |
| 15 | [`apps/mobile/src/state/thread-outbox-model.ts`](file:///Users/rushil.dev/Desktop/tabs/t3code-main/apps/mobile/src/state/thread-outbox-model.ts) | Offline message persistence model, outbox schema, and reconnection delivery engine. |

---
*Generated autonomously via read-only repository analysis for the T3 Code Mobile Redesign Project.*
