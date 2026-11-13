# Code-OSS 1.146.0 repair

This worktree carries the reviewed Tabs fork of VS Code 1.146.0, pinned to
`69047191fc427f2f92828279aae1d90d8eeda7ab`. It upgrades from baseline
VS Code 1.145.0 (`a717861c07586a53d83b80d742cd3f59b20a6273`) on branch
`chore/sync-vscode-1.146.0`, starting from main commit
`e7e0350da1f19d7168084087e6cbf662d5a74876`.

## Summary of Upstream Changes

- **Build System Migration to pnpm:** In VS Code 1.146.0, Microsoft migrated the
  entire repository packaging and lifecycle scripts from `npm` to `pnpm@12.16.0`.
  All `package-lock.json` files were removed upstream and replaced with
  `pnpm-lock.yaml` and `pnpm-workspace.yaml`. The local installation procedure
  in `tabs-code-oss/` now runs via `pnpm install --frozen-lockfile` (with
  `VSCODE_SKIP_NODE_VERSION_CHECK=1` when running Node v24.18.0).
- **Upstream Deletions:** 640 files removed upstream between 1.145.0 and 1.146.0
  were identified via `git diff --no-renames --diff-filter=D` and purged from
  `tabs-code-oss/`.
- **Native Host Service:** `ICommonNativeHostService` and `INativeHostService`
  expanded from 115 to 116 callable methods with the addition of
  `handleTitleDoubleClick(options?: INativeHostOptions): Promise<void>`.

## Tabs Adaptations & Repairs

- **Native Host Title Double-Click:** Implemented `handleTitleDoubleClick` in
  `tabs-app/apps/desktop/src/nativeCodeHostMain.ts`. On macOS, it reads the
  `AppleActionOnDoubleClick` user default (`Minimize`, `None`, or toggles
  `maximize`/`unmaximize`). On other platforms, it toggles maximization. Added
  test coverage in `nativeCodeHostContract.test.ts`, verifying 116 covered
  contract methods.
- **Dynamic patchNativeGyp import:** In `tabs-code-oss/build/npm/postinstall.ts`,
  the call to `patchNativeGyp()` was updated to dynamically check for
  `patchNativeGyp.ts` on disk. This prevents failure when running isolated
  test harnesses (such as `cloudSandbox.test.ts`) that copy build scripts into
  temporary fixture directories without Tabs-only files.
- **Semantic Patch Replay:** 13 Tabs-owned additions were preserved verbatim.
  39 modified files identical between 1.145.0 and 1.146.0 upstream were cleanly
  re-applied. 14 upstream-modified files were semantically adapted:
  - `package.json`: Updated version to `1.146.0` and retained `--max-old-space-size=12288`.
  - `build/lib/i18n.resources.json`: Preserved `vs/workbench/contrib/tabs`.
  - `build/lib/stylelint/vscode-known-variables.json`: Preserved `--tabs-rail-*` variables.
  - `build/lib/test/copilot.test.ts`: Preserved production dependency assertions for Copilot SDK.
  - `build/npm/electronTypes.ts`: Preserved mirror fallback support.
  - `extensions/copilot/package.json`: Preserved `dotenv` and `source-map-support` in dependencies.
  - `src/vs/platform/browserView/electron-main/browserView.ts`: Preserved `_containerFor` owning Tabs workbench view association.
  - `src/vs/workbench/browser/layout.ts`: Preserved floating panel and zen mode fallbacks, and 240px default sidebar width.
  - `src/vs/workbench/browser/parts/editor/media/editorgroupview.css`: Preserved `.tabs-identity` and `.watermark-container > .letterpress` styling.
  - `src/vs/workbench/contrib/chat/test/browser/widget/chatListWidget.test.ts`: Preserved markdown render retry test.
  - `src/vs/workbench/contrib/files/browser/views/explorerViewer.ts`: Preserved `getTabsEmbeddedRowHeight` integration.
  - `src/vs/workbench/services/layout/browser/layoutService.ts`: Preserved `meetsTabsRail` calculation.
  - `src/vs/workbench/workbench.common.main.ts`: Preserved `tabs.contribution.js` import.

## Validation and Test Results

### Code-OSS Build & Tests

- `pnpm install --frozen-lockfile`: Passed. Built native dependencies (`node-pty`, `spdlog`, `sqlite3`, `@parcel/watcher`).
- `pnpm run compile-client`: Passed in 27s with 0 errors.
- `node build/next/index.ts bundle --nls`: Passed (32,112 messages extracted into `out-build/nls.messages.json`).
- `pnpm run typecheck-client`: Passed with 0 errors.
- `pnpm run hygiene`: Passed (14,584 files checked with 0 errors in 77.7s).
- `pnpm run compile-extensions-build`: Passed with 0 errors.
- `pnpm run gulp compile-copilot-extension-build`: Passed with 0 errors.
- `pnpm run gulp compile-extension-media-build` & `compile-extension-media`: Passed with 0 errors.
- `bun ../tabs-app/scripts/verify-code-oss-media.ts .build/extensions`: Passed (357 files verified).
- `bun ../tabs-app/scripts/verify-code-oss-media.ts extensions`: Passed (357 files verified).
- Focused unit and browser tests:
  - `copilot.test.ts`: 31 passing (0 failing).
  - `requestStore.test.ts`: 4 passing (0 failing).
  - `tabsEmbeddedLayout.test.ts`: 3 passing (0 failing).
  - `tabsRailPresentation.test.ts`: 8 passing (0 failing).
  - `tabs.contribution.test.ts`: 12 passing (0 failing).
  - `overlayWebview.test.ts`: 4 passing (0 failing).
  - `webviewViewPane.test.ts`: 3 passing (0 failing).
  - `layoutService.test.ts`: 12 passing (0 failing).
  - `editorTypePicker.test.ts`: 11 passing (0 failing).

### Tabs App Build & Tests

- `bun x --no-install vp run typecheck`: 16 packages passed, 0 errors.
- `apps/desktop` unit tests: 88 test files passed, 768 tests passed, 0 failures.
- `nativeCodeHostContract.test.ts`: 4 tests passed, verifying all 116 native host contract methods.
- Full workspace test runner (`vp test`): 1,319 test files passed, 13,360 tests passed, 0 failures (59 skipped).
- Code-OSS integration suite (`bun run test:code-oss`):
  - `code-oss-native-contract-smoke.mjs`: PASSED (real upstream agent coordinator, persistence, events, invitations, and ZIP streaming/cancellation).
  - `code-oss-workbench-smoke.mjs`: PASSED (complete embedded backend started on 1.146.0, bundled workbench extension, terminal command, visible Code session, real file contents, Tabs radius CSS, Markdown Editor & Preview, notebook renderer, integrated browser, and multi-workbench routing).

## Unverified / Out of Scope

- Windows and Linux desktop installer artifacts were not built locally (tested on macOS arm64).
- Production release code-signing, auto-updater signatures, and live AI provider authentication flows were not tested.
