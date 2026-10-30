# Independent review of Antigravity's Code-OSS 1.143 refresh

Reviewed on 2026-10-22. **Initial verdict: do not approve the original artifacts. The startup blocker has since been repaired and the rebuilt artifacts verified; see the follow-up below.** The upstream refresh is real, but a packaged runtime startup failure blocks the embedded editor.

## Blocking finding: outdated WebviewMainService constructor

In `.worktrees/sync-vscode-1.143.0/tabs-app/apps/desktop/src/nativeCodeHostMain.ts:713`, Tabs still calls:

```ts
new modules.WebviewMainService(fileService, windowsService);
```

Upstream 1.143 changed the constructor in `tabs-code-oss/src/vs/platform/webview/electron-main/webviewMainService.ts:23` to accept `IInstantiationService`, `IWindowsMainService`, and `ILogService`. It immediately calls `instantiationService.createInstance(WebviewProtocolProvider)`. Passing `FileService` as the first argument therefore throws before the embedded backend becomes available. This is an actual change from the 1.142 implementation, not an inferred ABI concern.

I reproduced this using the **actual DMG**, mounted read-only, with a new temporary TABS_HOME and Chromium profile. The packaged outer renderer loaded at `tabs://app/`, but `window.desktopBridge.getCodeHostState()` returned:

```json
{
  "available": false,
  "mode": "embedded",
  "entry": null,
  "reason": "Embedded editor services failed to start: instantiationService.createInstance is not a function",
  "version": null
}
```

Ensuring and activating a Code session with explicit visible bounds did not create a workbench target. The file-open scenario could not proceed. The isolated process exited cleanly; its temporary profile and workspace were removed and its DMG mount was ejected. The original installed Tabs process (PID 34940) remained running.

The DMG and ZIP contain **identical app.asar bytes**, so the ZIP shares this startup defect. Neither artifact should be considered a working Code-OSS upgrade merely because the outer Tabs renderer starts.

### Required repair and proof

Construct the upstream service through a correctly configured instantiation service, including the file, window and log services it needs. Review the other dynamically imported service constructors too; the local `new (...args: unknown[])` declarations do not typecheck compatibility with upstream signatures. Add an integration gate that starts the complete native backend against the compiled target runtime. It must fail if Code-OSS is unavailable, create and activate a visible editor session, open a real file, and then exercise terminal/webview/extension paths. Rebuild both artifacts after the repair and repeat this check against the rebuilt package.

The current native contract smoke covers the real agent coordinator and ZIP adapters, but not complete backend construction. The six-stage desktop smoke checks the outer shell, backend RPC, queueing, migrations, persistence and shutdown; it never calls `ensureCodeSession` or asserts a native workbench rendered. Both pass despite the reproduced editor failure. The report's 1,636 ms cold start proves only the outer renderer loaded.

## What was independently verified

- Microsoft's `1.143.0` tag resolves to `2d0b7506a36c1d6db9a466440131a8e01eab2289`, matching the report. Official notes: https://code.visualstudio.com/updates/v1_143.
- Both the upstream snapshot and patched runtime report version 1.143.0. This is a real source refresh, not just a package-version edit.
- A streamed comparison against Microsoft's exact source archive checked **20,827 regular upstream files**. The pristine snapshot matched after accounting for **98 hydrated Git LFS SQLite fixtures**; all 98 payload hashes matched upstream LFS object IDs. No regular upstream file was missing and no executable-mode mismatches were found.
- The patched runtime has exactly the **31 documented upstream file modifications**, plus the six deliberate Tabs additions. The apparent seventh extra regular file is an upstream symlink fixture followed by the local file check, not an unexpected fork addition. The full fork patch was reviewed separately from ordinary upstream churn.
- The native-host interface comparison found no new callable methods relative to 1.142. That does not cover constructor/service changes such as the blocker above.
- The DMG (1,826,483,829 bytes) and ZIP (1,393,249,066 bytes) exist in the sync worktree's `tabs-app/release/`.
- The packaged runtime contains package version 1.143.0, `product.json`, a 1,500,526-byte NLS message bundle, compiled desktop preload/workbench files, and the compiled Tabs contribution/CSS. Key compiled files matched the local compiled runtime. The radius CSS is preserved and packaged.
- There are **95 extension manifests**, with **96 extension-root directories including shared node_modules**. All declared desktop `main` entrypoints are present. The report's “96 extensions” count includes that shared dependency directory; this is a counting discrepancy, not the startup cause.
- The packaged Electron framework is **44.1.0**. The six selected native packages (`fs-copyfile`, watcher, sqlite3, spdlog, native-keymap and node-pty) load successfully under local Electron 44.1.0 (ABI 149). The report's reference to rebuilding for 43.7.7 did not itself reproduce an ABI failure.
- Installed `/Applications/Tabs.app` still has Code-OSS **1.142.0**. The new local artifacts carry Tabs application version **2.0.0**, so they are test artifacts rather than a correctly versioned successor release to the installed 2.0.2.
- The sync worktree remains on `chore/sync-vscode-1.143.0` at HEAD `3915c864f131e8f7ed472cf06a9cbf5c9ac17835`. Its Git index is empty. No source fixes, staging, commits, integration, application replacement or publication were performed in this review.

## Independent validation runs

| Check                                                  | Result                                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Desktop package unit tests                             | 79 files, 662 tests passed                                                                         |
| Real upstream native-host adapter smoke                | Passed coordinator, persistence, events, invitation ownership, ZIP streaming/cancellation/progress |
| Code-OSS focused browser tests                         | 9 passed: Tabs contribution 4, RequestStore 3, WebviewViewPane 2                                   |
| Copilot packaging and vendored hygiene tests           | 33 passed                                                                                          |
| Code-OSS client typecheck                              | Passed                                                                                             |
| Code-OSS hygiene                                       | Passed over 13,623 files                                                                           |
| Tabs workspace typecheck                               | All 16 tasks passed                                                                                |
| Tabs formatting/lint                                   | Zero errors, 661 existing warnings                                                                 |
| Real Electron six-stage desktop smoke                  | Passed; confirms outer shell, not embedded editor                                                  |
| Full monorepo test runner                              | All 18 tasks passed; root runner reports 641 files passed, 7,561 tests passed / 35 skipped         |
| Actual packaged visible Code workbench/file-open probe | **Failed: backend unavailable, outdated WebviewMainService constructor**                           |

The full monorepo rerun finished successfully in 5m12s (18 tasks, two cached). The root-runner counts above exclude additional package-specific suites, which also passed. Passing these suites does not close the packaged startup failure.

## Review limits

This review inspected the existing compiled artifacts and repeated typechecks/tests; it did not repeat the complete client/extension compilation and artifact packaging, which would consume substantial temporary disk space. The production NLS and desktop extension entrypoints are present, but presence is not proof every extension activates. Workspace RPC acceptance and the separate extension-smoke command were not independently repeated here. Authenticated provider flows, Windows/Linux behavior, native accessibility/visual checks, and actual composer/attachment restoration in the dedicated Agents window remain unverified. Those required parity scenarios should not be described as comprehensively validated by the pasted report.

## Repair follow-up

At the user's request, the startup failure was fixed in the isolated 1.143 worktree. The service now uses upstream dependency injection with a child collection that preserves embedded-renderer window routing. The rebuilt DMG passed an independent exact-runtime check, opening a real file, checking radius CSS, and executing a real integrated-terminal command. Its application payload and selected runtime assets match the ZIP. The full 18-task suite, final desktop package tests, typechecks/lint and isolated six-stage Electron smoke passed. The original installed app remains untouched; no staging, commits, integration or publication were performed.

The detailed [repair report](/Users/rushil.dev/Desktop/tabs/.worktrees/sync-vscode-1.143.0/tabs-app/docs/code-oss-1.143-repair.md) and structured evidence describe the final state. The failed state recorded above describes Antigravity's original artifacts, which have now been replaced at the same local output paths. The rebuilt local artifacts are test builds, not a published successor release.
