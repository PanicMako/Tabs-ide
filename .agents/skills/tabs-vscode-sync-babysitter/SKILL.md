---
name: tabs-vscode-sync-babysitter
description: Safely update Tabs' vendored Code-OSS runtime to a reviewed Microsoft VS Code revision while preserving and validating the Tabs-specific fork and Electron integration. Use when asked to pull, sync, upgrade, or babysit an upstream VS Code update for Tabs.
---

# Tabs VS Code Sync Babysitter

Work from the monorepo root containing `vscode-main/`, `tabs-code-oss/`, and `tabs-app/`. The outcome is a reviewable upstream refresh that preserves Tabs' deliberate fork patches and passes the native desktop integration gates—not merely matching a newer version number.

## Safety and authorization

- Inspect `git status --short --branch` first. Never update from a dirty checkout or overwrite unrelated work. If tracked edits exist, stop and ask the user to commit or otherwise isolate them; never stash, reset, clean, commit, or push without explicit authorization.
- Resolve the exact Microsoft VS Code tag or commit before changing files. Prefer a stable release tag unless the user explicitly requests Insiders or a commit.
- Do not merge Microsoft VS Code Git history into the Tabs monorepo. `vscode-main/` is the pristine comparison snapshot and `tabs-code-oss/` is the patched runtime inside one repository.
- Never use an unreviewed recursive copy with deletion against `tabs-code-oss/`. Preserve generated/built artifacts only when required by the established build; do not treat them as source customizations.
- Do not change Tabs dependency versions merely to accommodate upstream unless the user authorizes that expansion.

## Before updating

1. Read `tabs-app/docs/code-oss-parity.md`, `tabs-app/docs/CODE_OSS_PRODUCTION_READINESS_AUDIT.md`, `tabs-app/AGENTS.md`, and this skill's [fork inventory](references/fork-inventory.md).
2. Record the current versions and baseline:
   - `vscode-main/package.json` and `tabs-code-oss/package.json` versions;
   - current branch and HEAD;
   - `git log --oneline -- tabs-code-oss` since the latest `chore update Code OSS` commit;
   - the name-status delta between `vscode-main/` and `tabs-code-oss/`, excluding `node_modules/`, `out/`, `out-build/`, and compiled extension `dist/` output.
3. Export the current deliberate fork delta into a workspace-local temporary directory. Review it; do not assume every difference is intentional. The inventory is a minimum preservation set, not permission to carry arbitrary drift forever.
4. Fetch the requested upstream revision into a disposable workspace-local clone or archive. Verify its commit/tag and version. Do not replace either tracked tree yet.

## Update and replay

1. Create a dedicated branch named `chore/sync-vscode-<version>` unless the user supplied a branch.
2. Refresh `vscode-main/` to the exact pristine upstream tree, excluding upstream `.git` metadata.
3. Refresh `tabs-code-oss/` from that same tree, then replay only the reviewed Tabs fork delta. Resolve semantic conflicts against the new upstream implementation rather than blindly accepting old hunks.
4. Preserve Tabs-owned additions such as `TABS_ARCHITECTURE.md`, the `vs/workbench/contrib/tabs/` contribution, Tabs branding, and their tests. Reassess modifications to upstream files one by one.
5. Update `tabs-app/docs/code-oss-parity.md`, the production-readiness audit, and the fork inventory whenever the compatibility surface changes.
6. Show the user the resulting name-status and diff statistics before any commit or push. Stage only exact reviewed files if the user authorized committing.

## Conflict review priorities

Review these boundaries before ordinary UI conflicts:

- Electron preload/bootstrap, IPC channels, native host, utility process, PTY, filesystem, URL/auth callback, webview, context menu, archive, and notification contracts;
- workbench registration, Tabs contribution startup, activity/auxiliary bar ownership, assistant view registration, settings/profile persistence, and extension signature/install behavior;
- package/runtime metadata and production extension inclusion rules;
- outer React shell integration in `tabs-app/apps/desktop` and `tabs-app/apps/web`, especially `codeHostManager.ts`, `nativeCodeHostMain.ts`, browser hosting, overlay visibility, and the bundled `tabs-workbench-integration` extension.

New or changed Code-OSS native-host methods are a compatibility event: compare upstream interfaces and call sites with Tabs' explicit implementation/no-op/rejection policy and add coverage before proceeding.

## Validation

Run the narrowest checks after each conflict cluster, then all required gates:

1. In `tabs-code-oss/`, use its checked-in Node/npm toolchain as required by upstream: install from the lockfile, compile core assets (`out/vs/base/parts/sandbox/electron-browser/preload.js`, `out/vs/code/electron-browser/workbench/workbench-dev.html`, `out-build/nls.messages.json`, `product.json`), run client typecheck, and run focused tests for every preserved or changed fork patch. Build production extensions (`compile-extensions-build` and the Copilot extension build) before packaging.
2. In `tabs-app/`, use Bun/Vite+ only: focused regression tests, `vp check`, `vp run typecheck`, `vp test`, and `bun run test:desktop-smoke`.
3. Launch only with `bun run dev:desktop`. Before launch, verify no existing Tabs instance with the repository's prescribed narrow process check. Never launch the plain web dev server as a substitute. Verify that the local Code-OSS desktop renderer resolves cleanly from `../tabs-code-oss` without triggering runtime errors or remote download attempts.
4. Exercise the full checklist in `docs/code-oss-parity.md`, with special attention to project switching, Explorer writes, Git/terminal/search/debug, extension install and activation, notifications over Code/Browser/Testing, assistant rail/secondary-sidebar placement, authentication callbacks, and native menus/dialogs.
5. Run one platform-appropriate desktop artifact build when the update affects packaging or runtime files. Inspect the packaged runtime inside `Resources/tabs-code-oss` (verifying it is a self-contained fat build, not thin) and perform a cold-start smoke test.

## Failure handling and stopping conditions

- Fix the earliest causal compile/test/runtime failure; do not weaken assertions or disable upstream functionality just to finish the sync.
- If a conflict expands beyond the documented fork surface, pause and report the new files, upstream change, and proposed Tabs behavior before resolving it.
- If an extension requires a newer runtime API, update the runtime rather than bypassing compatibility checks.
- Do not declare success with skipped required tests, a missing production extension build, an unverified native-host contract change, or an orphaned desktop process.

Return the old and new VS Code versions/commits, preserved and changed fork patches, conflicts resolved, validations and desktop scenarios run, remaining limitations, branch/commit state, and confirmation that no Tabs process remains.
