# Tabs Code-OSS fork inventory

This document tracks the reviewed patch surface between Microsoft VS Code upstream and Tabs' embedded `tabs-code-oss` runtime.
Updated for **VS Code 1.146.0** (`69047191fc427f2f92828279aae1d90d8eeda7ab`) synced from 1.145.0 (`a717861c07586a53d83b80d742cd3f59b20a6273`).

## Tabs-owned Code-OSS additions (13 files)

- `tabs-code-oss/TABS_ARCHITECTURE.md`: Tabs embedded Code-OSS runtime architecture documentation.
- `tabs-code-oss/build/gulpfile.compile.ts`: Dedicated compile orchestration helper for standalone build pipelines.
- `tabs-code-oss/build/npm/patchNativeGyp.ts`: Deployment target patcher for native node-addon compilation on macOS.
- `tabs-code-oss/src/vs/workbench/browser/parts/editor/media/tabs-logo.svg`: Tabs branded SVG logo for editor watermark and branding.
- `tabs-code-oss/src/vs/workbench/browser/tabsEmbeddedLayout.ts`: Shared list row measurement helper preventing CSS height regressions.
- `tabs-code-oss/src/vs/workbench/contrib/tabs/browser/commitDraftMenu.ts`: Custom commit draft menu contributions for embedded SCM.
- `tabs-code-oss/src/vs/workbench/contrib/tabs/browser/media/embeddedWorkbench.css`: Embedded presentation and workbench boundary styling rules.
- `tabs-code-oss/src/vs/workbench/contrib/tabs/browser/media/tabs.css`: Hierarchical radii for compact controls, overlays, cards, connected buttons, and text selection. Scope every rule to the Tabs embedded workbench marker.
- `tabs-code-oss/src/vs/workbench/contrib/tabs/browser/railPresentation.ts`: Presentation contract adapter handling bounded `_tabs.setRailPresentation` coordinates.
- `tabs-code-oss/src/vs/workbench/contrib/tabs/browser/tabs.contribution.ts`: Primary Tabs workbench contribution, auxiliary bar assistant placement, and secondary container stability.
- `tabs-code-oss/src/vs/workbench/contrib/tabs/test/browser/tabs.contribution.test.ts`: Browser tests verifying container placement invariants and chat view management.
- `tabs-code-oss/src/vs/workbench/test/browser/tabsEmbeddedLayout.test.ts`: Unit tests verifying list and tree row measurements.
- `tabs-code-oss/src/vs/workbench/test/browser/tabsRailPresentation.test.ts`: Unit tests verifying rail coordinate transformations and presentation constraints.

## Retained and adapted upstream modifications (53 files)

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
  - `src/vs/sessions/electron-browser/sessions.main.ts`: Matching shutdown hook and a marker for Tabs-owned native Agents workbenches.
- **Terminal & Services (4 files):**
  - `src/vs/platform/terminal/common/requestStore.ts`: Consumes cancellation rejections while preserving request timeout rejections to prevent unhandled promise rejections.
  - `src/vs/platform/terminal/test/common/requestStore.test.ts`: Regression unit tests for RequestStore timeout and rejection handling.
  - `src/vs/platform/extensionManagement/node/extensionSignatureVerificationService.ts`: Environment-selected verifier module path override.
  - `src/vs/workbench/services/notification/common/notificationService.ts`: Migrates application notification preferences to shared profile scope.
- **Embedded Chrome, UI, Layout & Views (31 files):**
  - `src/vs/base/browser/ui/list/list.css`: 4px list and tree row corners limited to Tabs-owned windows.
  - `src/vs/editor/browser/controller/editContext/native/nativeEditContextUtils.ts`: Native edit context handling.
  - `src/vs/editor/browser/services/abstractCodeEditorService.ts`: Code editor service hooks.
  - `src/vs/workbench/browser/layout.ts`: Default Zen and layout settings fallback using nullish coalescing to prevent unintended layout resets; 240px default sidebar width.
  - `src/vs/workbench/browser/parts/activitybar/media/activityaction.css`: Activity bar item padding tuned for embedded shell integration.
  - `src/vs/workbench/browser/parts/auxiliarybar/auxiliaryBarPart.ts`: Assistant container switch visibility behavior preserved in auxiliary bar.
  - `src/vs/workbench/browser/parts/editor/breadcrumbsControl.ts`: Breadcrumb row height calculation via shared layout measurement.
  - `src/vs/workbench/browser/parts/editor/editorGroupWatermark.ts`: Uses Tabs branding and Agents routing in Tabs-owned windows; keeps upstream behavior in standalone windows.
  - `src/vs/workbench/browser/parts/editor/media/breadcrumbscontrol.css`: Breadcrumb styling overrides.
  - `src/vs/workbench/browser/parts/editor/media/editorgroupview.css`: Selects Tabs logo masking and high-contrast rules through branded markup, leaving the upstream letterpress styles on standalone markup.
  - `src/vs/workbench/contrib/chat/browser/chatParticipant.contribution.ts`: Stable Chat container registration preserved without transient AI-features teardown; the regular view yields to the managed-update view while an update is required.
  - `src/vs/workbench/contrib/debug/browser/breakpointsView.ts`: Debug breakpoints row measurement.
  - `src/vs/workbench/contrib/debug/browser/callStackView.ts`: Debug call stack row measurement.
  - `src/vs/workbench/contrib/debug/browser/loadedScriptsView.ts`: Debug loaded scripts row measurement.
  - `src/vs/workbench/contrib/debug/browser/variablesView.ts`: Debug variables row measurement.
  - `src/vs/workbench/contrib/debug/browser/watchExpressionsView.ts`: Debug watch expressions row measurement.
  - `src/vs/workbench/contrib/extensions/browser/extensionsIcons.ts`: Larger extensions icon size definition.
  - `src/vs/workbench/contrib/files/browser/views/explorerViewer.ts`: File explorer row measurement.
  - `src/vs/workbench/contrib/files/browser/views/openEditorsView.ts`: Open editors row measurement.
  - `src/vs/workbench/contrib/scm/browser/scmInput.ts`: Dropdown configured with `menuAsChild: false` for native menu consistency.
  - `src/vs/workbench/contrib/scm/browser/scmViewPane.ts`: SCM view pane row measurement.
  - `src/vs/workbench/contrib/search/browser/searchResultsView.ts`: Search results row measurement.
  - `src/vs/workbench/contrib/webview/browser/overlayWebview.ts`: Overlay webview placement and boundary protection.
  - `src/vs/workbench/contrib/webview/test/browser/overlayWebview.test.ts`: Tests for overlay webview integration.
  - `src/vs/workbench/contrib/webviewView/browser/webviewViewPane.ts`: Concurrent webview activation and resolver lookup without blocking on full extension host startup; a single `toDisposable(() => source.dispose(true))` owner cancels pending revival before disposing the token source.
  - `src/vs/workbench/contrib/webviewView/test/browser/webviewViewPane.test.ts`: Real-pane disposal and replacement regression using WebviewViewService, covering cancellation of pending revival.
  - `src/vs/workbench/services/layout/browser/layoutService.ts`: Shared layout measurements and rail margins.
  - `src/vs/workbench/services/layout/test/browser/layoutService.test.ts`: Layout service tests.
- **Build, Dependencies & Packaging (9 files):**
  - `package.json`: Gulp memory allocation increased to 12,288 MB (`--max-old-space-size=12288`) to accommodate full monorepo compilation; version updated to 1.146.0.
  - `extensions/copilot/package.json`: Moves runtime dependencies (`dotenv`, `source-map-support`) into production scope.
  - `build/lib/test/copilot.test.ts`: Copilot platform packaging test covering production dependency assertions and SDK exclusion guards.
  - `src/vs/platform/agentHost/test/node/codex/codexProviderConfiguration.test.ts`: Explicitly typed let declarations avoiding TypeScript circular type inference issues.
  - `build/hygiene.ts`: Scope Git discovery, staged paths and JavaScript allowlisting to the vendored checkout.
  - `build/lib/test/hygiene.test.ts`: Regression coverage for vendored hygiene and index preservation.
  - `build/npm/electronTypes.ts`: Electron mirror and download fallback support for electron types fetching.
  - `src/vs/workbench/contrib/chat/test/browser/widget/chatListWidget.test.ts`: Retries markdown rendered check across streaming yields.
  - `build/lib/i18n.resources.json`, `build/lib/stylelint/vscode-known-variables.json`, `build/npm/postinstall.ts` (with dynamic `patchNativeGyp` guard).

## Upstream file purges

640 files deleted upstream between 1.145.0 and 1.146.0 were systematically identified, exported to `_analysis/sync-1.146.0/evidence/upstream-deletions.txt`, and purged from `tabs-code-oss`.

## Upstream Package Manager Migration

In VS Code 1.146.0, Microsoft migrated the entire build system from `npm` to `pnpm@12.16.0`. All `package-lock.json` files were removed upstream in favor of `pnpm-lock.yaml` and `pnpm-workspace.yaml`. The bootstrap lifecycle runs through `pnpm install --frozen-lockfile` and invokes `build/npm/preinstall.ts` and `build/npm/postinstall.ts`.

## Native-Host contract audit (116 methods)

In VS Code 1.146.0, the `ICommonNativeHostService` / `INativeHostService` contracts expanded from 115 to 116 callable methods:
- 1 method added: `handleTitleDoubleClick(options?: INativeHostOptions): Promise<void>`.
  Implemented in `tabs-app/apps/desktop/src/nativeCodeHostMain.ts` honoring macOS system preferences (`AppleActionOnDoubleClick`: Minimize, None, or Maximize/Restore) and standard platform maximize/unmaximize on Windows/Linux.
- Verified in `tabs-app/apps/desktop/src/nativeCodeHostContract.test.ts` (116 methods covered) and `scripts/code-oss-native-contract-smoke.mjs`.

## Additional Code-OSS repair

- `src/vs/platform/browserView/electron-main/browserView.ts`:
  uses the owning Tabs workbench view as the native browser container. Keep
  the stock BrowserWindow container for upstream standalone and auxiliary windows.

## Tabs-side compatibility boundary

Always review these alongside fork changes:

- `tabs-app/apps/desktop/src/codeHostManager.ts`
- `tabs-app/apps/desktop/src/codeControlChannel.ts` (routes only to the socket registered for the requested project)
- `tabs-app/apps/desktop/src/nativeCodeHostExtensionEnvironment.ts` (passes the registered workbench project ID to the utility process)
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
- `tabs-app/scripts/lib/code-oss-media.ts` (checks compiled webview and notebook media in the runtime payload)
- `.github/workflows/build-desktop.yml` and `.github/workflows/release.yml`
