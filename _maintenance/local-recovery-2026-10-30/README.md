# Unified local checkout and recovery inventory

## Run the active candidate

The usual folder `/Users/rushil.dev/Desktop/tabs` now uses `codex/unified-local-2026-10-30`.

```sh
cd /Users/rushil.dev/Desktop/tabs/tabs-app
bun run dev:desktop
```

The previous launch used `codex/startup-release-review`. The combined T3/release/local review was in `/Users/rushil.dev/.codex/worktrees/all-local-t3-review/tabs` on `codex/all-local-t3-review` (`bbb9561f9`). Running from the usual folder did not select that separate checkout. The earlier chat is titled "Audit T3 parity implementation".

## Active source

The candidate combines `bbb9561f9` with the exact current usual-folder snapshot `82d3a5151`, using the original local snapshot `f48381d4a` as the three-way merge base. This merge completed without conflicts. The current usual-folder snapshot differed from that original snapshot in five files: TabHop.astro, CommitDraftSettings.tsx, DataRecoverySettings.tsx, diagnostics.css, and radii.css. All five newer versions are included alongside the release and T3 integration.

The three later packaging fixes from the CI babysitting branch are applied: compiled test-fixture pruning, removal of direct mounted-DMG codesign verification, and removal of hide_extensions plus extended-attribute clearing in macOS smoke. The command-bar sizing was left alone.

## Preservation is distinct from active integration

All 12 dirty worktrees were captured without changing their source files or indexes. `inventory.json` records their heads, exact snapshot commits, paths, deleted paths, and archive checksums. Each tarball contains complete copies of that worktree's changed files, including nonignored untracked files; every captured nondeleted path was checked against its archive. Ignored dependencies, build products, and local environment files are excluded. The usual-folder original index is additionally backed up outside the repository at `/Users/rushil.dev/.codex/recovery/tabs-20261030/original-usual-folder.index`.

The archives are recovery copies, not additional application source directories. Some older variants conflict with newer implementations; these variants have NOT all been integrated as active behavior. `comparison.json` records an initial per-file three-way comparison against the candidate. An exact match or an already-integrated result is stronger evidence than a clean textual merge; a conflict requires semantic review. A clean textual merge alone does not establish that old behavior should be restored. Do not interpret the archived variants as tested features in the application.

Examples include an older Git toolbar without current account/status controls, older theme settings without the current typography/brand collections, and Exchange UI files preceding the newer copy and layout changes. The old OpenCode watchdog variant, extra setup font assets, Git redesign preview, historical audit evidence and backup contracts are preserved for further review rather than silently replacing the current code. Finishing semantic reconciliation of all differing older variants is still outstanding.

`branches.txt` records all local branch tips at capture time. Existing branches remain available. Historical branches and demo branches were not blindly merged into the active tree. The existing `version-bump-1.2.122` stash remains unchanged; its patch is included here for recovery, but its obsolete version numbers are not applied.

To inspect a variant, extract its archive into a NEW temporary directory, never directly over the active checkout. Paths in old archives can use `tabs-main/` and `tabs-code-main/`; current names are `tabs-app/` and `tabs-code-oss/`.

No push, tag, deployment, or release was performed. This is a local review candidate with complete dirty-worktree recovery archives, not a certification that every historical variant is integrated or production ready.
