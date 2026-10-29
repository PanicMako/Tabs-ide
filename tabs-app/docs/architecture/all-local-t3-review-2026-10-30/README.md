# Combined local review checkout

This local branch combines the published Tabs 2.1.0 baseline, the independently repaired T3 parity implementation, and the original checkout's nonignored local changes. It is a separate review candidate; validation of the narrower remote installer branch does not certify this larger source tree.

- Review branch: `codex/all-local-t3-review`.
- Review checkout: `/Users/rushil.dev/.codex/worktrees/all-local-t3-review/tabs`.
- Current-release/T3 parent: `8797d1aec` (its separate installer-run source is `b41e1233981e612e79d932f3a85552acf2eb0e7b`).
- Exact original-local snapshot parent: `f48381d4af3ed99f13c607b6e764d37d8554b79a`, also reachable as `codex/local-working-files-snapshot-20261029`.
- Original checkout: `/Users/rushil.dev/Desktop/tabs`, preserved in place. Its source/index were not reset, stashed, or switched.

The capture contains 346 tracked changes and 486 nonignored untracked files (832 paths). Ignored dependencies and generated build outputs are excluded. `original-local-snapshot.json` records the capture and exact tree. The reconciliation manifest records each captured path against the review tree; files merged with current production/T3 changes intentionally need not be byte-identical to the old local copy. Keeping the snapshot as a merge parent preserves the exact original content for inspection.

## Merge choices

Current Code OSS 1.143 lifecycle and release fixes remain. Local card/list/breadcrumb geometry, rail presentation, commit drafting, recovery bridge, icon artwork, Dock workspace, settings/typography/branding, DeepSeek provider additions and provider workspace snapshots are retained. T3 history/body recovery, repository identity, shared checkout selectors, script discovery, strict PR readiness, agent lineage and automation authorization remain the audited implementations. Local expansion preferences are carried into those implementations, scoped by environment and thread. The local workspace action rail supports a portal while retaining pane-bound density, Escape and focus restoration.

The compact local provider instructions remain below the native per-entry limit. Their catalog guidance is corrected to match full-catalog no-argument compatibility, and the launch retry/checkout guidance remains explicit. Context-byte ratchets are measured separately for this combined tree; they are not provider token/billing or model-quality claims.

Historical Antigravity audit reports remain historical evidence. Their test counts/readiness claims do not certify the combined checkout.

## Inspect and run

Open the review checkout in your editor. It is already on `codex/all-local-t3-review`; the snapshot branch provides the exact old local state for comparison. To run a separate local development profile:

```bash
cd /Users/rushil.dev/.codex/worktrees/all-local-t3-review/tabs/tabs-app
TABS_DESKTOP_USER_DATA_DIR=/Users/rushil.dev/.tabs-all-local-t3-review/desktop-profile \
  bun run dev:desktop --home-dir /Users/rushil.dev/.tabs-all-local-t3-review
```

The development runner chooses available ports. Code OSS source compilation is a separate prerequisite for the embedded editor. This checkout now has compiled native client and localization assets. Those build products are ignored by Git; another checkout needs its own build setup.

No release, tag, main merge, production deployment, or push of this review branch is authorized or performed. Installer monitoring is handed to Antigravity separately.

## Verification

The combined checkout passed the full workspace suite: 18 tasks; web 237 files / 1,808 tests; server 648 files / 7,621 tests (35 skipped). The desktop suite passed 83 files / 710 tests and shared passed 92 files / 1,207 tests. The desktop/server/web production build passed all 4 tasks. The native client build completed, and focused Tabs contribution, embedded list geometry, rail presentation and breadcrumb tests passed 43 tests. Native staged-file hygiene passed on 23 files. The core Chromium workspace matrix passed 45 distinct tests across header/rail, branch selectors, agents, automations, project scripts and PR readiness. These are automated coverage results, not an assertion of exhaustive platform or provider certification.

Provider context budgets in this combined tree are 4,374 Claude append bytes / 6,445 Codex context bytes; the registry budget remains 73,547 input-descriptor bytes / 171,228 full-descriptor bytes. The committed budget test passed against the actual registered tools. The compact shared orchestration instruction entry is 2,974 bytes and retains the native entry limit.

The isolated development workbench smoke passed against Code OSS 1.143.0: native backend available, real file opened, integrated terminal opened, and a real terminal command executed. It used a temporary profile/project, which the harness removed afterward. This validates the tested local host; it does not replace packaged Windows/Linux/macOS acceptance or test every extension/provider.

Final workspace typechecks passed all 16 tasks. `vp check` passed with zero errors and 676 existing warnings. Native compile-build completed with zero compilation errors and produced genuine localization data.

A further Chromium matrix for the local Code chrome/radii, brand and extension settings, theme/heading collections, Dock and top bar passed 8 files / 65 tests. Together with the core workspace matrix, 110 distinct browser tests passed. Radius assertions were reconciled with the selected native geometry tokens; persistence fixtures reset their local state between tests.

## Limits and release separation

The Code OSS native file-copy binding was rebuilt for the desktop's actual Electron 44.1.0 arm64 runtime and its asynchronous copy operation passed. Three fresh isolated workbench smoke runs passed after rebuilding it, including two sequential final runs whose compact results are committed here. One earlier intermediate run timed out in a DevTools evaluation; its cause was not isolated or proven fixed. The harness now reports a bounded timeout with the failing expression snippet. The repeat results are evidence of successful local launches, not a guarantee that startup can never time out.

The full built-in-extension artifact installation/compilation step and packaged Windows/Linux/macOS acceptance are not certified for this combined branch. Those remain installer-pipeline checks. The separate Antigravity handoff monitors source `b41e1233981e612e79d932f3a85552acf2eb0e7b`; it does not automatically certify these additional local changes. This branch is ready for local review, not an approval to release its larger combined tree.
