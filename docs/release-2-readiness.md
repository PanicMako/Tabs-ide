# Tabs 2.0 release verification

This record supersedes historical parity completion summaries. A passing local check does not establish that an installer has been published or that production has updated.

## Implemented and checked locally

- The persistence startup guard rejects unknown migration histories while preserving the explicitly supported published V2 preview and known legacy histories repaired by migration 58. The actual file-backed startup regression verifies import progress survives the preview upgrade.
- Historical audit snapshots and the old contract backup tree remain preserved, but are excluded from active test discovery. The archive README identifies the historical status; its test-shaped source snapshots are not executable regressions.
- Labs exposes Settings page only beneath Interface Study. Its appearance and overlays stay within Settings, and the workspace retains its saved palette and layout. Browser coverage checks independent light/dark styling, persistence, restoration and popup containment.
- New Codex drafts replace an unavailable built-in model seed with a model from the ready live catalog. Existing conversations and explicitly configured custom models keep their selection.
- Extension examples and generated starters declare compatibility with Tabs 2.0. Existing signed packages are not rewritten or granted broader compatibility automatically.

## Fresh verification evidence

- Full workspace test command: 18 successful tasks. Server: 636 passed files, 11 skipped; 7,523 passed tests, 35 skipped. Opt-in integration suites remain opt-in.
- Following the final model-selection change, the entire web suite passed: 219 files, 1,655 tests.
- Database compatibility, preview migration, legacy cutover and triage: 15 focused tests passed.
- Settings, scheduling and shared overlay browser checks: nine tests passed in Chromium.
- Extension packaging: 16 tests passed, including starter packages for both 1.x and 2.0.
- All 16 workspace typechecks passed. Workspace formatting/lint checking passed with existing warnings.
- Desktop/backend production build passed.
- Real Electron queue acceptance passed: visible composer scheduling, reorder/edit/cancel/retry, dispatch cancellation race, server delivery with renderer unloaded, new-draft live provider execution, persisted history and pending schedules after restart, and zero orphaned processes after shutdown.
- Real Electron extension sandbox acceptance passed with the desktop package's current version: packaged loading, preload/storage workflow, profile/project isolation, grant revocation, blocked loopback/network/navigation/traversal/cross-package access, and renderer-crash recovery.

The local queue acceptance used an existing compiled Code OSS runtime. Fresh platform installer builds must independently compile and bundle the checked-in runtime before publication.

## Worktree reconciliation

The actual 15 worktrees were inventoried from Git, with private binary-capable patches and untracked-file snapshots before any final update of the normal folder. Earlier reports listing different paths and clean states are superseded by that inventory.

Most parity/runtime changes already match the candidate byte for byte. Remaining older Git, extension and runtime variants are compared against the candidate; they must not overwrite newer account-identity, extension validation, startup recovery or model-picker fixes. Preview HTML/configs, generated performance reports, duplicated contract backups and scratch planning files are not additional product features. Preserve their recovery copies rather than merging them wholesale. Legacy runtime readers retained for migration compatibility are not a second active orchestration engine.

The 252 imported historical audit files match their preserved Codex source copies. They were checked as archived text/structured data, including JSON validity and credential-pattern checks; historical test claims were not treated as fresh results. Five existing parity document changes preserve their word sequence and only alter Markdown formatting. No active application module imports the archive.

## Publication gates still required

- Successful builds of self-contained macOS arm64/x64, Linux x64 and Windows x64 installers from the final candidate, with their artifact verification and installer smoke checks.
- Integrate the verified candidate through the consolidation branch into main, preserving all dirty worktree recovery data.
- Publish v2.0.0 with update metadata, blockmaps and the reviewed manual release notes.
- Verify the production website, changelog and download links against the published release; deploy the committed Exchange application projection and verify health and authentication routing.
- Update the normal checkout to main explicitly, accounting for its target/main upstream and preserved uncommitted work. Do not apply a blind pull over dirty files.

Public Exchange publishing remains disabled; this desktop release does not authorize a public publisher launch or invent production terms and credentials.
