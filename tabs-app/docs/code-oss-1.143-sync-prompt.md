# Copy/paste prompt: update Tabs' embedded Code OSS without committing

You are working on Tabs IDE in `/Users/rushil.dev/Desktop/tabs`. Implement and validate an upstream Code OSS refresh to the latest official stable source release, targeting VS Code **1.143.0** if its official source revision can be verified. This is VS Code/Code OSS 1.143, not version 1.14.3.

## Required workflow and boundaries

Read and apply these files before editing:

- `.agents/skills/tabs-vscode-sync-babysitter/SKILL.md`
- `.agents/skills/tabs-vscode-sync-babysitter/references/fork-inventory.md`
- `tabs-app/AGENTS.md`
- `tabs-app/docs/code-oss-parity.md`
- `tabs-app/docs/CODE_OSS_PRODUCTION_READINESS_AUDIT.md`
- `tabs-code-oss/AGENTS.md` and its referenced contribution instructions

Follow the relevant accessibility, hygiene, unit-test, sessions, and native launch skills when their scope applies. Follow the repository's existing toolchain and packaging workflows.

**Do not stage, commit, amend, cherry-pick, push, create a PR, tag, publish a release, or install/replace an application. Leave the resulting source changes uncommitted for review.** I will decide the commit and publication strategy later.

Do not run destructive Git commands, stash my changes, discard edits, reset a branch, or overwrite unrelated work. The checkout contains substantial uncommitted work. Inspect status, branch, HEAD and attached worktrees first. Do not perform an upstream refresh in that dirty checkout. Use a clean isolated worktree according to the sync skill; if creating a safe baseline requires a commit or a decision about which user edits belong in it, report that precise blocker and ask. Creating an isolated workspace does not authorize committing. Do not silently omit the current fork changes because they are uncommitted. Preserve their complete patch and untracked-file inventory separately before proceeding; include any relevant changes in the isolated implementation only after reviewing them. Never change the original checkout to make isolation easier.

## Establish the actual starting point

This is one monorepo: `tabs-code-oss/` is the patched embedded runtime, `tabs-app/` is the outer application, and `vscode-main/` is the local pristine upstream comparison snapshot. Do not merge Microsoft's Git history into the Tabs monorepo. Inspect whether the comparison snapshot is tracked or ignored; do not assume it exists in a new worktree.

At the last inspection, this development branch was `codex/startup-release-review`; its Code OSS source reported 1.140.0 and its old comparison snapshot reported 1.138.0. The installed `/Applications/Tabs.app` was Tabs 2.0.2 containing Code OSS 1.142.0. The repository's `v2.0.2` tag also contained runtime 1.142.0. Recheck these facts; they explain why the local development About page can disagree with the installed release. Do not replace the current branch with the release tag or assume its uncommitted changes are already present there.

Microsoft's official 1.143 release page is https://code.visualstudio.com/updates/v1_143. During prompt preparation, that page advertised 1.143.0, while GitHub's releases/latest API returned 1.142.0 and the 1.143.0 source-tag lookup returned 404. Re-resolve the official stable tag and full commit SHA before changing either tree. If the source tag is still unavailable, investigate official source references and report the discrepancy. Do not invent a SHA, merely edit package.json, or substitute main/Insiders. If a newer stable release exists, identify it explicitly and pin the chosen release before implementation.

## Preserve the Tabs fork

Re-derive the deliberate fork delta against the correct upstream baseline. Preserve tracked and untracked Tabs additions, binary assets and modes. Do not blindly trust the older inventory, arbitrary tree drift, or compiled output as the source of truth. Review the inventory against the current checkout and release lineage.

Preserve branding, the Tabs workbench contribution, assistant views and auxiliary-sidebar placement, layout preferences, Electron/preload/bootstrap contracts, native-host IPC/RPC, auth callback routing, extension install/signature/packaging behavior, production Copilot dependencies, session persistence, and all relevant fork regression tests.

Recent local work must also survive:

- Hierarchical Code OSS radii in `tabs-code-oss/src/vs/workbench/contrib/tabs/browser/media/tabs.css`: compact details/rows, inset controls, overlays, cards and large dialogs; continuous notification frames; connected buttons and editor text-selection geometry.
- Familiar connected project tabs in the React shell, Labs tool tabs, and onboarding preview; retain lower fillets rather than turning these tabs into pills.
- Native overlay detection for project dropdowns and Notification History.
- Extension tool overlay suspension through bounds visibility, retaining the activation and loaded page; resize or late activation must not reveal it behind an open dialog.
- Main-process native-view suspension for quit confirmation and shutdown, including Relay, restoration on Cancel, and prevention of late native reattachment.
- Typography editing dialogs, multiple saved mixes, and animation Auto theme/scaling fixes.

Export the reviewed fork delta first. Fetch the pinned upstream source into a disposable workspace-local directory. Refresh the pristine comparison and patched runtime through the established sync process, replay the reviewed fork delta semantically, and review upstream deletions explicitly. Never recursively delete-copy over the patched runtime. Update compatibility documentation and the fork inventory.

Prioritize changed native-host methods, Electron contracts, utility processes, PTY/filesystem/archive operations, webviews, authentication, extension packaging and workbench startup. Implement deliberate support/rejection policies for changed APIs; do not hide incompatibility behind broad no-ops, disabled features, weakened tests, or unnecessary dependency changes.

## Build and validate the actual runtime

Use the Code OSS checkout's required Node/npm versions and lockfile inside `tabs-code-oss/`; use Bun/Vite+ inside `tabs-app/`. Check whether equivalent build/watch jobs are already running before starting duplicates.

Run focused validation after each conflict cluster, then all gates required by the sync skill and parity contract: Code OSS compilation/typechecking, localization assets, hygiene, fork tests, production built-in extensions and Copilot bundles; Tabs unit/browser/native integration coverage, `vp check`, `vp run typecheck`, workspace tests and desktop smoke tests. A development compile already type-checks its inputs; avoid repeating an equivalent typecheck without a reason.

Launch the complete desktop integration with `bun run dev:desktop` as prescribed by the sync skill, using isolated user data and ports. Do not touch an existing user process. Explicitly point `TABS_CODE_OSS_BUILD_DIR` at the isolated worktree's newly built `tabs-code-oss`, so a stale sibling or installed runtime cannot win selection. Confirm the selected runtime path and About version. A plain browser render is not native desktop acceptance.

Exercise Code/Agents/Browser/Relay project switching; Explorer edits/save; Git, terminals, search and debug; extension install/activation; assistant views; auth flows; native menus; notifications; dialogs and dropdowns above native views; keyboard focus; dark/light/system themes; and Command-Q from Relay and Code, including Cancel and completed shutdown. Preserve pages on temporary overlay suspension.

Build a platform-appropriate bundled desktop artifact. Inspect its `Resources/tabs-code-oss` metadata, compiled assets, production extensions and actual cold-start behavior. Keep this artifact local; do not install it over `/Applications/Tabs.app` or publish it. Source changes, compiled output, an artifact, and the currently installed app are distinct layers—verify the correct layer rather than declaring success from package.json alone.

## Deliverables

Return the original and target versions/full SHAs, selected runtime paths, preserved fork inventory, semantic conflicts and their resolutions, source diff/name-status summary, actual validation results, artifact location and cold-start evidence, unresolved limitations, and branch/worktree state. Stop task-owned processes. Explicitly confirm **no files were staged or committed, nothing was pushed or published, and the installed app was not replaced**. If a required gate is blocked, report it precisely and do not claim the upgrade is complete.
