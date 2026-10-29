# Antigravity: finish build-only installer CI

Take over monitoring and finishing this non-publishing Tabs installer build. Codex has stopped its watcher. Return your report to the human for Codex's independent review.

## Exact target

- Repository: `PanicMako/Tabs-ide`.
- Approved remote branch: `codex/t3-parity-audit-repairs`.
- Workflow: `.github/workflows/build-desktop.yml` — **Build Desktop Installers**.
- Active run: **40917730391** — https://github.com/PanicMako/Tabs-ide/actions/runs/40917730391.
- Intended build source: **b41e1233981e612e79d932f3a85552acf2eb0e7b**.
- Production base: `3f6cca778d1225080d6247cb63714cca3758d369`, Tabs 2.1.0 / CodeOSS 1.143.0.
- Targets: macOS arm64, macOS x64, Linux x64, Windows x64.

The old Antigravity head `3b1ac6746` and old 2.0.0 audit checkout are historical. Build the current candidate above. It ports the scoped T3 changes onto current production instead of importing the dirty baseline snapshot.

Last observed state: Linux bootstrap preflight and Linux x64 build/packaging verification succeeded; macOS arm64 and Windows x64 were building artifacts; macOS x64 was compiling built-in extensions. Re-read GitHub. This snapshot does not prove the remaining jobs passed.

## Authorization and boundaries

The human authorized pushing the repair branch above and running/retrying **build-only** installer CI, including necessary scoped CI fixes. Production publication is forbidden.

- No main merge/push, release tags, GitHub release creation/replacement/publication, website deployment or production service changes.
- Do not dispatch `release.yml` or `deploy-marketing.yml`.
- Do not push the separate all-local review branch or bundle unrelated local features into this task.
- No force push, reset/clean/stash of another person's changes, weakened assertions, removed gates or invented success.
- Use existing authenticated Git/gh normally. Never read, copy or print credentials.
- Do not cancel unrelated runs or substitute an older artifact because it is green.

## Workspace ownership

Monitoring requires no edits. Do not write to:

- `/Users/rushil.dev/Desktop/tabs` — dirty user checkout.
- `/Users/rushil.dev/.codex/worktrees/t3-parity-repairs/tabs` — historical audit.
- `/Users/rushil.dev/.codex/worktrees/t3-parity-production-candidate/tabs` — Codex candidate/evidence.
- `/Users/rushil.dev/.codex/worktrees/all-local-t3-review/tabs` — combined local review work.

The existing Antigravity checkout `/Users/rushil.dev/Desktop/tabs/.worktrees/t3-parity-antigravity-20261027` was clean at `3b1ac6746`; preserve it. If a deterministic failure needs a fix, fetch the approved remote branch and create a NEW clean Antigravity-owned worktree/branch from its exact latest head. For example use a new timestamped path under `/Users/rushil.dev/Desktop/tabs/.worktrees/` and branch `codex/t3-parity-ci-babysit-20261029`. Check paths/refs first; do not overwrite an existing checkout. No PR is needed.

## Work to completion

1. Verify repository, branch, source SHA and current job conclusions. Follow this run rather than dispatching duplicates. Poll around once per minute; do not run repeated full local builds while Actions compiles.
2. On failure, inspect the failed step's logs and identify the earliest causal error. Separate expected test stderr and warnings from actual failures.
3. Retry failed jobs once for a transient network/runner issue without editing source. For a reproducible defect, make the smallest correct fix in your own worktree, run focused validation, and commit only the exact changed files. Preserve current 2.1.0 identity/runtime and all T3 compatibility fixes.
4. Re-fetch before pushing. Push fixes only by ordinary fast-forward to `codex/t3-parity-audit-repairs`. If the branch advanced, inspect/reconcile; never force it. Dispatch a fresh four-platform build from the new head. An artifact from an older SHA cannot certify changed runtime code.
5. Continue until all four builds, packaging checks and inline installer checks succeed. Verify expected DMG/ZIP, EXE, AppImage, update manifests and blockmaps. Verify assertions proving bundled `tabs-code-oss` exists inside the installers; thin downloader installers are unacceptable.
6. Run the existing packaged-artifact smoke mode after a successful build. Inspect the workflow's supported inputs. Dispatch the same workflow with `artifact_run_id` set to the successful build ID and `smoke_platforms=win-x64,linux-x64,mac`. Check Windows, Linux and both macOS architectures. Do not rebuild merely to smoke-test existing artifacts.
7. Check actual install/launch/backend/upgrade conclusions and artifact metadata for the exact intended source. An upload existing is insufficient. If a genuine credential, signing, permission, runner or external-service blocker prevents completion, report the exact evidence; do not bypass checks or relabel blocked work as passed.

Starting commands:

```sh
gh run view 40917730391 --repo PanicMako/Tabs-ide
gh run watch 40917730391 --repo PanicMako/Tabs-ide --interval 60 --exit-status
```

For a fresh build after a verified fix:

```sh
gh workflow run build-desktop.yml --repo PanicMako/Tabs-ide --ref codex/t3-parity-audit-repairs -f platforms=mac-arm64,mac-x64,linux-x64,win-x64
```

For artifact smoke, replace the placeholder with the actual successful build ID:

```sh
gh workflow run build-desktop.yml --repo PanicMako/Tabs-ide --ref codex/t3-parity-audit-repairs -f artifact_run_id=SUCCESSFUL_BUILD_RUN_ID -f smoke_platforms=win-x64,linux-x64,mac
```

Do not run a literal placeholder. Verify the smoke run's workflow revision and artifact source.

## Report back

Return:

- Final tested source SHA and approved branch head; any changes after the tested SHA.
- Build and smoke run URLs/IDs, with actual conclusions for all four targets.
- Artifact names, sizes, availability/expiry and bundled-CodeOSS/update-metadata evidence.
- Each fix's root cause, changed files, commit, focused commands/results and containing build.
- Exact remaining blockers or unverified checks, separate from passing work.
- Confirmation that no main merge, tag, release or production deployment occurred and user/Codex working trees were untouched.

Stop after this build-only scope and give the report to the human. Do not expand into publication or website deployment.
