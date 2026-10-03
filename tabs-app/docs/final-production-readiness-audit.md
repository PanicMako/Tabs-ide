# Final Production-Readiness Audit: Tabs IDE

Date: September 19, 2026  
Repository: `/Users/rushil.dev/Desktop/tabs/tabs-app`
Audited range: `ddaa3132..e0dd7a08`, plus the corrective changes described below

## Executive verdict

**Conditional go for Windows and Linux release-candidate validation. macOS public distribution remains deferred.**

The cross-platform source changes identified by the initial audit have been implemented and independently corrected where the first implementation was incomplete. The complete package-aware test suite, all 12 package type-checks, repository formatting and lint gates, release metadata smoke test, marketing build, and Electron desktop smoke test pass.

This is not evidence that a Windows NSIS installer or Linux AppImage has been exercised natively. Those two artifacts still require install-over-existing-version validation on their target operating systems before they should be promoted from release candidate to production. The current macOS ad-hoc build cannot guarantee Chromium cookie decryption across replacement builds; Developer ID signing and notarization remain explicitly deferred until Apple credentials are available.

## Release status by platform

| Platform             | Current status          | Remaining acceptance work                                                                                                                                                                                                                                                            |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows x64 / NSIS   | Release-candidate ready | Build in Windows CI; install over an older release; verify `%APPDATA%` selection, DPAPI cookie continuity, protocol registration, shortcuts, uninstall, and rollback. Azure signing is optional for private testing and required according to the chosen public distribution policy. |
| Linux x64 / AppImage | Release-candidate ready | Build and launch on a case-sensitive Linux filesystem; replace an older AppImage; verify legacy/canonical profile selection, cookies, desktop integration, permissions, and clean shutdown.                                                                                          |
| macOS arm64/x64      | Internal/ad-hoc only    | Obtain Apple Developer ID credentials, sign and notarize both architectures, then execute an N-to-N+1 replacement test proving Keychain-backed cookie continuity.                                                                                                                    |

## Implemented findings

### Browser partition persistence on quit

The desktop shutdown path now:

- discovers and deduplicates active and previously known persistent browser partitions;
- synchronously requests DOM-storage flushing with Electron's `Session.flushStorageData()`;
- separately awaits `Session.cookies.flushStore()`, which is the asynchronous cookie-store API;
- bounds each cookie flush so one stalled Chromium session cannot prevent application exit;
- closes browser `WebContents` only after all partition flush attempts settle;
- shares one in-flight shutdown promise across concurrent quit/dispose callers; and
- performs the same explicit DOM and cookie flush for the default Electron session.

The first attempted remediation incorrectly treated `flushStorageData()` as a promise and did not await Chromium's cookie store. The corrected implementation and regression tests cover deduplication, ordering, failure isolation, timeout behavior, and concurrent shutdown calls.

### Workspace settings migration

The versioned Zustand migration no longer replaces every user's project settings with an empty object. It preserves valid project settings, normalizes legacy browser partition names, converts legacy server-process state, and recovers browser, tools, terminal processes, server presets, and custom embeds independently. A corrupt sibling field therefore defaults only that field instead of erasing every valid setting in the project.

This prevents a named browser profile from silently falling back to a different shared partition after an application update.

### Desktop user-data path continuity

New installations use stable lowercase canonical directories (`tabs` and `tabs-dev`). Existing explicit legacy profiles (`Tabs (Alpha)` and `Tabs (Dev)`) retain the precedence used by previous releases so an update cannot strand a user's active Chromium profile merely because a canonical directory was created later.

On Linux, the older Electron product-name directory (`Tabs`) is reused when there is no established alpha or canonical profile. The resolver never merges, moves, or deletes profile directories automatically. An explicit `TABS_DESKTOP_USER_DATA_DIR` continues to override automatic selection. Fixed-name profile directories may be symlinks; rejecting them would itself break continuity for users who intentionally relocate application data.

### Provider integration coverage

The four previously disabled provider integration cases are active. The provider service exposes an atomic subscription operation so tests and runtime consumers can subscribe before work publishes events, avoiding a startup race inherent in launching a stream consumer in the background.

### Reduced-motion behavior

Dialog, alert-dialog, command, and sheet primitives disable their transition and animation timing under reduced-motion preferences. Final CSS transforms are intentionally retained because those transforms establish popup positioning and nested-dialog layout; removing them collapsed or displaced UI rather than merely removing motion.

### Repository quality gates and release documentation

Formatting drift in the originally reported files is corrected. Release documentation now uses the actual application identifier, `com.tabs.app`, distinguishes release configuration from native proof, and accurately describes Electron's separate DOM-storage and cookie-flush APIs.

## Deferred macOS issue

Ad-hoc signing produces a build-specific designated requirement. Chromium's macOS safe-storage key is held in Keychain, so replacing an ad-hoc build can prevent the new build from decrypting cookies written by the old build. No source-only change in this pass claims to solve that distribution identity problem.

Before public macOS release:

1. Configure a stable Developer ID Application identity and notarization credentials in release CI.
2. Verify `codesign`, Team ID, hardened runtime, entitlements, notarization, and stapling on both architectures.
3. Install release N, authenticate to representative sites, quit immediately after authentication and after a normal dwell period, replace it with N+1, and confirm the sessions remain valid.
4. Repeat both in-app updater and manual drag-replacement flows.

## Automated verification

All commands below were run from the monorepo root after the corrective implementation.

| Command                            | Result | Evidence summary                                                                            |
| ---------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| `vp check`                         | Passed | 0 errors; formatter clean; 432 warning-level lint findings remain in the existing codebase. |
| `vp run typecheck`                 | Passed | 12/12 packages successful.                                                                  |
| `bun run lint`                     | Passed | Exit 0; warning-level technical debt remains.                                               |
| `bun run test`                     | Passed | 14/14 tasks; 220 test files passed, 5 skipped; 1,824 tests passed, 27 skipped.              |
| Focused desktop tests              | Passed | 60 tests covering browser shutdown persistence and user-data path resolution.               |
| Focused web tests                  | Passed | 15 tests covering reduced motion and persisted-state migration.                             |
| Focused provider integration tests | Passed | 4 provider lifecycle/event cases.                                                           |
| `bun run check:effect-versions`    | Passed | Effect resolved consistently to `4.0.0-beta.78`.                                            |
| `bun run release:smoke`            | Passed | Version propagation, frozen lock resolution, and macOS update-manifest merge.               |
| `bun run build:marketing`          | Passed | Astro static build successful.                                                              |
| `bun run test:desktop-smoke`       | Passed | Web, CLI, and desktop bundles built; Electron launched and exited cleanly.                  |
| `git diff --check`                 | Passed | No whitespace errors.                                                                       |
| Orphan-process check               | Passed | No Tabs server, desktop, Vitest, or Playwright process remained after verification.         |

### Test-runner caveat

Running bare `vp test` from the monorepo root is not a valid all-package test command in the current repository. The root Vitest discovery crosses package boundaries and ingests Playwright suites, fixtures, backups, and tests that require package-specific setup, producing loader failures unrelated to product behavior. `bun run test` is the authoritative package-aware pipeline because Turbo invokes each package's declared test command and configuration. This tooling inconsistency should be cleaned up separately, either by defining an explicit Vitest projects/workspace configuration or by documenting/removing the misleading root command.

## Native release-candidate acceptance matrix

### Windows

- Build x64 NSIS in a Windows runner.
- Install release N, create a project, select a named browser profile, and sign in to at least two cookie-backed sites.
- Quit immediately after one login and normally after the other.
- Install N+1 over N without uninstalling.
- Confirm projects, settings, browser profile selection, cookies, local storage, protocol links, shortcuts, and updater behavior survive.
- Test clean uninstall and verify whether user data is intentionally retained.
- Inspect Authenticode/Azure signing according to the intended release channel.

### Linux

- Build x64 AppImage in Linux CI and run it on a case-sensitive filesystem.
- Test fresh launch with no profile directories.
- Test each existing profile arrangement: `tabs`, `Tabs (Alpha)`, `Tabs`, and coexistence cases.
- Authenticate in shared, named-profile, and isolated browser partitions; quit immediately; relaunch; then replace with N+1 and repeat.
- Verify executable permissions, desktop-file integration, custom protocol handling, updater behavior, and clean process teardown.

## Residual risks and non-blocking debt

- Native Windows and Linux installer execution is still unverified on this macOS host.
- The repository currently reports 432 warning-level lint findings, including unused code and React dependency warnings. They do not fail the established gate, but React hook warnings deserve a separate behavior-focused cleanup rather than a blind mechanical rewrite.
- Root `vp test` discovery is misconfigured for this multi-package repository, as described above.
- Some build tools emit deprecation warnings (`transformWithEsbuild`, tsdown `noExternal`) that should be scheduled before their upstream removals.
- Skipped tests in the successful package-aware suite should be periodically reviewed; no new skip was added by this remediation.

## Final acceptance checklist

- [x] Cross-platform browser partition flush implementation and regression tests
- [x] Non-destructive workspace migration with field-level recovery
- [x] Legacy/canonical user-data selection tests across macOS, Windows, and Linux
- [x] Provider integration cases re-enabled
- [x] Reduced-motion correction without layout-transform removal
- [x] Formatting, lint, type-check, full package-aware tests, release smoke, marketing build, and desktop smoke
- [ ] Native Windows N-to-N+1 NSIS validation
- [ ] Native Linux N-to-N+1 AppImage validation
- [ ] Apple Developer ID signing and notarization
- [ ] Native macOS signed N-to-N+1 cookie continuity validation

Windows and Linux may proceed to native release-candidate testing. They should be called production-ready only after their unchecked native acceptance items pass. macOS remains intentionally deferred until the signing prerequisites are available.
