# Follow-up reconciliation, 2026-11-01

The active checkout remains `codex/unified-local-2026-10-30` in the usual Desktop folder. Rechecking every previously captured path in the other dirty worktrees found no changes since capture (Git blob hashes were compared, allowing Git's CRLF normalization). Their source files and indexes were not modified.

## Recovered behavior

The older parity-goal worktree contains a Grok quota fix absent from the candidate: an active billing period with an omitted usage percentage now produces a zero-percent quota window. Its regression case was merged into the current provider tests. The existing error handling and all current provider code remain in place. The focused Grok and usage suites pass 57 tests.

The usage cache suite had a calendar-dependent failure: the August 1 fixture eventually falls outside the production 90-day retention policy. The affected test now uses the existing TestClock support with a fixed August 2 clock. Production retention behavior is unchanged. All 24 usage service tests pass.

## Older alternatives kept in recovery

| Snapshot suffix | Decision and evidence |
| --- | --- |
| 04, Git redesign | Current `GitToolV2.tsx` already contains the section headings and account host/auth-login mapping. The candidate also has staging controls absent from the old OverviewPanel, theme radius tokens absent from the old CSS, and native thinking-model support absent from the old FusedModelPicker. Preserve the preview and old picker as alternatives. |
| 07, release consolidation | 274 changed files are exact matches. Remaining differences are old handoff text and contracts under `src.backup`, rather than active contract definitions. Preserve these historical versions. |
| 08, production candidate | The handoff file is already exact. |
| 09, parity repairs | Current tool-use harness additionally recognizes failed tool status; the local report is older (16:22 versus 16:38) and lacks the candidate context-budget reference. Preserve the older evidence instead of replacing newer evidence. |
| 11 and 14, Exchange and extensions | Keep the current release/T3 implementations, tested by the active Exchange and desktop suites. Older versions include earlier account/publisher copy, layouts, scripts, extension APIs, and runtime interfaces. The path renames from `tabs-main` have already occurred in the active code. These full older variants remain archived; exhaustive feature-by-feature equivalence has not been established. |
| 13, extension lifecycle | Current `ExtensionViewManager` has activation-scoped crash handling, cancellation and crash rejection during load, beyond the old onViewFailure callback. Current `opencodeRuntime.ts` tracks server groups through `OpenCodeServerLedger`, which checks process identity/start time and handles dead owners on restart; do not add the older PID-only shell watchdog alongside it. The current dev runner already has local-provider matching and worktree directory checks. |
| 21, Code OSS 1.140 | Keep the current 1.143 build pipeline, which includes localization-aware bundling. The old gulp implementation remains archived. |
| 23, Code OSS 1.143/typography | Keep the newer brand/typography collections and radius tokens. The older setup variant switches the brand from Aicon to Ransom and increases heading sizes; additional font assets and legibility probes are preserved as experiments, not silently selected as the current brand. |
| 26, earlier parity goal | Grok quota fix recovered above. Much of the old implementation predates the current audited provider/workspace/schema changes. A proposed package merge only duplicates `@tufjs/models` in devDependencies (it is already a production dependency), so that duplicate was not added. Backup contracts and Git preview sources remain preserved. Exhaustive feature-by-feature equivalence for this large historical variant remains unproven. |
| 29, updater | Keep the existing v1.3.16 release copy; the alternate historical release wording is preserved without changing current release/version metadata. |

Preservation is complete for the captured dirty worktree files. This table records integration decisions and limits; it does not claim all old versions can run simultaneously or that all historically intended features have been verified. In particular, the large Exchange and earlier parity variants remain available for any further feature-specific audit.

## Local editor setup repaired

The installed Code OSS dependencies were stale relative to the source. `npm install --ignore-scripts --no-audit --no-fund` refreshed them without changing tracked package or lock files. The localization-aware native build passed with zero compile errors. The separate `gulp compile-client` development build then populated `out/`, resolving the missing `out/vs/base/common/errors.js` failure.

The isolated workbench smoke passed: Code OSS 1.143.0 backend available, real file opened, Tabs radius CSS present, integrated terminal opened, and a real terminal command executed. Its temporary profile was removed by the harness. Evidence is under `/Users/rushil.dev/.codex/recovery/tabs-20261030/smoke-fixed/`.

A broader `npm run compile-client` invocation (which also compiles built-in extension media) encountered the missing `@vscode/web-editors` dependency in the markdown extension. The successful core/development editor builds and smoke do not certify built-in extension packaging or packaged cross-platform releases.

## Final verification

- Full workspace suite: `bunx turbo run test --concurrency=1` passed all 18 tasks. Server: 648 test files passed, 11 skipped; 7,621 tests passed, 35 skipped. The earlier browser teardown timeout did not recur with serialized package execution.
- `vp check`: passed, zero errors and 677 existing warnings.
- `vp run typecheck`: passed all 16 tasks.
- `bun run build:desktop`: passed all four tasks.
- Code OSS `compile-build-without-mangling` and `compile-client` gulp tasks: passed.
- Isolated native workbench smoke: passed, including actual file contents, radius CSS and a terminal command.
- `git diff --check`: passed. Repository precommit hook ran during commits; there were no changed native Code OSS source files for it to check.

Logs and isolated smoke evidence are retained outside the repository at `/Users/rushil.dev/.codex/recovery/tabs-20261030/`. No local user profile was reset, no stash was altered, and no push or release was performed.
