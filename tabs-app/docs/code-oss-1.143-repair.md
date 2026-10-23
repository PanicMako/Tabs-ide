# Code-OSS 1.143 startup repair

## Change

The packaged editor failed before creating a workbench because upstream 1.143 changed `WebviewMainService` from `(fileService, windowsService)` to injected `(instantiationService, windowsService, logService)` dependencies. Tabs now creates it through the upstream instantiation service, registering the existing file and log services. A child service collection preserves the embedded renderer's window routing; browser views retain their separate owning-window routing. The webview service and child container are disposed during shutdown. Its local constructor type also disallows supplying the old positional arguments.

Changes are isolated to the existing `chore/sync-vscode-1.143.0` worktree. No Code-OSS upstream files or dependency versions were changed by this repair.

## Regression gate

From `tabs-app/`, run:

```bash
bun run test:code-oss
```

This builds the shell, runs the upstream native-adapter smoke and starts a real isolated Electron instance. The new `apps/desktop/scripts/code-oss-workbench-smoke.mjs`:

- requires an available embedded backend and the exact expected runtime version;
- registers a temporary project through the real orchestration API, avoiding races with the outer shell's session synchronization;
- ensures, activates and sizes the project's native workbench;
- verifies the workbench loads from the selected runtime/artifact, rather than silently falling back to another checkout;
- opens a real TypeScript file and checks rendered contents;
- checks that the Tabs radius stylesheet is active (`--vscode-cornerRadius-xLarge: 36px`);
- opens an integrated terminal via the bundled workbench extension, executes a shell command and verifies its output file;
- shuts down the owned process and removes its temporary profile/workspace.

The test fails immediately on the original unavailable-backend failure. It can also test a packaged macOS application using `--app=/actual/mount/path/Tabs.app`; packaged mode removes the source-build environment override. `EVIDENCE_DIR` saves a screenshot, structured result and process log outside the disposable profile. No user profile or installed application is selected.

## Validation

- Final source workbench gate: passed backend startup, real file, stylesheet and real terminal command.
- Full monorepo suite: all 18 tasks passed; root runner 641 files passed, 7,561 tests passed / 35 skipped. Package-specific suites also passed.
- Desktop package rechecked after the final routing adjustment: all 79 files / 662 tests passed.
- Workspace typecheck: 16 tasks passed; desktop typecheck repeated after final routing adjustment.
- Formatting/lint: zero errors, 661 existing warnings.
- An initial heavily concurrent test run hit a Chromium teardown timeout; the full suite passed when rerun with lower task concurrency. Assertions and timeouts were not weakened.
- The broader desktop smoke encountered a renderer reconnect timeout while artifact packaging was active. Its subsequent isolated rerun passed all six stages, including reconnect, persistence, migrations and graceful shutdown with zero orphaned test processes.
- Final DMG/ZIP: rebuilt from the final source. The read-only mounted DMG passed the exact-runtime workbench/file/stylesheet/real-PTY gate. Its `app.asar` and six selected runtime assets matched the ZIP byte-for-byte. The tested DMG volume was ejected and its temporary mount directory removed.
- Artifact sizes: DMG 1,818,235,786 bytes; ZIP 1,393,219,875 bytes. Runtime 1.143.0; installed application was left untouched.
- Structured packaged-test evidence: `code-oss-1.143-repair-evidence.json`.

The locally generated installers retain the checkout's Tabs application version 2.0.0 and are unsigned/ad-hoc test artifacts containing Code-OSS 1.143.0. No public release version was assigned, no installed app was replaced, and no commits/staging/push/publication were performed. Authentication with real accounts and other operating systems are separate acceptance work; this repair does not claim those scenarios were exercised.
