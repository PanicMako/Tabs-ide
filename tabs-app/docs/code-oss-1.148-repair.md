# Code-OSS 1.148.0 sync

`tabs-code-oss` now carries the reviewed Tabs fork of VS Code 1.148.0
(`661626d0e72f97806550790a98fb87116c9db825`), upgraded from 1.146.0
(`69047191fc427f2f92828279aae1d90d8eeda7ab`) on branch `chore/sync-vscode-1.148.0`.

## Method

A three-way merge in a scratch repository: base = pristine 1.146.0, ours = the
Tabs `tabs-code-oss` tree from `main`, theirs = pristine 1.148.0. The Tabs delta
against 1.146.0 was 69 files. Upstream changed 4,710 files and deleted 225; the
merge removed those deletions from `tabs-code-oss`.

## Conflicts resolved

- `src/vs/workbench/browser/parts/editor/breadcrumbsControl.ts`: kept the Tabs
  `aria-expanded` update and upstream's new `_onDidOpenEditorTypePicker` event.
- `src/vs/workbench/contrib/chat/browser/chatParticipant.contribution.ts`: kept
  the Tabs always-registered Chat view (hidden only while an update is
  required) and adopted upstream's `agentsViewActive` negation. Restored the
  `ContextKeyExpr` import that upstream now needs.
- `extensions/copilot/pnpm-lock.yaml`: upstream deleted it, because Copilot is
  now part of the root workspace. The Tabs `dotenv`/`source-map-support`
  production move now lives in the root `pnpm-lock.yaml` (`pnpm install
--lockfile-only`; the diff against upstream's lockfile is just those two
  entries).
- `src/vs/workbench/browser/parts/auxiliarybar/auxiliaryBarPart.ts` (merged
  cleanly, failed type-check): upstream's new `!== HIDDEN` auto-hide check is
  redundant after the Tabs `HIDDEN` early return, so it is now `if (autoHide)`.

## Package layout change (CI)

1.148 makes the root, `extensions/` and `extensions/copilot` one pnpm
workspace and switches to `nodeLinker: isolated`. `build/lib/dependencies.ts`
refuses a hoisted install of that workspace, so the extension packaging tasks
must compile from the isolated layout. Tabs ships the root `node_modules`
directly, and the mac/Linux staging copy and the Windows `npm ls` inventory
both expect a flat layout. `build-desktop.yml` and `release.yml` therefore:

1. install the whole workspace once (`pnpm install --frozen-lockfile
--ignore-scripts`), replacing the separate `extensions/` and
   `extensions/copilot` installs;
2. compile the workbench and the built-in extensions;
3. in a new "Lay out Code-OSS runtime dependencies" step, remove the root
   `node_modules`, reinstall only the root project hoisted (`--filter .
--config.node-linker=hoisted`), then remove `cpu-features`, patch node-gyp
   and rebuild natives for Tabs' Electron (moved here from the install step).

Locally the hoisted root layout is 1.5 GB (1.146: 1.4 GB), contains no package
symlinks, and the Windows production inventory resolves 232 packages from it.

## Native-host contract (116 → 125 methods)

Explicit policies in `tabs-app/apps/desktop/src/nativeCodeHostMain.ts`:
`showAgentsLauncher` opens the Tabs Agents window. `showWindow` focuses the
Code view. `hideWindow`, `setWindowOpacity`, `setWindowIgnoreMouseEvents` and
`setWindowFolderLocation` are no-ops, because Tabs owns the outer window and
project restore. `getAppWindows` lists other apps' windows through
`desktopCapturer`. `captureAppWindow` returns `undefined`, which falls back to
a desktop media frame, and `endAppWindowCaptureFeedback` is a no-op.
`getCursorScreenPoint` now returns `workArea`. No new main-process IPC
channels were added upstream.

## Validation (macOS arm64)

- `pnpm install --frozen-lockfile --ignore-scripts` (root and `build/`): passed.
- `pnpm run gulp compile-client` and `compile-build-without-mangling`: 0 errors;
  `out-build/nls.messages.json` produced.
- Focused Code-OSS tests (`scripts/test.sh`): tabs.contribution,
  tabsEmbeddedLayout, tabsRailPresentation, requestStore, overlayWebview,
  webviewViewPane, layoutService, chatListWidget: 238 passing. editorTypePicker:
  11 passing. `build/lib/test/copilot.test.ts` and `hygiene.test.ts`: 34 passing.
- `tabs-app`: desktop `tsc --noEmit` clean; desktop vitest 979 passed
  (18 skipped); `scripts/lib` 68 passed; `bun run build:desktop` passed.
- `actionlint` on both workflows: passed.
- Four-platform installers: see the Build Desktop Installers run on the branch.

## Not verified locally

The extension production build (`compile-extensions-build`,
`compile-copilot-extension-build`) and installer packaging ran only in CI. The
app was not launched here; the in-app parity checklist in `code-oss-parity.md`
still needs a local run.
