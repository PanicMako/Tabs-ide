# Antigravity prompt: Tabs Code-OSS 1.145.0 upgrade

Copy everything below the separator into Antigravity. Prepared from repository and official upstream source inspection on 2026-11-05. This document is a work order, not evidence that the upgrade has been implemented or tested.

---

You are implementing one bounded change: upgrade Tabs IDE's embedded Code-OSS source from Microsoft VS Code 1.143.0 to exactly 1.145.0, preserve Tabs' deliberate fork behavior, and validate the real embedded editor in development and a local packaged desktop artifact.

Follow the numbered phases in order. Do the implementation and checks; do not merely return another plan. Keep an evidence log as you work. A passing outer React window, a changed version string, and mocks do not establish a working upgrade.

## 1. Scope, authorization, and boundaries

Repository: `/Users/rushil.dev/Desktop/tabs`.
Research baseline: clean `main` at `d737a8047dc936f51010f0294ea7ffac83958552`.
Source baseline: VS Code 1.143.0 at `2d0b7506a36c1d6db9a466440131a8e01eab2289`.
Target: VS Code 1.145.0 at `a717861c07586a53d83b80d742cd3f59b20a6273`.
Dedicated implementation branch: `chore/sync-vscode-1.145.0`.
Suggested isolated worktree: `/Users/rushil.dev/Desktop/tabs/.worktrees/sync-vscode-1.145.0`.
These are observed or proposed values, respectively. Recheck branch, HEAD, status, and worktree ownership before acting; never overwrite an existing branch/worktree.

- Never implement this in the user's `main` checkout or another agent's worktree. Create an isolated clean worktree from the verified current baseline, using the environment's worktree tool when available. Record its absolute root and use it for every subsequent command.
- Do not stage, commit, amend, cherry-pick, merge, push, open a PR, tag, publish, deploy, sign a release, or install/replace `/Applications/Tabs.app`. Leave source changes uncommitted for independent review. A future commit/PR is a separate decision.
- No reset/clean/discard/stash operations, broad process kills, or edits to other active worktrees. Do not prune old worktrees.
- This work order authorizes the exact upstream source replacement, including removal of obsolete upstream-owned files that the verified target deletes, and dependency/lockfile changes shipped in that exact upstream source. Export/review the deletion list first. It does not authorize deleting Tabs-owned features/files or unrelated application dependency upgrades. Ask before any deletion outside that narrow upstream replacement.
- Node/npm is authorized only within the vendored Code-OSS build and its own subprojects. Bun/Vite+ remains required within `tabs-app`. Use workspace-local scratch and test profiles; where existing smoke scripts use isolated OS temporary directories, use their established behavior rather than production profiles. Never alter global Node/npm configuration or user startup files.
- Do not upgrade the outer Tabs Electron version or other Tabs dependencies opportunistically. If a compatible build truly requires that expansion, report the exact upstream requirement and blocker before changing it.
- Keep the existing product architecture. No parallel editor implementation, browser-only substitute, redesign, extension compatibility bypass, broad no-op fallback, or disabled upstream feature to make checks green.
- Do not change settings, credentials, databases, or extension installations in the user's real profile. Do not print secrets or complete environments.

## 2. Read the governing instructions and previous failure

Read, in the isolated worktree, before editing:

1. `.agents/AGENTS.md`, `.agents/ARCHITECTURE.md`, `tabs-app/AGENTS.md`, `tabs-code-oss/AGENTS.md`, and `tabs-code-oss/.github/copilot-instructions.md`. Resolve stale absolute documentation links to the actual corresponding file here; never switch to an unrelated old checkout.
2. `.agents/instructions/anti-rogue.instructions.md`, `architecture.instructions.md`, `safety-net.instructions.md`, `production-standards.instructions.md`, and referenced standards relevant to changes.
3. `.agents/skills/tabs-vscode-sync-babysitter/SKILL.md` and `references/fork-inventory.md`.
4. `tabs-app/docs/code-oss-parity.md` and `tabs-app/docs/CODE_OSS_PRODUCTION_READINESS_AUDIT.md`.
5. `tabs-app/docs/code-oss-1.143-independent-review.md`, `code-oss-1.143-repair.md`, and `code-oss-1.143-repair-evidence.json`.
6. Relevant hygiene, unit-tests, accessibility, memory-leak-audit, launch, and sessions skills when touching those surfaces. No need to invoke unrelated skills.

The prior 1.143 artifacts loaded the shell while the embedded editor failed. `WebviewMainService` had changed constructor dependencies, but the host's loose local constructor types accepted the obsolete call. Preserve the current instantiation-service repair and child window-service override. A native-method name inventory cannot detect constructor, injected-service, payload, or return-shape incompatibilities.

This prompt's explicit isolation, package-manager, exact-upstream-replacement, and no-commit boundaries define the authorized scope. Do not interpret a generic instruction to finish with a clean Git tree as permission to commit, discard changes, or hide the upgrade. Final source changes must remain visible in the isolated worktree.

## 3. Re-establish the baseline and export rollback material

Run read-only inventory first:

```sh
git status --short --branch
git rev-parse HEAD
git worktree list --porcelain
git log --oneline -20 -- tabs-code-oss
```

Read actual package/toolchain metadata. During research:

- `tabs-code-oss/package.json`: 1.143.0.
- Ignored, untracked `vscode-main/package.json`: **1.138.0**, stale. This is not the current fork baseline.
- `tabs-app/apps/desktop/package.json`: Tabs 2.2.2, Electron 44.1.0.
- Existing runtime `.nvmrc`: Node 24.18.0; `.npmrc`: Electron headers target 43.7.7.

If new user edits exist, preserve their inventory and leave them untouched. Do not silently exclude relevant fork work or move it by stashing. If the intended baseline is ambiguous, report the precise difference before implementation.

Create a workspace-local ignored evidence/scratch directory in the implementation worktree. Record the baseline SHA, tag resolutions, tool versions, source-tree manifests, and full reviewed fork delta including binary files, executable bits, and symlinks. Export patches and copies of Tabs-owned additions before replacing source. Do not stage to generate the export. Document how the isolated worktree and patch export permit review/rollback without destructive commands against the user's checkout.

Obtain pristine 1.143.0 directly from Microsoft, rather than trusting `vscode-main`. Compare it with the tracked fork, excluding dependencies, build outputs, caches, and extension bundles. Classify each difference as deliberate Tabs customization, necessary build patch, generated drift, or unexplained drift. Investigate unexplained drift before replaying it.

Research found **13 added and 51 modified tracked paths**, listed in the appendix. The older fork inventory's six additions/31 modifications is historical and incomplete. Do not carry only those old patches. `test/monaco/dist/core.html` exists in the baseline archive but is absent from the tracked fork; investigate its generated/ignored classification rather than treating it automatically as an intentional deletion. Account for Git LFS pointers versus hydrated data when comparing fixtures, and preserve symlinks without dereferencing them.

## 4. Independently verify and pin the upstream source

Official references:

- https://github.com/microsoft/vscode/releases/tag/1.145.0
- https://code.visualstudio.com/updates/v1_145
- https://code.visualstudio.com/updates/v1_144
- https://github.com/microsoft/vscode/tree/a717861c07586a53d83b80d742cd3f59b20a6273
- https://github.com/microsoft/vscode/compare/1.143.0...1.145.0

Check the remote tag, including annotated-tag dereferencing if present:

```sh
git ls-remote https://github.com/microsoft/vscode.git refs/tags/1.145.0 'refs/tags/1.145.0^{}'
```

Research resolved it to `a717861c07586a53d83b80d742cd3f59b20a6273`. Fetch an archive or disposable source checkout pinned to that full SHA. Verify `package.json` reports 1.145.0. Record archive checksum and source provenance. A checksum you compute is an identity record, not a claim of an independently published Microsoft checksum.

Do not use moving `main`, Insiders, a binary VS Code installation, or a later version. If the tag resolves differently, stop and explain the discrepancy. If an unauthenticated GitHub API request is rate-limited, use the verified remote tag and official pinned archive; do not invent results.

The raw 1.143-to-1.145 archive comparison found 3,980 modified, 802 added, and 886 removed regular-file/symlink entries. Counts are a research cross-check, not an acceptance substitute; record extraction/LFS differences. GitHub's compare file list can truncate and is insufficient for complete replacement/deletion inventory.

## 5. Review compatibility changes BEFORE replacing the runtime

Build a compatibility matrix with columns: upstream symbol/file, old contract, target contract, Tabs caller/adapter, required action, regression test, observed result. Review every module dynamically imported or constructed by `tabs-app/apps/desktop/src/nativeCodeHostMain.ts`, not just these known changes.

### 5A. Native-host changes requiring explicit implementation

Compare `src/vs/platform/native/common/native.ts` and `src/vs/platform/native/electron-main/nativeHostMainService.ts` between the pinned releases, plus actual IPC call sites. Research verified four new methods:

- `startFileDrag(path: string, options?: INativeHostOptions): Promise<void>`.
- `requestScreenCaptureAccess(): Promise<boolean>`.
- `getFreeDiskSpace(path: string): Promise<number>`.
- `writeImage(data: VSBuffer): Promise<void>`.

Implement their normal upstream behavior in the existing Tabs host boundary; do not leave them in the unsupported-command catch-all. Audit the actual window-ID injection rules: wire arguments do not necessarily match the displayed interface signature.

- File drag: resolve the calling/target embedded window correctly; validate an absolute existing path; use the appropriate live Electron webContents and native file icon. Match upstream's behavior for missing files. Never drag from an arbitrary focused unrelated project window.
- Screen capture: follow upstream platform behavior and real macOS permission-state semantics. Request only when the command is invoked, never at startup or automatically during tests. Preserve denial/restriction; do not return a fabricated success. Stub permission APIs in unit tests and mark real permission acceptance separately.
- Free space: preserve upstream nearest-existing-ancestor behavior and byte units. Return a real measurement, not total capacity, free memory, zero, or an invented large number. Test nonexistent children and error paths.
- Clipboard image: correctly revive the VSBuffer payload and create the native image; preserve image bytes through actual IPC serialization. Add mock boundary coverage and a controlled clipboard check only in the isolated test session, restoring clipboard state where practical.

Recompute the complete native-host policy inventory. The historical count of 111 methods is not the target count. Test dispatch and payload/return semantics, not just a string allowlist. If an existing product limitation prevents parity, document a precise explicit rejection and the affected call sites; do not silently treat it as successful support.

### 5B. ZIP return contract: do not lose skipped-file results

Target `createZipFile` returns `Promise<INativeZipResult>`, containing `skippedFiles: readonly { path: string; error: string }[]`; the old API returned void. Research found Tabs currently awaits `zipOperations.create(...)` then returns `undefined`, and `createNativeCodeZip` returns `Promise<void>`.

Update the full path through `nativeCodeHostMain.ts`, `nativeCodeHostZip.ts`, operation management, writer options, IPC result, and tests. Collect both preflight source failures and streaming `onSourceError` failures when skipping is allowed. Return `{ skippedFiles: [] }` for a clean archive. Preserve failures when skipping is not allowed, cancellation, progress, entry/size limits, path validation, per-window ownership, cleanup, and existing explicit archive-merge rejection. Do not turn failures into a clean result or weaken archive protections.

Extend `nativeCodeHostZip.test.ts` and `apps/desktop/scripts/code-oss-native-contract-smoke.mjs` to exercise the real target `zip` implementation and returned results, including late read failure, cancellation, and cross-window isolation where applicable.

### 5C. Integrated browser session/network contracts

Review these target changes against host construction, service registration, window metadata, event forwarding, and browser callers:

- `src/vs/platform/browserView/common/browserView.ts`.
- `src/vs/platform/browserView/electron-main/browserViewMainService.ts`.
- `browserSession.ts`, `browserSessionRemote.ts`, `browserView.ts`, `browserViewGroup.ts` in that directory.
- Relevant workbench browser-view services and `tabs-app/apps/desktop/src/browserHostManager.ts`.

Verified changes include `proxyInfo` becoming authority-keyed `networkProxies`; browser view state carrying a session object instead of the former `storageScope`/`isRemoteSession` fields; network/affinity-aware session selectors; and `onDidRequestOpenExternal` replacing the previous remote-status event in the event map. CDP-created contexts retain their parent's network.

Preserve storage and project isolation, permission routing, popup/gesture policies, and explicit unavailable-network failure. A requested remote network must never silently fall back to local networking. Keep browser and embedded-editor window service ownership distinct. Do not broaden local file access or permit arbitrary external schemes to fix a loading issue. Add focused compatibility tests for affected Tabs adapters and exercise actual browser creation/navigation.

### 5D. Terminal, Agent Host, and protocol changes

- `src/vs/platform/terminal/node/ptyHostService.ts`: new `setParentWindow(id, handle)` forwarding; `installAutoReply` and `uninstallAllAutoReplies` now carry `ownerId`. Audit actual proxy/channel consumers, including disposal so one owner cannot remove another's replies.
- `src/vs/platform/agentHost/electron-main/electronAgentHostStarter.ts`: new sleep/wake, network and macOS accessibility notifications, management-service reporting, exit diagnostics, and delayed reconnection until exit diagnostics settle. Inspect Tabs' lifecycle/service stubs, configuration, construction, shutdown and event cleanup; avoid duplicate subscriptions or utility-process leaks. Test restart/dispose paths that cross this host boundary.
- `src/vs/platform/protocol/electron-main/protocolMainService.ts`: upstream replaces nested `net.fetch(file://...)` serving with `registerFileProtocol`, and adds Sessions document-policy handling. Compare Tabs' existing protocol implementation against the target semantics. Preserve exact resource bytes, MIME/security headers, URI normalization, allowed roots, worker/WASM loading and disposable registrations. Do not blindly copy just an API name or reopen unrestricted `file://` access.
- Recheck WebviewMainService and all other constructors/injected dependencies even if unchanged in this diff. Preserve the existing child DI container and proper cancellation/disposal of webview revival and overlay ownership.
- Preserve Agents handoff payloads, attachments, logical URI components, notifyReady ordering, session/onboarding precedence, cancellation, and project ownership. Prior documentation contains historical unverified scenarios; do not relabel them passed without fresh evidence.

## 6. Refresh upstream and replay the reviewed fork

Only after baseline export and compatibility review:

1. Create a fresh pristine 1.145 comparison snapshot in the implementation worktree's ignored `vscode-main/`. Do not overwrite the original checkout's stale snapshot.
2. Construct the candidate patched runtime from that exact source in workspace-local staging, retaining file modes, symlinks and verified fixtures. Never copy `.git` metadata into the monorepo.
3. Replay every reviewed fork patch semantically. If upstream already incorporates a fix, prove equivalence before retiring the local patch. If a file moved, locate its target implementation before adapting the patch.
4. Explicitly reconcile upstream deletions with the reviewed manifest; remove only verified obsolete upstream-owned paths within this authorized refresh. No unreviewed recursive copy with deletion over `tabs-code-oss`.
5. Review overlaps individually. The appendix marks files changed by both upstream and Tabs; these require semantic review even if a patch applies cleanly.
6. Transfer the reviewed candidate source into the isolated tracked runtime without carrying stale compiled output. Rebuild target output; stale 1.143 JavaScript is not validation of 1.145 source.
7. Recompare pristine target to final fork. Classify every difference. Confirm no omitted target source files, unexpected additions/deletions, executable-mode drift or symlink damage. Keep generated output and installed dependencies out of the source diff.

Preserve the newer Tabs features beyond the historical inventory:

- `tabsEmbeddedLayout.ts` and its actual virtualized row/breadcrumb measurements, including Explorer, Open Editors, Search, SCM and debug trees. Never emulate virtualized geometry through CSS alone.
- `embeddedWorkbench.css`, hierarchical radii, corner clipping across painted layers, editor watermark/logo, connected tabs, expanded quick-open/file search, theme-card surfaces and explicit user token overrides.
- `railPresentation.ts`, native hover placement, bounded labels/coordinates, accent continuation, cleanup on modal/scroll/disconnect/disposal and the existing project-scoped control channel.
- `commitDraftMenu.ts`, native editor-type picker, keyboard dismissal, dirty-editor behavior and default associations.
- Native edit-context and code-editor-service patches; inspect their purpose before replaying.
- Webview overlay/disposal fixes and their regressions, stable Chat/Claude/Codex view registration, managed-update Chat exclusivity, shared-profile notification preferences, layout persistence and shutdown hooks for both desktop and Sessions.
- Signature verifier override, MessagePort routing, context-menu coordinates/GC protection, request-store rejection handling, vendored hygiene/index isolation, production Copilot dependencies and packaging checks.
- `build/npm/patchNativeGyp.ts` and its postinstall hook, unless target evidence proves that repair obsolete. Target postinstall now explicitly sets the build subproject's native target to `process.versions.node`; adapt semantically and preserve correct Node-versus-Electron build targets.
- All existing outer-shell overlays, dialogs, theme derivation, project/session persistence, auth callbacks and native-view suspension/restoration. Preserve unrelated work by leaving it outside the upgrade diff.

## 7. Use the target toolchain and audit the native ABI

The verified 1.145 source has Node **24.22.1** in `.nvmrc` and Electron header target **43.8.3** in `.npmrc`. Retain the target's own source and lockfile dependency updates, including upstream node-pty, policy watcher, Copilot and provider package changes. Do not copy the old package/lockfile wholesale over the new ones; replay only intentional Tabs build/production-scope changes, including the reviewed Gulp memory allocation.

The outer application currently ships Electron **44.1.0**. That is a distinct runtime from the vendored npm header target. Do not assume ABI equality or declare success from either version string. Follow the existing artifact/native rebuild path and prove the actual native modules load in the Electron executable used by the built Tabs app. Inspect its `process.versions.electron`, `process.versions.modules`, architecture, and module paths. Never reuse incompatible native node_modules from another worktree/build.

Use lockfile installs. If the established two-step installation remains valid under target postinstall, run inside `tabs-code-oss`:

```sh
npm ci --ignore-scripts
VSCODE_FORCE_INSTALL=true npm_command=install node --experimental-strip-types build/npm/postinstall.ts
npm run compile-client
node build/next/index.ts bundle --nls
npm run typecheck-client
npm run hygiene
npm run compile-extensions-build
npm run gulp compile-copilot-extension-build
```

Inspect target scripts first. If an exact command changed upstream, use its verified replacement and record why; do not pretend a nonexistent command ran. Preserve the lockfile and record intentional changes. Do not repeatedly reinstall dependencies in response to a compile error without identifying its cause.

Verify fresh core assets and Tabs contributions exist, including `out/vs/base/parts/sandbox/electron-browser/preload.js`, `out/vs/code/electron-browser/workbench/workbench-dev.html`, `out-build/nls.messages.json`, and `product.json`, plus compiled Sessions files and target extension bundles required by packaging.

## 8. Test each integration cluster and then all required gates

Add/update meaningful regressions for the changes above before declaring compatibility. Run existing fork tests against newly compiled target output. Use `.agents/skills/unit-tests/SKILL.md` to select the proper runner; build-script tests and extension integration tests have their own runners and must not be claimed covered by an unrelated browser suite.

Relevant existing tests include:

- Code-OSS `src/vs/platform/terminal/test/common/requestStore.test.ts`.
- `src/vs/workbench/contrib/tabs/test/browser/tabs.contribution.test.ts`.
- `src/vs/workbench/contrib/webviewView/test/browser/webviewViewPane.test.ts` and `contrib/webview/test/browser/overlayWebview.test.ts`.
- `src/vs/workbench/test/browser/tabsEmbeddedLayout.test.ts` and `tabsRailPresentation.test.ts`.
- `src/vs/workbench/services/layout/test/browser/layoutService.test.ts`.
- `build/lib/test/copilot.test.ts` and `build/lib/test/hygiene.test.ts` through the build test runner.
- Tabs desktop `nativeCodeHostContract.test.ts`, `nativeCodeHostCommand.test.ts`, `nativeCodeHostZip.test.ts`, `nativeCodeHostOpen.test.ts`, `nativeCodeHostUrl.test.ts`, `nativeCodeHostActivity.test.ts`, `nativeCodeHostStorage.test.ts`, `nativeCodeHostShutdown.test.ts`, `codeHostManager.test.ts`, `codeControlChannel.test.ts`, `codeThemeDerivation.test.ts` and `desktopTheme.test.ts`.
- Tabs web `components/code/CodeChrome.browser.tsx`, `CodeActivityRail.logic.test.ts`, `components/codeHost.logic.test.ts`, and `nativeSurfaceOverlay.test.ts` using their actual package/browser configs.

These are a minimum map; include other affected tests found during inspection. Use small focused runs after each conflict cluster. Do not add trivial tests that only repeat implementation strings or replace real integration with stubs.

Within `tabs-app`, use its frozen Bun install and run:

```sh
bun install --frozen-lockfile
vp check
vp run typecheck
vp test
vp run test
bun run test:desktop-smoke
bun run test:code-oss
```

Inspect current scripts/configs; record what each gate actually covers. The last command builds the shell, runs the real native adapter check, and runs the visible embedded workbench gate. A bare Code-OSS `npm test` is intentionally not the correct unit-test command.

Run heavyweight compile/packaging/Electron gates sequentially. Prior concurrent runs hit shutdown/reconnect contention. Do not hide a failure by arbitrarily raising timeouts, skipping suites, removing assertions, changing expected runtime paths to stale builds, or marking tests passed from inspection. Reproduce and fix the earliest causal failure; record resource-related reruns with evidence.

Run vendored hygiene against actual changed files without staging them. An empty-index precommit scan does not prove uncommitted files passed. Also run the required full hygiene gate, explaining any baseline or third-party exclusions without broadening them to suppress errors.

## 9. Validate the real desktop and user-visible behavior

Before every launch inspect narrowly scoped processes, for example:

```sh
ps -axo pid,ppid,command | rg 'tabs-dev-root|dist-electron/main\.js|apps/server/dist|Tabs\.app/Contents/MacOS/Tabs'
```

Inspect ownership and actual executable paths. Do not count your inspection command as an app instance. Keep at most one Tabs test/dev instance alive. Gracefully stop only task-owned processes and confirm exit before another launch. If a user's Tabs instance is running, ask them to close it; never kill it or silently launch a second instance. Do not use broad electron/node/bun kill patterns.

Launch interactive development from `tabs-app` with `bun run dev:desktop`, explicitly pointing `TABS_CODE_OSS_BUILD_DIR` to the implementation worktree's freshly built runtime. Use isolated `TABS_HOME`, `TABS_DESKTOP_USER_DATA_DIR`, and nonconflicting ports as supported by the actual scripts. Verify those values reach the child process. A web browser/Vite URL or stock standalone Code-OSS launch cannot substitute for Tabs desktop acceptance.

Use the existing dedicated smoke entrypoints for their intended real-Electron source/artifact gates. Capture structured results and screenshots, and prove:

1. Selected source runtime path is the isolated worktree, version is exactly 1.145.0, backend `available` is true, and embedded mode is active. Independently assert 1.145.0; the existing smoke derives expected version from runtime metadata and alone could accept a stale build.
2. A real project is registered, the Code session is ensured and activated with visible bounds, and a native Code workbench target renders.
3. Opening/editing/saving a real file works, including spaces, literal percent escapes, `?` and `#` in filenames where the platform permits them.
4. A real PTY terminal executes a command with a verified filesystem result; search, SCM and debug paths function.
5. Extension installation/activation and a real extension webview work, including resource/worker/WASM loading, cancellation, pane recreation and disposal.
6. Project switching, session restoration, sidebar placement, Chat/Claude/Codex containers and managed-update transitions remain correct.
7. Integrated browser navigation and session isolation work; protocol/network/popup failure paths remain deliberate.
8. Command palette, native context menus, clipboard, dialogs, notifications, DND and per-source filters route correctly across projects/tools.
9. Native views stay hidden under dialogs, dropdowns, Notification History and quit confirmation; Cancel restores the same loaded page, and late activation/resize cannot reveal it behind a modal.
10. Theme/card/rail seams, connected tabs, editor picker, virtualized tree scrolling/renaming/dragging and split/sidebar geometry remain correct in dark/light/custom/high-contrast, reduced motion and zoom/font settings. Keyboard navigation and Escape dismissal work.
11. Auth callback routing retains project/window ownership. Real GitHub/Copilot/Claude/Codex account acceptance requires actual authorized credentials; do not invent access or call mocked callbacks a real login.
12. Quit from Code and other native-view tools, including Relay where available, handles Cancel and complete shutdown without reattachment or orphaned processes.

Record each scenario as passed, failed, blocked or not run, with its evidence. Do not claim Windows/Linux/DPI or real-account validation from macOS tests. Keep inherited limitations visible.

## 10. Build and cold-start a self-contained local artifact

Inspect `tabs-app/scripts/build-desktop-artifact.ts` and the packaging/release workflows. Build one artifact for the host architecture, explicitly selecting the newly built runtime. For Apple Silicon macOS, from `tabs-app`:

```sh
TABS_CODE_OSS_BUILD_DIR="<absolute implementation worktree>/tabs-code-oss" bun run dist:desktop:dmg:arm64
```

Use the existing x64/Linux/Windows equivalent only when appropriate. Do not pass `--thin`, set `TABS_DESKTOP_THIN=true`, or enable remote-runtime download fallback. Do not assign a new public Tabs version or publish this artifact.

Inspect the artifact itself, not just the staging directory:

- `Contents/Resources/tabs-code-oss` contains package version 1.145.0, product metadata, localization, fresh preload/workbench/Sessions output, compiled Tabs CSS/contributions, all required production extension entrypoints, and production dependencies.
- Preserve Copilot production-scope runtime modules (`dotenv`, `source-map-support`), required provider assets and existing packaging exclusions. Review target packaging tests rather than assuming the older dependency shape still applies.
- Native modules load under the packaged Electron executable and architecture. Exercise the project's required native package set, including node-pty, watcher, sqlite3, spdlog, native-keymap and fs-copyfile where present. Do not call a Node-only load probe an Electron ABI check.
- Count actual extension manifests separately from shared node_modules directories; verify declared desktop entrypoints exist.
- Record artifact path, size, checksum and source/runtime identity.

Mount the DMG read-only at an isolated mountpoint or extract the local app. Run the existing packaged workbench gate using the actual mounted path:

```sh
EVIDENCE_DIR="<absolute evidence directory>/packaged-workbench" bun --cwd=apps/desktop run test:code-oss-workbench --app="<actual mount path>/Tabs.app"
```

Packaged mode must use the artifact runtime with the development override removed. Independently assert 1.145.0 and verify selected paths lie in that artifact. Require actual backend startup, visible workbench, real file, active Tabs stylesheet and real terminal command. Record cold-start timing for embedded readiness separately from outer-window readiness. Repeat essential webview/browser/extension behavior against the package as needed to close packaging risks.

If multiple artifacts are built, test each or compare the exact application/runtime payload bytes and disclose what was and was not launched. Do not assume a ZIP and DMG match because names/versions match. Stop the owned app, confirm its process tree exits, and eject only the task-owned mount. Do not replace the installed application.

## 11. Update documentation and hand off for independent review

Update `code-oss-parity.md`, `CODE_OSS_PRODUCTION_READINESS_AUDIT.md`, and `.agents/skills/tabs-vscode-sync-babysitter/references/fork-inventory.md` for the actual target and reviewed patch set. Add a concise 1.145 upgrade/validation report with structured evidence where appropriate. Preserve historical reports as historical; do not rewrite past failures as passes.

Final handoff must contain:

1. Baseline and target versions/full upstream SHAs; implementation branch, base SHA and absolute worktree path.
2. Source provenance and pristine/fork comparison method, including LFS/modes/symlinks and upstream deletions.
3. Complete fork disposition and semantic-conflict resolutions. Explain retired/replaced patches and evidence of equivalent behavior.
4. Native-host method/signature/payload/result matrix; ZIP skipped-file behavior; constructor/service, browser/network, protocol, PTY and Agent Host audit results.
5. Exact commands, working directories, exit codes and result summaries, with evidence paths. Separate unit/mocked checks, real Electron source checks, packaged checks, account checks and other-platform checks.
6. Source name-status/diff statistics, new/untracked file list and focused compatibility diff. Do not bury Tabs adapter changes in thousands of upstream files.
7. Artifact path/checksum, actual runtime selection/version, packaged native ABI results and cold-start/workbench evidence.
8. Remaining failures, blockers, skipped/not-run scenarios and inherited limitations. Distinguish implemented, tested, unverified and blocked.
9. Final process and Git status. Confirm task-owned processes and mounts are gone; user-owned instances were untouched. Confirm no staging/commits/push/PR/publication/application replacement occurred.

Do not call this production-ready or complete while a required build/native/workbench/package gate fails or is skipped. If blocked, preserve the reviewable work and report the exact blocker, earliest causal evidence and next action. Never manufacture success to satisfy the checklist.

## Appendix: observed fork files to inspect, not an automatic replay allowlist

Paths below are relative to `tabs-code-oss/`. `A` means a tracked Tabs addition compared with pristine 1.143; `M` means modified. `OVERLAP` means the same path also changes between upstream 1.143 and 1.145. Classification and semantic review remain required.

```text
A         TABS_ARCHITECTURE.md
A         build/gulpfile.compile.ts
M         build/hygiene.ts
M OVERLAP build/lib/i18n.resources.json
M OVERLAP build/lib/stylelint/vscode-known-variables.json
M         build/lib/test/copilot.test.ts
M         build/lib/test/hygiene.test.ts
A         build/npm/patchNativeGyp.ts
M OVERLAP build/npm/postinstall.ts
M OVERLAP extensions/copilot/package-lock.json
M OVERLAP extensions/copilot/package.json
M OVERLAP package.json
M         src/vs/base/browser/ui/list/list.css
M         src/vs/base/parts/contextmenu/electron-main/contextmenu.ts
M         src/vs/base/parts/sandbox/electron-browser/preload.ts
M         src/vs/code/browser/workbench/workbench.ts
M         src/vs/code/electron-browser/workbench/workbench.ts
M         src/vs/editor/browser/controller/editContext/native/nativeEditContextUtils.ts
M         src/vs/editor/browser/services/abstractCodeEditorService.ts
M         src/vs/platform/agentHost/test/node/codex/codexProviderConfiguration.test.ts
M         src/vs/platform/extensionManagement/node/extensionSignatureVerificationService.ts
M         src/vs/platform/terminal/common/requestStore.ts
M         src/vs/platform/terminal/test/common/requestStore.test.ts
M         src/vs/platform/utilityProcess/electron-main/utilityProcess.ts
M OVERLAP src/vs/sessions/electron-browser/sessions.main.ts
M         src/vs/workbench/browser/layout.ts
M OVERLAP src/vs/workbench/browser/parts/activitybar/media/activityaction.css
M         src/vs/workbench/browser/parts/auxiliarybar/auxiliaryBarPart.ts
M OVERLAP src/vs/workbench/browser/parts/editor/breadcrumbsControl.ts
M OVERLAP src/vs/workbench/browser/parts/editor/editorGroupWatermark.ts
M OVERLAP src/vs/workbench/browser/parts/editor/media/breadcrumbscontrol.css
M OVERLAP src/vs/workbench/browser/parts/editor/media/editorgroupview.css
A         src/vs/workbench/browser/parts/editor/media/tabs-logo.svg
A         src/vs/workbench/browser/tabsEmbeddedLayout.ts
M         src/vs/workbench/browser/workbench.ts
M         src/vs/workbench/contrib/chat/browser/chatParticipant.contribution.ts
M         src/vs/workbench/contrib/debug/browser/breakpointsView.ts
M         src/vs/workbench/contrib/debug/browser/callStackView.ts
M         src/vs/workbench/contrib/debug/browser/loadedScriptsView.ts
M         src/vs/workbench/contrib/debug/browser/variablesView.ts
M         src/vs/workbench/contrib/debug/browser/watchExpressionsView.ts
M         src/vs/workbench/contrib/extensions/browser/extensionsIcons.ts
M OVERLAP src/vs/workbench/contrib/files/browser/views/explorerViewer.ts
M         src/vs/workbench/contrib/files/browser/views/openEditorsView.ts
M         src/vs/workbench/contrib/scm/browser/scmInput.ts
M         src/vs/workbench/contrib/scm/browser/scmViewPane.ts
M         src/vs/workbench/contrib/search/browser/searchResultsView.ts
A         src/vs/workbench/contrib/tabs/browser/commitDraftMenu.ts
A         src/vs/workbench/contrib/tabs/browser/media/embeddedWorkbench.css
A         src/vs/workbench/contrib/tabs/browser/media/tabs.css
A         src/vs/workbench/contrib/tabs/browser/railPresentation.ts
A         src/vs/workbench/contrib/tabs/browser/tabs.contribution.ts
A         src/vs/workbench/contrib/tabs/test/browser/tabs.contribution.test.ts
M         src/vs/workbench/contrib/webview/browser/overlayWebview.ts
M         src/vs/workbench/contrib/webview/test/browser/overlayWebview.test.ts
M         src/vs/workbench/contrib/webviewView/browser/webviewViewPane.ts
M         src/vs/workbench/contrib/webviewView/test/browser/webviewViewPane.test.ts
M OVERLAP src/vs/workbench/electron-browser/desktop.main.ts
M         src/vs/workbench/services/layout/browser/layoutService.ts
M         src/vs/workbench/services/layout/test/browser/layoutService.test.ts
M         src/vs/workbench/services/notification/common/notificationService.ts
A         src/vs/workbench/test/browser/tabsEmbeddedLayout.test.ts
A         src/vs/workbench/test/browser/tabsRailPresentation.test.ts
M OVERLAP src/vs/workbench/workbench.common.main.ts
```
