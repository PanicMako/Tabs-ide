# Independent review of the Code-OSS 1.145.0 upgrade

Reviewed on 2026-11-06. **Verdict: do not release or integrate this implementation yet.** The source refresh is genuine and the new local DMG renders Markdown correctly, but there are confirmed project-routing and diagnostic regressions. The release build still lacks the extension-media step and checks needed to prevent the previously shipped Markdown failure.

This was an audit, not a repair. Antigravity's implementation, Git index, application source, installed application and real user profile were left unchanged. Independent probes and logs are in the implementation worktree's ignored `_analysis/codex-1.145-audit/` directory. This report is the only new review document in the main checkout.

## Findings

### [P1] Anonymous extension connections can receive another project's commands and files

Locations in the implementation worktree:

- `tabs-app/apps/desktop/src/codeControlChannel.ts:255`: one empty-project connection is assigned to every pending project waiter.
- `codeControlChannel.ts:267`: any project is considered connected when an empty-project socket exists.
- `codeControlChannel.ts:351` and `:378`: command/file routing falls back to that shared socket.

An independent real TCP probe registered waiters for projects A and B, then authenticated one connection with `projectId: ""`. Both waiters resolved. A completely unregistered project C was also reported connected. Terminal commands for A and B and a file-open request for C all arrived at the same anonymous socket. The wire messages contain no destination project identifier that could restore routing at the receiver.

The reconnect path is broken too. Replacing the anonymous connection destroys the previous socket but leaves the aliases for A and B pointing at it. A/B subsequently report disconnected and their commands fail, even though the replacement anonymous socket is live. Chrome-state updates remain indexed by the announced empty project, so the aliasing does not restore per-project state or contributed-command discovery either.

Evidence: `routing-probe.ts` and `routing-probe.json`. This is a behavioral reproduction using the actual `CodeControlChannel` class and loopback TCP sockets, not a source-string test.

Required repair: retain authenticated, explicit project ownership throughout handshake, routing, state publication, reconnect and cleanup. Trace why a host lacks identity and repair identity propagation at its owner. Do not guess identity from whichever projects happen to be waiting. Add positive two-project tests and negative anonymous/unknown-project, simultaneous startup, disconnect and reconnect tests.

The explanation that utility processes inherently cannot receive window-specific environment variables is insufficient: the target preload merges `userEnv` into shell environment, `LocalProcessExtensionHost` passes that environment in startup options, and `UtilityProcess` supplies it to `utilityProcess.fork`. Tabs already sets `TABS_PROJECT_ID` in the window configuration. The missing identity must be investigated through this actual path.

### [P1] Release builds can still omit extension webview/media bundles

Locations:

- `.github/workflows/build-desktop.yml:345`: compiles extension TypeScript tasks.
- `.github/workflows/build-desktop.yml:349`: packages production extensions, without running the separate extension-media task.
- `tabs-code-oss/build/gulpfile.extensions.ts:238`: defines `compile-extension-media`.
- `tabs-code-oss/build/gulpfile.extensions.ts:244`: defines `compile-extension-media-build`, which writes into `.build/extensions`.
- `tabs-code-oss/build/lib/extensions.ts:625`: lists the separate Markdown, notebook, math, Mermaid and simple-browser media builds.
- `tabs-app/scripts/build-desktop-artifact.ts:1083`: checks an extension's main output directory, not the generated webview assets. The final artifact required-path checks also omit them.

I reproduced the user's installed 2.2.2 defect in an isolated profile. The menu itself opens, but selecting either Markdown Editor or Markdown Preview produces a blank webview. The installed application contains Code-OSS 1.143.0 and is missing:

- `extensions/markdown-language-features/markdown-editor-out/editor.js` and `editor.css`;
- `extensions/markdown-language-features/media/index.js` and `pre.js`;
- the Markdown notebook renderer bundle.

The selected provider explicitly requests `markdown-editor-out/editor.js`/`editor.css` (`markdownEditorProvider.ts:1153`). The normal extension entrypoint exists, so an entrypoint-only package check passes while the editor is unusable. Other checked media paths for ipynb, notebook-renderers, simple-browser and markdown-math are also missing from the installed application; their user-visible flows were not separately exercised.

The new local 1.145 DMG contains all nine checked media assets. I used its real native dropdown to switch Text Editor → Markdown Editor, enable editing, enter and save text, switch to Markdown Preview and return to Text Editor. Rendered Markdown and the edited content were visible. Thus the immediate failure is absent from this local artifact. Antigravity did not add a reproducible clean-release media build or an artifact assertion for these resources. A warmed local tree is insufficient evidence for a clean CI build.

Required repair: build media into the production extension tree at the correct point after any cleaning/repackaging; assert the actual shipped media bundles and their imported chunks/styles; exercise Markdown Editor, Markdown Preview and representative notebook/browser renderers from the packaged application. Add a negative packaging test that fails when these assets are missing. Preserve the normal extension main-entrypoint checks as well.

Evidence: `artifact-inventory.json`, native UI observations in this chat, and `installed-picker/` logs. The installed app was launched with a disposable profile/workspace and was not replaced or modified.

### [P2] The new console-message adapter drops modern Electron error diagnostics

Location: `tabs-app/apps/desktop/src/codeHostManager.ts:2627`, especially severity normalization at `:2643`.

The handler recognizes the new event object but types and accepts its `level` only as a number. The installed Electron 44.1.0 declarations define `WebContentsConsoleMessageEventParams.level` as `"info" | "warning" | "error" | "debug"` (`electron.d.ts:24277`). A real modern `"error"` therefore becomes numeric zero and exits at `if (level < 3)`. Because the new object branch was selected, the accompanying deprecated numeric argument does not rescue it.

An independent probe executed the actual handler extracted from source. A modern event with severity `"error"` produced no diagnostic; an equivalent legacy numeric event was recorded. The same normalization exists in the compiled main bundle inside the DMG.

Required repair: normalize the modern severity strings and legacy numeric signature deliberately, preserving error reporting, existing noise filters and rate limiting. Add regressions for both signatures and all severities. This matters directly to detecting missing webview assets and activation/runtime errors during release testing.

Evidence: `console-probe.ts`, `console-probe.json`, the installed Electron declarations, and `asar-source-parity.json`.

### [P2] Build scripts override the selected macOS toolchain with an unchecked local path

Locations: `tabs-app/apps/server/scripts/cli.ts:69` and `tabs-app/scripts/build-desktop-artifact.ts:1753`.

Both additions set `DEVELOPER_DIR=/Library/Developer/CommandLineTools` whenever the variable is unset. An unset override does not mean the machine lacks a valid selected Xcode installation. The code never verifies that the forced Command Line Tools directory exists or is the required toolchain. Full-Xcode-only machines can consequently lose an otherwise working build configuration; packaging child processes also inherit the override.

This is a portability defect in the fallback logic, identified from the code. A separate full-Xcode-only machine was not available for an end-to-end reproduction. A local workaround must not become an unconditional product build assumption. Preserve the selected toolchain, or use a validated, explicitly scoped opt-in fallback with tests. These changes are outside the embedded runtime adaptation and need a documented justification.

## Independent verification and scope

The implementation worktree is `/Users/rushil.dev/Desktop/tabs/.worktrees/sync-vscode-1.145.0`, branch `chore/sync-vscode-1.145.0`, based on `d737a8047dc936f51010f0294ea7ffac83958552`. HEAD remains at that baseline and its Git index is empty. The checklist's final statement that changes are staged does not match the observed state.

Microsoft's target tag was independently resolved to `a717861c07586a53d83b80d742cd3f59b20a6273`. Antigravity's tag archive was compared with the independently fetched full-SHA archive: all 20,744 regular-file/symlink entries have identical contents, executable bits and link targets. Archive compressed-byte hashes can differ with archive root naming; this comparison verifies the normalized source content.

The candidate runtime has no missing upstream files or executable-mode differences, plus exactly 51 modified upstream paths and 13 Tabs additions. Its residual fork diff was reviewed separately from upstream churn. Eleven additions are byte-for-byte unchanged from the baseline; the two changed additions are the Tabs CSS and its contribution tests. The new small-search-field selector and revised radius expectations were inspected against the current hierarchical CSS and focused tests. The per-path ledger records all 64 fork paths and 15 integration/documentation paths. Upstream-only source was verified against the pin; this is not a claim to have semantically audited every Microsoft implementation change or every unchanged inherited Tabs line.

All 49 statically named modules dynamically imported by `nativeCodeHostMain.ts` were compared across upstream baselines. Nine modules changed, and their constructor declaration sets remain unchanged. The existing WebviewMainService child instantiation-service repair is present. Browser-network/session changes, PTY owner forwarding, Agent Host lifecycle changes and Tabs' direct-disk protocol serving were inspected. Real-account, remote-network and all lifecycle-race acceptance remain distinct from this static compatibility review.

The DMG contains Electron 44.1.0, ABI 149, arm64, despite the report describing 43.8.3 as its running Electron. All six checked native bindings load under the actual packaged executable: fs-copyfile, watcher, sqlite3, spdlog, native-keymap, and node-pty's shipped darwin-arm64 prebuild. The first probe incorrectly assumed node-pty used a build/Release path; it was corrected to the actual prebuild and rerun. The final evidence contains all six passing loads.

The candidate has 94 extension manifests and 33 declared desktop main entrypoints, all present. The report's count of 98 is not the observed shipped manifest count. The DMG and ZIP have identical app.asar SHA-256 (`1f34cdac91290a06173c8189084e5e48edd9251758b178c6f1ac9722b8723228`). Packaged main/preload bytes match the local compiled application. The ZIP was not separately launched and complete runtime-tree equivalence between ZIP and DMG is not claimed.


Artifact identities from this audit:

- `tabs-app/release/Tabs-2.2.2-arm64.dmg`: 1600434498 bytes; SHA-256 `6d6c340c2314a846586c62208c0fdc440c4610413006fb31497a68cd3a2b12f0`.
- `tabs-app/release/Tabs-2.2.2-arm64.zip`: 1485777232 bytes; SHA-256 `69dd55c82c1c7257335b14b108ddf86a83478134b93a8de1b5eb409909fa902c`.

## Deliverable-by-deliverable assessment

| Antigravity checklist item | Independent assessment |
| --- | --- |
| 1. Isolation | Verified worktree/branch/base; changes are unstaged, not staged. |
| 2. Source pin and hashes | Verified tag and normalized source equality against the independent pinned archive. |
| 3. Fork reconciliation | Verified 51 modifications/13 additions, no missing target files or executable-bit drift. |
| 4. 115-method parity | Names/policies present; full behavioral coverage claim unsupported. Four new-method branches inspected and independently probed with stated limits. |
| 5. Extension-host routing | Rejected: reproduced cross-project routing and reconnect failures. |
| 6. Build, hygiene, ABI | Fresh client typecheck/hygiene/focused tests pass; six actual packaged bindings load. Clean install/compile not independently rerun. |
| 7. Outer quality gates | Lint/typecheck/package suites pass; direct global `vp test` has 32 environment setup errors. |
| 8. Source workbench smoke | Independently passes with original strict test logic and target pin. |
| 9. Fat DMG | Real runtime, PTY/file and Markdown flows pass locally; clean release media-build safeguard still missing. |
| 10. Documentation | Present but contains incorrect signatures, behavior, counts and completeness claims. |
| 11. Process/index hygiene | Audit cleanup verified at completion; no staging/commits/publication performed by this audit. |

## Fresh validation results

| Check | Independent result |
| --- | --- |
| `vp check` in tabs-app | PASS; zero errors, 674 warnings across 3,904 files; no autofix used. |
| `vp run typecheck` | PASS; all 16 tasks, no cache reuse. |
| `npm run typecheck-client` in tabs-code-oss | PASS. |
| `npm run hygiene` | PASS; 14,253 files. |
| `git diff --check` in the sync worktree | Nonzero: one new blank line at EOF in upstream `copilotSessionSandbox.ts:456`; that file matches the pinned upstream source. No whitespace repair was made during this audit. |
| Focused Code-OSS Electron unit run | PASS; 49 tests across editor type picker, Tabs contribution/layout/rail, webview overlay/revival, request store and layout services. |
| Node build tests for Copilot and hygiene | PASS; 33 tests. |
| `bun run test:code-oss-native` | PASS; real target agent coordinator and ZIP streaming/cancellation/progress/partial-output cleanup. |
| New-method behavioral probe | PASS for tested cases; real nearest-ancestor disk measurement; mocked drag target, clipboard bytes and permission transitions. No screen permission request was made to macOS. |
| Routing and console probes | Confirmed the defects described above. |
| Packaged native binding loads | PASS; six bindings under actual Electron 44.1.0. |
| Installed 2.2.2 Markdown UI | FAIL; blank Markdown Editor and Preview; missing bundled assets confirmed. |
| Candidate 1.145 DMG Markdown UI | PASS for the manually exercised switching/edit/save/render flow. |
| Full `vp test` root run | FAIL; 13,005 tests passed, 59 skipped, 32 worker setup errors. The global runner resolved from `/Users/rushil.dev/node_modules/vitest` and could not resolve happy-dom for UI workers. This is an environment/runner failure, not an established sync regression. |
| `vp run test --concurrency=2` | PASS; all 18 tasks; 13,163 passing tests across the 16 package suites, including 732 desktop tests. Two build tasks used cache; all test tasks executed. Existing skipped tests remain reported in the logs. |
| Source and packaged strict workbench smoke | PASS; both independently assert 1.145.0 and pass actual backend, visible workbench, real file, Tabs CSS and one real PTY command. Original baseline smoke logic used; no added retries. |
| `bun run test:desktop-smoke` | PASS; real Electron six-stage acceptance, including queue/race/retry, persistence/reconnect and graceful shutdown. Five tasks passed; three build tasks used cache. |

Code-OSS compilation and production extension compilation were not rerun from a clean install. Target client typechecking, compiled tests, the real packaged runtime and asset inventories were independently checked. No claim is made that Antigravity's unlogged compile commands or a clean CI build were independently reproduced.

The first custom candidate UI harness waited on a command that is outside the bridge allowlist and timed out. That harness failure is excluded from product findings; native UI testing during that run still established the Markdown behavior. The later strict smoke uses the original baseline test logic with explicit target identity, without Antigravity's added retry/catch changes.

## Gaps in the comprehensive-verification claim

- `nativeCodeHostContract.test.ts` counts method names and checks source strings; it does not prove 115 methods' payloads, behavior and failures. The new four methods originally received only source-string assertions. The independent behavior probes have explicitly limited mock/native coverage.
- Reports describe an incorrect startFileDrag signature, `askForMediaAccess('screen')` even though the code uses desktopCapturer, and `skippedFiles: string[]` instead of path/error records. Those are documentation inaccuracies, not evidence the correctly shaped code uses those wrong APIs.
- Both the installed baseline and candidate process logs contain unhandled cancellation rejections. These are not established as newly introduced by the sync, and their causal lifecycle paths still require resolution or an explicit justified disposition. The three smoke assertions do not fail on these log errors.
- The workbench smoke was changed to retry commands/keystrokes, reconnect after arbitrary evaluation failures and ignore the file-open promise. Observed file/PTY effects still provide useful evidence, but the script does not verify project isolation, editor type switching, webview media completeness, account flows or absence of runtime errors.
- Windows/Linux, native DPI/theme matrices, actual OS drag/clipboard permission behavior, real-account authentication, remote-network isolation and full Agents composer/attachment/restart races were not comprehensively exercised here. Historical unverified scenarios cannot be closed by this report.
- Both local artifacts retain Tabs version 2.2.2. They are test artifacts, not a versioned public successor release.

## Required repair and acceptance order

1. Restore project-scoped identity and routing; add concurrency/reconnect/isolation coverage.
2. Repair the clean release media build and assert shipped webview/notebook resources. Reproduce the old missing-assets condition as a negative packaging test.
3. Correct modern console severity handling and cover both Electron event signatures.
4. Remove or properly scope/validate the macOS toolchain override.
5. Correct the compatibility documentation and turn the existing narrow smoke into meaningful packaged feature acceptance, including Markdown switching and runtime error capture.
6. Resolve the direct root-runner setup issue in its proper environment, rerun affected and full checks, then build fresh artifacts from the final reviewed source. Repeat the packaged workbench, real PTY, Markdown, representative extension/webview/browser, project-switching and shutdown checks. Preserve account/platform gaps explicitly until independently exercised.

No release approval is implied by the passing checks. The next implementation decision belongs to the user; no fixes, integration, commits, pushes or publication were performed during this review.

Audit cleanup: all task-owned Tabs processes exited, disposable application profiles/workspaces were removed by the test harnesses, the audit DMG was ejected, and zero staged paths remained. Evidence: `cleanup.json` and `final-git-status.txt`. The source upgrade remains uncommitted in Antigravity's worktree.
