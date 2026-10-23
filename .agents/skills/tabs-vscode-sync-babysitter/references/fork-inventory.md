# Tabs Code-OSS fork inventory

This document tracks the reviewed patch surface between Microsoft VS Code upstream and Tabs' embedded `tabs-code-oss` runtime.
Updated for **VS Code 1.143.0** (`2d0b7506a36c1d6db9a466440131a8e01eab2289`) synced from 1.142.0 (`d956e8a6ac5d904486557eea07e1d6bd62a4d36f`) and 1.140.0 (`07f806f999227108933c2e30515b26eecc1fda74`).

## Tabs-owned Code-OSS additions (6 files)

- `tabs-code-oss/TABS_ARCHITECTURE.md`: Tabs embedded Code-OSS runtime architecture documentation.
- `tabs-code-oss/build/gulpfile.compile.ts`: Dedicated compile orchestration helper for standalone build pipelines.
- `tabs-code-oss/src/vs/workbench/browser/parts/editor/media/tabs-logo.svg`: Tabs branded SVG logo for editor watermark and branding.
- `tabs-code-oss/src/vs/workbench/contrib/tabs/browser/media/tabs.css`: Hierarchical Code OSS radii and styling for Tabs workbench integrations: compact details/rows, inset controls, overlays, cards and large dialogs; continuous notification frames; connected buttons and editor text-selection geometry.
- `tabs-code-oss/src/vs/workbench/contrib/tabs/browser/tabs.contribution.ts`: Primary Tabs workbench contribution, auxiliary bar assistant placement, and secondary container stability.
- `tabs-code-oss/src/vs/workbench/contrib/tabs/test/browser/tabs.contribution.test.ts`: Browser tests verifying Claude and auxiliary container placement invariants, plus mutually exclusive regular and managed-update Chat views through policy transitions.

## Retained and adapted upstream modifications (31 files)

- **Bootstrap, Preload & IPC (3 files):**
  - `src/vs/base/parts/contextmenu/electron-main/contextmenu.ts`: Context menu coordinate offset routing to native host; preserves strong `menu` reference in callback closure for GC protection (VS Code issue 72447) with deferred sender notification.
  - `src/vs/base/parts/sandbox/electron-browser/preload.ts`: Diagnostic MessagePort trace logs during Electron sandbox bootstrap.
  - `src/vs/platform/utilityProcess/electron-main/utilityProcess.ts`: Target webContents fallback and port routing for embedded shell integration.
- **Workbench Startup & Registration (6 files):**
  - `src/vs/code/browser/workbench/workbench.ts`: Synchronous IDisposable disposal shutdown hook.
  - `src/vs/code/electron-browser/workbench/workbench.ts`: Window hooks, embedded class configuration, and project-aware stored layout retrieval.
  - `src/vs/workbench/browser/workbench.ts`: Fallback handling for empty editor settings during font initialization race conditions.
  - `src/vs/workbench/workbench.common.main.ts`: Main common workbench registration importing Tabs contribution (`vs/workbench/contrib/tabs/browser/tabs.contribution.js`).
  - `src/vs/workbench/electron-browser/desktop.main.ts`: Tabs shutdown hook for the embedded desktop workbench.
  - `src/vs/sessions/electron-browser/sessions.main.ts`: Matching shutdown hook for the Agents workbench.
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
- **Build, Dependencies & Packaging (7 files):**
  - `package.json`: Gulp memory allocation increased to 12,288 MB (`--max-old-space-size=12288`) to accommodate full monorepo compilation; version updated to 1.143.0.
  - `extensions/copilot/package.json`: Moves runtime dependencies (`dotenv`, `source-map-support`) into production scope.
  - `extensions/copilot/package-lock.json`: Lockfile metadata reflecting production scope dependencies.
  - `build/lib/test/copilot.test.ts`: Copilot platform packaging test covering production dependency assertions and SDK exclusion guards.
  - `src/vs/platform/agentHost/test/node/codex/codexProviderConfiguration.test.ts`: Explicitly typed let declarations avoiding TypeScript circular type inference issues.
  - `build/hygiene.ts`: Scope Git discovery, staged paths and JavaScript allowlisting to the vendored checkout.
  - `build/lib/test/hygiene.test.ts`: Regression coverage for vendored hygiene and index preservation.

## Upstream file purges

44 files deleted upstream between 1.142.0 and 1.143.0 (and 97 files total since 1.140.0) were systematically purged from `tabs-code-oss`.

## Native-Host contract audit (111 methods)

In VS Code 1.143.0, the `ICommonNativeHostService` / `INativeHostService` contracts are verified identical to 1.142.0 (111 callable methods):
- 0 methods added, 0 methods removed in `src/vs/platform/native/common/native.ts`.
- All 111 methods have an explicit implementation, intentional embedded-product no-op, or clear rejection policy in Tabs.

## Tabs-side compatibility boundary

Always review these alongside fork changes:

- `tabs-app/apps/desktop/src/codeHostManager.ts`
- `tabs-app/apps/desktop/src/nativeCodeHostMain.ts`
- `tabs-app/apps/desktop/src/nativeCodeHostActivity.ts`
- `tabs-app/apps/desktop/src/nativeCodeHostGpu.ts`
- `tabs-app/apps/desktop/src/nativeCodeHostStorage.ts`
- `tabs-app/apps/desktop/src/nativeCodeHostZip.ts`
- `tabs-app/apps/desktop/src/browserHostManager.ts`
- `tabs-app/apps/desktop/resources/code-oss-extensions/tabs-workbench-integration/`
- `tabs-app/apps/web/src/components/WorkspaceShell.tsx`
- `tabs-app/apps/web/src/components/code/`
- `tabs-app/apps/web/src/nativeSurfaceOverlay.ts`
- `tabs-app/scripts/build-desktop-artifact.ts`
- `.github/workflows/build-desktop.yml` and `.github/workflows/release.yml`

## Release consolidation follow-up (2026-10-22)

Preserve the macOS native build repair from Tabs 2.0.2: `build/npm/patchNativeGyp.ts` and its `postinstall.ts` hook raise the obsolete node-addon-api 10.7 deployment target to 11.0. This is one additional helper and one additional upstream modification beyond the 1.143 refresh inventory above. Existing upstream dependency versions remain unchanged.
