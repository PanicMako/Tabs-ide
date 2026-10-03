# Code-OSS 1.138.0 sync walkthrough

## Result

Tabs now vendors Microsoft VS Code 1.138.0 at upstream commit
`7debcd0e2acdea1c52de81bf9ee1620444407dda` in both `vscode-main` and
`tabs-code-oss`. `vscode-main` is the pristine reference snapshot;
`tabs-code-oss` is the embedded Code-tab runtime with the reviewed Tabs fork
delta applied.

## Independent audit findings

The initial automated replay was not reliable. Its replacement script did not
assert that source patterns matched before reporting success. It therefore
reported all 25 fork patches as applied even though only 15 modified files
remained. The audit restored the ten silently dropped integrations:

- embedded context-menu ownership and coordinate translation
- awaited workbench shutdown exposed to the Tabs host
- extension-signature module resolution for the packaged runtime
- terminal request cancellation handling
- Tabs editor watermark identity and agent command
- embedded workbench font bootstrap fallback
- list, extension-icon, and SCM presentation patches
- message-port diagnostics used when debugging the embedded preload bridge

The resulting source comparison has no upstream files missing from
`tabs-code-oss` and exactly 26 reviewed modified upstream files: the 25
preserved fork files plus the request-store regression test added during this
audit. Tabs-owned additions remain separate, including the Tabs workbench
contribution and assets.

The audit also found that an unpackaged production desktop launch could call
Electron's `loadURL` with an undefined development URL. The desktop now loads
the dev server only when that URL exists and otherwise uses the registered Tabs
application protocol. The smoke test now treats the app's own fatal-startup log
and this conversion failure as failures.

## Native-host compatibility

VS Code 1.138.0 adds `setApplicationBadge` to the callable native-host
contract. Tabs implements the platform behavior and supplies the new agent
network-filter service required by the browser-view service. Toast deduplication
also follows the updated upstream contract.

`nativeCodeHostContract.test.ts` derives the callable methods directly from the
vendored `ICommonNativeHostService` declaration. It verifies that all 104
unique methods have an explicit implementation, intentional embedded-product
no-op, or clear rejection in the Tabs host. This converts the compatibility
count from a manual audit statement into a regression test.

## Verification evidence

- Code-OSS client compile: passed with zero errors.
- Code-OSS client typecheck: passed.
- Full Code-OSS Node suite under the pinned Node 24.18.0 runtime: 16,985
  passing and 200 intentionally pending.
- Code-OSS hygiene on the restored files and regression test: passed.
- Tabs contribution and terminal request-store suites: 6 passing.
- Copilot development compile: passed.
- Copilot packaging suite: 13 passing.
- Tabs desktop suite: 40 files and 352 tests passing.
- Tabs monorepo typecheck: 12 of 12 packages passing.
- Tabs repository check: all 1,898 files formatted, zero lint errors, and 426
  pre-existing warnings.
- Tabs desktop production build: passed.
- Electron desktop smoke test: passed after strengthening fatal detection.
- Release smoke checks: passed.
- Live desktop dev launch: the saved project created an embedded Code session,
  the 1.138.0 workbench HTML and scripts returned HTTP 200, workbench loading
  completed, and the Tabs integration extension host connected.
- Cleanup: the live launch left no Electron, backend, watcher, or CDP listener
  behind.

## Known unrelated repository state

The sync was performed in an already dirty working tree and intentionally
remains uncommitted for review. Generated Code-OSS build output and upstream
refresh files account for most of the large status. Review the source delta and
this walkthrough rather than interpreting a clean `git status` as a sync
requirement.

The root-level `vp test` command is not a usable aggregate gate in the current
worktree. It collects Playwright specs, backup test trees, and incompatible
Vitest instances in one run, causing 147 collection failures; five existing
WebSocket tests also exceed its global five-second timeout. The supported
desktop suite, build, smoke, release smoke, Code-OSS suites, and live embedded
launch listed above all pass.
