# Tabs Code-OSS fork inventory

This document tracks the reviewed patch surface between Microsoft VS Code upstream and Tabs' embedded `tabs-code-oss` runtime.
Updated for **VS Code 1.142.0** (`d956e8a6ac5d904486557eea07e1d6bd62a4d36f`) synced from 1.140.0 (`07f806f999227108933c2e30515b26eecc1fda74`).

## Tabs-owned Code-OSS additions (6 files)

- `tabs-code-oss/TABS_ARCHITECTURE.md`: Tabs embedded Code-OSS runtime architecture documentation.
- `tabs-code-oss/build/gulpfile.compile.ts`: Dedicated compile orchestration helper for standalone build pipelines.
- `tabs-code-oss/src/vs/workbench/browser/parts/editor/media/tabs-logo.svg`: Tabs branded SVG logo for editor watermark and branding.
- `tabs-code-oss/src/vs/workbench/contrib/tabs/browser/media/tabs.css`: Styling for Tabs workbench integrations.
- `tabs-code-oss/src/vs/workbench/contrib/tabs/browser/tabs.contribution.ts`: Primary Tabs workbench contribution, auxiliary bar assistant placement, and secondary container stability.
- `tabs-code-oss/src/vs/workbench/contrib/tabs/test/browser/tabs.contribution.test.ts`: Browser tests verifying Claude and auxiliary container placement invariants, plus mutually exclusive regular and managed-update Chat views through policy transitions.

## Retained and adapted upstream modifications (30 files)

- **Bootstrap, Preload & IPC (3 files):**
  - `src/vs/base/parts/contextmenu/electron-main/contextmenu.ts`: Context menu coordinate offset routing to native host; preserves strong `menu` reference in callback closure for GC protection (VS Code issue 72447) with deferred sender notification.
  - `src/vs/base/parts/sandbox/electron-browser/preload.ts`: Diagnostic MessagePort trace logs during Electron sandbox bootstrap.
  - `src/vs/platform/utilityProcess/electron-main/utilityProcess.ts`: Target webContents fallback and port routing for embedded shell integration.
- **Workbench Startup & Registration (4 files):**
  - `src/vs/code/browser/workbench/workbench.ts`: Synchronous IDisposable disposal shutdown hook.
  - `src/vs/code/electron-browser/workbench/workbench.ts`: Window hooks, embedded class configuration, and project-aware stored layout retrieval.
  - `src/vs/workbench/browser/workbench.ts`: Fallback handling for empty editor settings during font initialization race conditions.
  - `src/vs/workbench/workbench.common.main.ts`: Main common workbench registration importing Tabs contribution (`vs/workbench/contrib/tabs/browser/tabs.contribution.js`).
- **Terminal & Services (4 files):**
  - `src/vs/platform/terminal/common/requestStore.ts`: Consumes cancellation rejections while preserving request timeout rejections to prevent unhandled promise rejections.
  - `src/vs/platform/terminal/test/common/requestStore.test.ts`: Regression unit tests for RequestStore timeout and rejection handling.
  - `src/vs/platform/extensionManagement/node/extensionSignatureVerificationService.ts`: Environment-selected verifier module path override.
  - `src/vs/workbench/services/notification/common/notificationService.ts`: Migrates application notification preferences to shared profile scope.
- **Embedded Chrome, UI & Layout (11 files):**
  - `src/vs/base/browser/ui/list/list.css`: 4px row border-radius applied to lists and trees.
  - `src/vs/workbench/browser/layout.ts`: Default Zen and layout settings fallback using nullish coalescing to prevent unintended layout resets.
  - `src/vs/workbench/browser/parts/activitybar/media/activityaction.css`: Activity bar item padding tuned for embedded shell integration.
  - `src/vs/workbench/browser/parts/auxiliarybar/auxiliaryBarPart.ts`: Assistant container switch visibility behavior preserved in auxiliary bar.
  - `src/vs/workbench/browser/parts/editor/editorGroupWatermark.ts`: Tabs branded watermark rendering with Tabs name and command links.
  - `src/vs/workbench/browser/parts/editor/media/editorgroupview.css`: Editor watermark styling, logo masking, and high-contrast opacity rules.
  - `src/vs/workbench/contrib/chat/browser/chatParticipant.contribution.ts`: Stable Chat container registration preserved without transient AI-features teardown; the regular view yields to the managed-update view while an update is required.
  - `src/vs/workbench/contrib/extensions/browser/extensionsIcons.ts`: Larger extensions icon size definition.
  - `src/vs/workbench/contrib/scm/browser/scmInput.ts`: Dropdown configured with `menuAsChild: false` for native menu consistency.
  - `src/vs/workbench/contrib/webviewView/browser/webviewViewPane.ts`: Concurrent webview activation and resolver lookup without blocking on full extension host startup; a single `toDisposable(() => source.dispose(true))` owner cancels pending revival before disposing the token source.
  - `src/vs/workbench/contrib/webviewView/test/browser/webviewViewPane.test.ts`: Real-pane disposal and replacement regression using WebviewViewService, covering cancellation of pending revival.
- **Build, Dependencies & Packaging (8 files):**
  - `package.json`: Gulp memory allocation increased to 12,288 MB (`--max-old-space-size=12288`) to accommodate full monorepo compilation.
  - `extensions/copilot/package.json`: Moves runtime dependencies (`dotenv`, `source-map-support`) into production scope.
  - `extensions/copilot/package-lock.json`: Lockfile metadata reflecting production scope dependencies.
  - `build/lib/test/copilot.test.ts`: Copilot platform packaging test covering production dependency assertions and SDK exclusion guards.
  - `src/vs/platform/agentHost/test/node/codex/codexProviderConfiguration.test.ts`: Explicitly typed let declarations avoiding TypeScript circular type inference issues.
  - `build/gulpfile.reh.ts`: Fixed remote extension host compilation task wiring.
  - `build/gulpfile.scan.ts`: Fixed scan task definitions.
  - `build/lib/reporter.ts`: Build error reporter formatting adjustments.

## Upstream file purges (64 files)

64 files deleted upstream between 1.140.0 and 1.142.0 (e.g. legacy test utilities, deprecated extension build artifacts) were systematically purged from `tabs-code-oss`.

## Native-Host contract audit (111 methods)

In VS Code 1.142.0, Microsoft added 7 new callable methods to `ICommonNativeHostService` (total now 111, up from 104 in 1.140.0):
- `isGPUCompositingEnabled`: Real implementation querying Electron `app.isGpuFeatureEnabled('gpu_compositing')`.
- `cancelZipFile`: Real implementation tracking and aborting active in-flight native ZIP operations via `AbortController`.
- `getAgentHostEditorState`: Real implementation returning active editor state for agent host integration.
- `updateAgentHostEditorState`: Real implementation persisting and emitting agent host editor state updates.
- `claimAgentsWindowInvitation`: Supported embedded-product no-op returning `false`.
- `markAgentsWindowInvitationShown`: Supported embedded-product no-op.
- `releaseAgentsWindowInvitation`: Supported embedded-product no-op.

3 new events registered on native host IPC:
- `onDidChangeGPUCompositing`: Emitted when GPU compositing changes.
- `onDidChangeAgentHostEditorState`: Emitted when agent host editor state is updated.
- `onDidProgressZipFile`: Emitted during native ZIP file progress.

Contract test `tabs-app/apps/desktop/src/nativeCodeHostContract.test.ts` validates that all 111 methods have explicit policies and zero unhandled fallthroughs.

## Runtime selection resolver update

`tabs-app/apps/desktop/src/codeHostManager.ts` previously ordered fallback roots with `vscode-main` before `tabs-code-oss`. The fallback order was updated in both packaged and development resolvers to prefer `tabs-code-oss` before `vscode-main`, preventing stale comparison trees from shadowing the active runtime. Covered by unit test in `codeHostManager.test.ts`.

## Tabs-side compatibility boundary

Always review these alongside fork changes:

- `tabs-app/apps/desktop/src/codeHostManager.ts`
- `tabs-app/apps/desktop/src/nativeCodeHostMain.ts`
- `tabs-app/apps/desktop/src/browserHostManager.ts`
- `tabs-app/apps/desktop/resources/code-oss-extensions/tabs-workbench-integration/`
- `tabs-app/apps/web/src/components/WorkspaceShell.tsx`
- `tabs-app/apps/web/src/components/code/`
- `tabs-app/apps/web/src/nativeSurfaceOverlay.ts`
- `tabs-app/scripts/build-desktop-artifact.ts`
- `.github/workflows/build-desktop.yml` and `.github/workflows/release.yml`

## Historical commits worth reading

- `465fc5d5` and `3eeb55ca`: prior upstream Code-OSS refreshes
- `c7e2785b`, `23e0d0b4`, `b7db557c`, `737f4ee0`: bootstrap, extension host, webview, and provider integration
- `79c64cb8`, `7f56447f`: embedded workbench/native host stabilization
- `7a3d2341`, `4f622f75`: assistant view registration and shared notification preferences
- `af4969d0`, `7e0a7c4c`, and the later notification-overlay correction: native surface lifecycle and overlay behavior

Use `git show <commit> -- <path>` to recover intent. Commit messages alone are not sufficient evidence for replaying a patch.
