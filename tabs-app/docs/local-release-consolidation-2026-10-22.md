# Local release consolidation — 2026-10-22

Branch: `codex/local-release-consolidation-2026-10-22`.
Checkout: `/Users/rushil.dev/Desktop/tabs/.worktrees/sync-vscode-1.143.0`.
The directory retains its existing name to reuse the compiled editor and dependencies and avoid another multi-gigabyte checkout.

## What is active in this checkout

- Current startup/performance and extension renewal baseline (`3915c864f`).
- Latest uncommitted UI: layered corner radii, connected browser-shaped project tabs, custom typography dialogs and saved mixes, split System Auto preview, animation preview fixes, settings/extension UI improvements.
- Native overlay stacking fixes for project menus, browser controls and Relay quit confirmation.
- Storage audit/cleanup commands and verified installer cleanup dialog.
- Code-OSS 1.143.0 snapshot (`2d0b7506a36c1d6db9a466440131a8e01eab2289`), reviewed native host adapters, DI startup repair, real workbench/PTY regression gate.
- 2.0.2 release branch follow-ups: backend readiness, startup timing, Exchange strict-policy styling and read-only secret mount support, Linux smoke cleanup, release workflow/changelog metadata.
- Preserved 2.0.2 macOS node-addon-api deployment-target build repair in the 1.143 postinstall flow.
- Local Relay extension and prototype sources, plus missing historical documentation/preview files.

The app metadata remains 2.0.2 for local testing; this is **not a newly published release**. Choose the next release version before publishing. Existing DMG/ZIP outputs predate this consolidation and are not the consolidated build.

## Deduplication and conflict decisions

Older worktrees use both `tabs-main`/`tabs-code-main` and the current `tabs-app`/`tabs-code-oss` names. Files were compared after mapping those names, against the current checkout and its historical blobs, including formatting changes. Being absent from the current branch's Git ancestry does not itself mean a feature is missing: a number of earlier changes arrived through imports or subsequent implementations.

Keep the newer implementation of Git account controls/pinned branches, model picker provider gating, Exchange portal/publishing/authentication, development extension reload, and scoped extension activation/crash handling. Do not reintroduce old inline settings editors, old Gemini defaults, duplicate extension identity headers, or old Code-OSS sources. The older Grok quota draft would infer 0% where the current tested implementation preserves an unmetered state; preserve the current behavior. The old RPC fixture loader is superseded by the shared TypeScript fixture loader. The 1.140 untracked gulp helper is a historical draft, not a 1.143 build input.

Backup-only material includes historical contract `src.backup` files, older alternate UI drafts, outdated handoff notes and legacy release-note variants. These remain recoverable with their original path in the safety archives; conflicting historical variants are not inserted into active runtime code.

No original worktree has been removed. All original branch commits remain in Git. Before editing the consolidation checkout, each dirty checkout's complete tracked binary diff and nonignored untracked files were exported to:

`/Users/rushil.dev/Desktop/tabs/.worktrees/consolidation-safety-2026-10-22`

`inventory.json` lists every dirty path and source commit. The per-worktree `.patch` and `-untracked.tar` preserve their actual contents. Comparison JSON records mechanical comparisons; “historical-formatted” is a review aid, not an automated semantic proof. The final selections above retain newer tested implementations. Ignored build outputs/dependencies are intentionally excluded from these source backups; ignored private configuration remains in the original worktrees. Do not delete those worktrees until private configuration and any other needed ignored files have also been reviewed.

## Local testing

After validation/build, double-click `test-consolidated-tabs.command`, or run:

```sh
/Users/rushil.dev/Desktop/tabs/.worktrees/sync-vscode-1.143.0/test-consolidated-tabs.command
```

This uses separate backend and Chromium state under `~/.tabs-consolidation-test` and the 1.143 runtime in this checkout. It does not replace `/Applications/Tabs.app`. A new profile will show onboarding and requires adding test projects/accounts. Verify project switching, Code/Agents/Browser/Relay, Command-Q in Relay, project menu visibility over native views, Themes/Animations previews, custom typography mixes and extension settings.

No changes have been staged, committed or pushed. A successful local run is not a published-release check. Worktree cleanup should happen only after the desired changes are committed, pushed, included in a verified release and any needed ignored/private files are preserved. Removing a checkout is safe then; deleting the only uncommitted copy is not. Safety archives also remain local until deliberately preserved elsewhere.

## Validation completed

- `vp run typecheck`: all 16 tasks passed.
- `vp check`: no errors; 661 existing warnings.
- Workspace tests: 17 package tasks passed initially; the server task had one provider-registry timeout. Its 36-test file passed in isolation, then the **complete** server suite passed with two workers: 641 files, 7,561 tests, 35 existing skips. No timeout or assertion was weakened.
- Desktop: 80 files / 666 tests; web: 224 files / 1,693 tests; Exchange: 109 files / 544 tests (24 existing skips); storage scripts: 49 tests.
- Seven focused browser files: 21 checks passed (installer cleanup, project header, overlays, appearance cards, saved typography, animation preview and radii).
- `bun run test:code-oss`: desktop/server/web build, real upstream native adapters, visible embedded 1.143 workbench, file content, radius CSS and actual integrated terminal command passed. Test-owned processes and temporary profile were removed.
- Code-OSS hygiene passed for the preserved native deployment-target helper and postinstall hook; deployment-target replacement and idempotence were verified on a temporary fixture.
- `git diff --check` and launcher shell syntax passed. Git index remains empty. Original tracked edits in the nine other dirty source checkouts match their saved patches byte for byte.

The launcher runs the freshly built local application. Existing DMGs/ZIPs in `release/` are older outputs and must be rebuilt before any release acceptance test.

## Worktree inventory

| Worktree                                                              | Branch                                   | Dirty paths at capture | Commits outside baseline ancestry |
| --------------------------------------------------------------------- | ---------------------------------------- | ---------------------: | --------------------------------: |
| `/Users/rushil.dev/Desktop/tabs`                                      | `codex/startup-release-review`           |                    248 |                                 0 |
| `/Users/rushil.dev/.codex/worktrees/exchange-availability/tabs`       | `codex/release-reconciliation`           |                      0 |                                11 |
| `/Users/rushil.dev/.codex/worktrees/git-workspace-redesign/tabs`      | `codex/git-workspace-redesign`           |                     18 |                                 0 |
| `/Users/rushil.dev/.codex/worktrees/release-2-readiness/tabs`         | `codex/release-2-rerelease-wiring`       |                      0 |                                 0 |
| `/Users/rushil.dev/.codex/worktrees/release-consolidation/tabs`       | `codex/release-consolidation-2026-10-15` |                    293 |                                 0 |
| `/Users/rushil.dev/.codex/worktrees/tabs-exchange-antigravity/tabs`   | `codex/tabs-exchange-antigravity`        |                      0 |                               108 |
| `/Users/rushil.dev/.codex/worktrees/tabs-exchange-claude-ui/tabs`     | `codex/tabs-exchange-claude-ui`          |                    146 |                               120 |
| `/Users/rushil.dev/.codex/worktrees/tabs-exchange-repairs/tabs`       | `codex/tabs-exchange-audit-repairs`      |                      0 |                               113 |
| `/Users/rushil.dev/.codex/worktrees/tabs-extensions-exchange/tabs`    | `codex/tabs-extensions-exchange`         |                      7 |                                98 |
| `/Users/rushil.dev/.codex/worktrees/tabs-extensions-testing/tabs`     | `codex/tabs-extensions-testing`          |                    238 |                               116 |
| `/Users/rushil.dev/.codex/worktrees/tabs-linux-bootstrap/tabs`        | `codex/git-toolbar-reliability`          |                      0 |                                 0 |
| `/Users/rushil.dev/Desktop/tabs/.worktrees/integration-review`        | `codex/integration-review-2026-10-16`    |                      0 |                                 0 |
| `/Users/rushil.dev/Desktop/tabs/.worktrees/release-2.0.1`             | `codex/release-2.0.1`                    |                      0 |                                 2 |
| `/Users/rushil.dev/Desktop/tabs/.worktrees/release-2.0.2`             | `codex/release-2.0.2`                    |                      0 |                                23 |
| `/Users/rushil.dev/Desktop/tabs/.worktrees/sync-vscode-1.140.0`       | `chore/sync-vscode-1.140.0`              |                      1 |                                 0 |
| `/Users/rushil.dev/Desktop/tabs/.worktrees/sync-vscode-1.142.0`       | `codex/codeoss-1.142-review-fixes`       |                      0 |                                 9 |
| `/Users/rushil.dev/Desktop/tabs/.worktrees/sync-vscode-1.143.0`       | `chore/sync-vscode-1.143.0`              |                   5722 |                                 0 |
| `/Users/rushil.dev/Desktop/tabs/.worktrees/t3-parity-goal-2026-10-06` | `codex/t3-parity-goal-2026-10-06`        |                   1356 |                                 0 |
| `/Users/rushil.dev/Desktop/tabs/.worktrees/turn-start-memory-timeout` | `codex/release-2-sync-marketing-v2`      |                      0 |                                 0 |
| `/Users/rushil.dev/Desktop/tabs/.worktrees/updater-hardening`         | `fix/updater-reliability-hardening`      |                      0 |                                 0 |
| `/Users/rushil.dev/Desktop/tabs/.worktrees/updater-production`        | `codex/updater-production-hardening`     |                      1 |                                 0 |

One additional registered `/private/tmp/tabs-marketing-exchange-footer` checkout is missing/prunable; its branch still exists. It was not pruned.

## Branch-only commit inventory

These are original Git commits outside baseline ancestry, **not a list of newly created consolidation commits**. Many are superseded or were imported under different commits. See selections above.

### codex/release-reconciliation

- `dd1e96c89` fix(web): finish startup animation before a smooth upward reveal
- `b0ae9d06a` docs: record installer acceptance and packaged startup limits
- `83ddd5c38` test(linux): stop the full smoke process group before cleanup
- `f861a0b2e` fix(exchange): serve portal styling and fonts under its strict policy
- `0931450fb` docs: record production recovery and final startup validation
- `641b9252b` fix(desktop): wait for backend listener before renderer authentication
- `9f6d494e8` perf(server): defer optional MCP SDK initialization
- `c83dd4845` fix(exchange): accept read-only platform secret mounts
- `826386073` Merge published 2.0.1 changes into the production fixes
- `b481ad4ab` release: prepare Tabs 2.0.1 workspace update
- `352602897` feat(web): add desktop extension management and project tool surface

### codex/tabs-exchange-antigravity

- `5d50bf1f9` test(exchange): add strict cross-service integration test with real HTTPS and desktop client
- `169a43020` test(desktop): add real Electron WebContentsView smoke test with security assertions and performance metrics
- `d9da8daaf` feat(exchange): checkpoint 4 trust, operations, and fork-compatibility hardening
- `71c42494a` feat(exchange): checkpoint 3 product and accessibility verification
- `944dc12b8` feat(desktop): add desktop install, update, and isolation integration tests against exchange (Checkpoint 2)
- `1f63b807e` feat(exchange): add real local PostgreSQL and S3 service integration test harness (Checkpoint 1)
- `300d50f0f` Scope extension view events to activation attempts and harden lifecycle settlement
- `880724449` Add end-to-end integration tests for Tabs Exchange lifecycle
- `ed5d568ba` Add accessible error surface and safe retry for extension tool views
- `f08ec6ac9` Handle post-load extension view crashes with host cleanup and retry
- `941285bac` Await repeated extension view activation
- `dc351ab51` Guard extension activation against superseded view loads
- `80d25e36d` Give extension permission controls contextual accessible names
- `cccffa73b` Reverify all signed package objects during TUF publication
- `94311616e` Track Exchange self-host environment template
- `008a63a24` Constrain signed Exchange target versions to package identity rules
- `f38c13918` Verify desktop trust across TUF root rotation
- `7e8d94d96` Test TUF root rotation publication gate
- `0630f5301` Validate Exchange packages independently of server Tabs version
- `f93ffc556` Export verified approved targets for offline signing
- `ab17a13ea` Harden staged TUF metadata reads
- `0351ec52c` Complete publisher invitation decision flow
- `b63dbef4b` Add auditable namespace member revocation
- `7d6710187` Require accepted invitations for publisher membership
- `87fea6755` Expose signed metadata expiry in Exchange operations
- `097202b8b` Allow audited reviewer rescan of submissions
- `95320fbb7` Verify quarantine bytes before review approval
- `a727918a0` Prevent quarantine package object overwrite
- `039a0bdb9` Bound Exchange GitHub OAuth responses and reject redirects
- `950debdd1` Add project-scoped read-only Git status extension broker
- `e5c70e076` Verify quarantine objects before signed Exchange publication
- `9c3de8aa1` Handle batched Exchange metadata events within per-event bounds
- `0ff01bc2d` Publish draft Exchange registry OpenAPI contract
- `6b7dd9518` Dispose Exchange signed-metadata listeners safely
- `c0102618c` Verify Exchange package objects for recovery drills
- `8d4e60150` Wake desktop on signed Exchange metadata publication
- `9127e5b8c` Add reviewer portal for vetted digest batches
- `5d13e58cc` Support audited batch blocking of Exchange digests
- `9fe3dee3d` Test Exchange registry identity at install confirmation
- `2c92ba015` Paginate Exchange search across registry and clients
- `ac68ae32d` Rebuild Exchange search heads during schema migration
- `8cb3d333e` Keep Exchange search heads current after revocation
- `b42a03d51` Materialize signed Exchange search heads
- `2e7ef9cf2` Recheck opened extension workspace files
- `b9cff3906` Bound Exchange compatibility lookups and catalog size
- `829fd881b` Discover compatible older Exchange API releases
- `0eb29e573` Paginate Exchange public version listings
- `dc53a7d57` Add readable Tabs Exchange listing details
- `7881ede1c` Add integrated Tabs extension developer sample
- `256382dcd` Surface Exchange signed revocation backlog
- `bba237fdb` Renew Exchange scan claims during long reviews
- `b3d613fd1` Track Exchange scan worker heartbeat
- `964a65eb1` Show Exchange reviewer queue health
- `2e98c6395` Expose Exchange publisher review history
- `956ff1388` Audit public npm dependencies during Exchange review
- `da8e44f02` Bound concurrent Exchange package uploads
- `090706dd3` Keep extension updates successful after backup cleanup failures
- `e8e5f49c0` Bound extension network DNS and request time
- `1a11dc3c5` Serve highest approved Exchange release in catalog
- `2916e143e` Compare Exchange submissions with semantic predecessor
- `cf4f4d1fa` Surface extension storage migrations in Exchange review
- `250484586` Protect local extension package updates with rollback
- `dda216286` Add versioned extension profile storage migrations
- `9cbbdddfc` Clean up failed extension package installations
- `4543569cb` Bind extension toolbar preferences to package origin
- `b29224f6b` Integrate extension tools with project toolbar preferences
- `856dab741` Show host-owned extension identity above full views
- `e8a5c9196` Gate Exchange catalog on signed target publication
- `069c9bd5f` Wire capability-gated Tabs MCP into ACP providers
- `bfeeed3c0` Expose project-granted extension AI commands through MCP
- `5c4ff1ccf` Bind MCP requests to live thread projects
- `c6c6e236e` Apply trusted extension updates at safe boundaries
- `1bd96bec4` Block known malicious extension digests during review
- `c6cddfd82` Show extension update permission increases accurately
- `792a66739` Add isolated extension computation commands
- `0b69ea156` feat(extensions): prove disposable QuickJS logic runtime
- `f42917f62` feat(exchange): show verified bounded review diffs
- `c15df3f95` feat(extensions): add isolated account credentials and profile sample
- `83997479d` feat(extensions): add versioned developer API and validate command
- `9c676d4dc` feat(extensions): add project-scoped HTTPS network broker
- `c164114aa` feat(extensions): add project-scoped read broker
- `ee25f84a3` fix(extensions): roll back failed Exchange activation
- `3f3d3dda5` fix(exchange): detect disguised executable package contents
- `cc9e4e6ca` feat(exchange): add publisher appeals and reviewer responses
- `0ce0caec1` fix(exchange): discover compatible approved versions
- `99fb64e16` feat(extensions): offer inventoried local data deletion on uninstall
- `508d227ea` feat(extensions): persist Exchange update pinning
- `dd646bc8b` feat(exchange): show release metadata in extension discovery
- `aa5b0c0ad` feat(exchange): show capability changes during version review
- `7ae19d625` feat(extensions): disable tools without erasing project state
- `6348efdb9` feat(extensions): monitor signed Exchange updates in background
- `49bfd335e` feat(extensions): verify and review manual Exchange updates
- `f06123102` feat(extensions): inventory scoped profile data and partitions
- `90b2d5888` feat(extensions): uninstall packages while retaining scoped profile data
- `cd527643b` feat(extensions): enforce signed Exchange revocations
- `566c115c2` feat(extensions): add manually reviewed trusted Exchange installs
- `e1bfa267d` feat(extensions): verify signed Exchange package downloads
- `819d77d84` feat(exchange): serve and publish verified TUF metadata
- `b9419e3fc` feat(extensions): verify signed Exchange targets with TUF client
- `c75e581d9` feat(extensions): browse validated Exchange catalog in desktop
- `29c156736` feat(extensions): isolate named profiles by project when selected
- `5793e1bc9` feat(extensions): add project-granted profile storage bridge
- `5e40eda85` docs(extensions): describe experimental Exchange status
- `d07a85f82` feat(exchange): add quarantined registry service and publisher portal
- `9ce751bd7` feat(extensions): import local archives in desktop development
- `fbc3438f8` test(extensions): reject traversal archive entries
- `ccfd176f2` feat(extensions): add deterministic package validation tooling
- `172e691af` feat(extensions): add desktop development tool foundation

### codex/tabs-exchange-claude-ui

- `b8eaa0ded` style: fix formatter whitespace in accountNavigation.test.ts
- `8d68a9fd3` redesign(checkpoint-2-5): public discovery, developers, docs, admin pages
- `33ed79bac` redesign(checkpoint-1): shared design tokens, header/footer, operator nav
- `0c0b326fd` chore(exchange): freeze staging baseline for Claude UI review
- `bcc4bdda0` Record final extensions redesign acceptance checks
- `c5f401eef` Normalize baseline formatting and record redesign verification
- `27c0eb142` Redesign extension settings and Tabs Exchange presentation
- `6038d4902` Stabilize live integration teardown and record PR audit
- `e601fe7d0` Repair cross-service proof and package path containment
- `70743be2d` test(exchange): add strict cross-service integration test with real HTTPS and desktop client
- `d15307fd1` Strengthen real Electron extension smoke coverage and preserve unrelated views
- `6cac2bd5c` test(desktop): add real Electron WebContentsView smoke test with security assertions and performance metrics
- `334664147` Audit and harden Tabs Exchange handoff claims
- `0a93a0345` Fix overlapping extension view activations and scoped hide validation
- `d9da8daaf` feat(exchange): checkpoint 4 trust, operations, and fork-compatibility hardening
- `71c42494a` feat(exchange): checkpoint 3 product and accessibility verification
- `944dc12b8` feat(desktop): add desktop install, update, and isolation integration tests against exchange (Checkpoint 2)
- `1f63b807e` feat(exchange): add real local PostgreSQL and S3 service integration test harness (Checkpoint 1)
- `300d50f0f` Scope extension view events to activation attempts and harden lifecycle settlement
- `880724449` Add end-to-end integration tests for Tabs Exchange lifecycle
- `ed5d568ba` Add accessible error surface and safe retry for extension tool views
- `f08ec6ac9` Handle post-load extension view crashes with host cleanup and retry
- `941285bac` Await repeated extension view activation
- `dc351ab51` Guard extension activation against superseded view loads
- `80d25e36d` Give extension permission controls contextual accessible names
- `cccffa73b` Reverify all signed package objects during TUF publication
- `94311616e` Track Exchange self-host environment template
- `008a63a24` Constrain signed Exchange target versions to package identity rules
- `f38c13918` Verify desktop trust across TUF root rotation
- `7e8d94d96` Test TUF root rotation publication gate
- `0630f5301` Validate Exchange packages independently of server Tabs version
- `f93ffc556` Export verified approved targets for offline signing
- `ab17a13ea` Harden staged TUF metadata reads
- `0351ec52c` Complete publisher invitation decision flow
- `b63dbef4b` Add auditable namespace member revocation
- `7d6710187` Require accepted invitations for publisher membership
- `87fea6755` Expose signed metadata expiry in Exchange operations
- `097202b8b` Allow audited reviewer rescan of submissions
- `95320fbb7` Verify quarantine bytes before review approval
- `a727918a0` Prevent quarantine package object overwrite
- `039a0bdb9` Bound Exchange GitHub OAuth responses and reject redirects
- `950debdd1` Add project-scoped read-only Git status extension broker
- `e5c70e076` Verify quarantine objects before signed Exchange publication
- `9c3de8aa1` Handle batched Exchange metadata events within per-event bounds
- `0ff01bc2d` Publish draft Exchange registry OpenAPI contract
- `6b7dd9518` Dispose Exchange signed-metadata listeners safely
- `c0102618c` Verify Exchange package objects for recovery drills
- `8d4e60150` Wake desktop on signed Exchange metadata publication
- `9127e5b8c` Add reviewer portal for vetted digest batches
- `5d13e58cc` Support audited batch blocking of Exchange digests
- `9fe3dee3d` Test Exchange registry identity at install confirmation
- `2c92ba015` Paginate Exchange search across registry and clients
- `ac68ae32d` Rebuild Exchange search heads during schema migration
- `8cb3d333e` Keep Exchange search heads current after revocation
- `b42a03d51` Materialize signed Exchange search heads
- `2e7ef9cf2` Recheck opened extension workspace files
- `b9cff3906` Bound Exchange compatibility lookups and catalog size
- `829fd881b` Discover compatible older Exchange API releases
- `0eb29e573` Paginate Exchange public version listings
- `dc53a7d57` Add readable Tabs Exchange listing details
- `7881ede1c` Add integrated Tabs extension developer sample
- `256382dcd` Surface Exchange signed revocation backlog
- `bba237fdb` Renew Exchange scan claims during long reviews
- `b3d613fd1` Track Exchange scan worker heartbeat
- `964a65eb1` Show Exchange reviewer queue health
- `2e98c6395` Expose Exchange publisher review history
- `956ff1388` Audit public npm dependencies during Exchange review
- `da8e44f02` Bound concurrent Exchange package uploads
- `090706dd3` Keep extension updates successful after backup cleanup failures
- `e8e5f49c0` Bound extension network DNS and request time
- `1a11dc3c5` Serve highest approved Exchange release in catalog
- `2916e143e` Compare Exchange submissions with semantic predecessor
- `cf4f4d1fa` Surface extension storage migrations in Exchange review
- `250484586` Protect local extension package updates with rollback
- `dda216286` Add versioned extension profile storage migrations
- `9cbbdddfc` Clean up failed extension package installations
- `4543569cb` Bind extension toolbar preferences to package origin
- `b29224f6b` Integrate extension tools with project toolbar preferences
- `856dab741` Show host-owned extension identity above full views
- `e8a5c9196` Gate Exchange catalog on signed target publication
- `069c9bd5f` Wire capability-gated Tabs MCP into ACP providers
- `bfeeed3c0` Expose project-granted extension AI commands through MCP
- `5c4ff1ccf` Bind MCP requests to live thread projects
- `c6c6e236e` Apply trusted extension updates at safe boundaries
- `1bd96bec4` Block known malicious extension digests during review
- `c6cddfd82` Show extension update permission increases accurately
- `792a66739` Add isolated extension computation commands
- `0b69ea156` feat(extensions): prove disposable QuickJS logic runtime
- `f42917f62` feat(exchange): show verified bounded review diffs
- `c15df3f95` feat(extensions): add isolated account credentials and profile sample
- `83997479d` feat(extensions): add versioned developer API and validate command
- `9c676d4dc` feat(extensions): add project-scoped HTTPS network broker
- `c164114aa` feat(extensions): add project-scoped read broker
- `ee25f84a3` fix(extensions): roll back failed Exchange activation
- `3f3d3dda5` fix(exchange): detect disguised executable package contents
- `cc9e4e6ca` feat(exchange): add publisher appeals and reviewer responses
- `0ce0caec1` fix(exchange): discover compatible approved versions
- `99fb64e16` feat(extensions): offer inventoried local data deletion on uninstall
- `508d227ea` feat(extensions): persist Exchange update pinning
- `dd646bc8b` feat(exchange): show release metadata in extension discovery
- `aa5b0c0ad` feat(exchange): show capability changes during version review
- `7ae19d625` feat(extensions): disable tools without erasing project state
- `6348efdb9` feat(extensions): monitor signed Exchange updates in background
- `49bfd335e` feat(extensions): verify and review manual Exchange updates
- `f06123102` feat(extensions): inventory scoped profile data and partitions
- `90b2d5888` feat(extensions): uninstall packages while retaining scoped profile data
- `cd527643b` feat(extensions): enforce signed Exchange revocations
- `566c115c2` feat(extensions): add manually reviewed trusted Exchange installs
- `e1bfa267d` feat(extensions): verify signed Exchange package downloads
- `819d77d84` feat(exchange): serve and publish verified TUF metadata
- `b9419e3fc` feat(extensions): verify signed Exchange targets with TUF client
- `c75e581d9` feat(extensions): browse validated Exchange catalog in desktop
- `29c156736` feat(extensions): isolate named profiles by project when selected
- `5793e1bc9` feat(extensions): add project-granted profile storage bridge
- `5e40eda85` docs(extensions): describe experimental Exchange status
- `d07a85f82` feat(exchange): add quarantined registry service and publisher portal
- `9ce751bd7` feat(extensions): import local archives in desktop development
- `fbc3438f8` test(extensions): reject traversal archive entries
- `ccfd176f2` feat(extensions): add deterministic package validation tooling
- `172e691af` feat(extensions): add desktop development tool foundation

### codex/tabs-exchange-audit-repairs

- `6038d4902` Stabilize live integration teardown and record PR audit
- `e601fe7d0` Repair cross-service proof and package path containment
- `70743be2d` test(exchange): add strict cross-service integration test with real HTTPS and desktop client
- `d15307fd1` Strengthen real Electron extension smoke coverage and preserve unrelated views
- `6cac2bd5c` test(desktop): add real Electron WebContentsView smoke test with security assertions and performance metrics
- `334664147` Audit and harden Tabs Exchange handoff claims
- `0a93a0345` Fix overlapping extension view activations and scoped hide validation
- `d9da8daaf` feat(exchange): checkpoint 4 trust, operations, and fork-compatibility hardening
- `71c42494a` feat(exchange): checkpoint 3 product and accessibility verification
- `944dc12b8` feat(desktop): add desktop install, update, and isolation integration tests against exchange (Checkpoint 2)
- `1f63b807e` feat(exchange): add real local PostgreSQL and S3 service integration test harness (Checkpoint 1)
- `300d50f0f` Scope extension view events to activation attempts and harden lifecycle settlement
- `880724449` Add end-to-end integration tests for Tabs Exchange lifecycle
- `ed5d568ba` Add accessible error surface and safe retry for extension tool views
- `f08ec6ac9` Handle post-load extension view crashes with host cleanup and retry
- `941285bac` Await repeated extension view activation
- `dc351ab51` Guard extension activation against superseded view loads
- `80d25e36d` Give extension permission controls contextual accessible names
- `cccffa73b` Reverify all signed package objects during TUF publication
- `94311616e` Track Exchange self-host environment template
- `008a63a24` Constrain signed Exchange target versions to package identity rules
- `f38c13918` Verify desktop trust across TUF root rotation
- `7e8d94d96` Test TUF root rotation publication gate
- `0630f5301` Validate Exchange packages independently of server Tabs version
- `f93ffc556` Export verified approved targets for offline signing
- `ab17a13ea` Harden staged TUF metadata reads
- `0351ec52c` Complete publisher invitation decision flow
- `b63dbef4b` Add auditable namespace member revocation
- `7d6710187` Require accepted invitations for publisher membership
- `87fea6755` Expose signed metadata expiry in Exchange operations
- `097202b8b` Allow audited reviewer rescan of submissions
- `95320fbb7` Verify quarantine bytes before review approval
- `a727918a0` Prevent quarantine package object overwrite
- `039a0bdb9` Bound Exchange GitHub OAuth responses and reject redirects
- `950debdd1` Add project-scoped read-only Git status extension broker
- `e5c70e076` Verify quarantine objects before signed Exchange publication
- `9c3de8aa1` Handle batched Exchange metadata events within per-event bounds
- `0ff01bc2d` Publish draft Exchange registry OpenAPI contract
- `6b7dd9518` Dispose Exchange signed-metadata listeners safely
- `c0102618c` Verify Exchange package objects for recovery drills
- `8d4e60150` Wake desktop on signed Exchange metadata publication
- `9127e5b8c` Add reviewer portal for vetted digest batches
- `5d13e58cc` Support audited batch blocking of Exchange digests
- `9fe3dee3d` Test Exchange registry identity at install confirmation
- `2c92ba015` Paginate Exchange search across registry and clients
- `ac68ae32d` Rebuild Exchange search heads during schema migration
- `8cb3d333e` Keep Exchange search heads current after revocation
- `b42a03d51` Materialize signed Exchange search heads
- `2e7ef9cf2` Recheck opened extension workspace files
- `b9cff3906` Bound Exchange compatibility lookups and catalog size
- `829fd881b` Discover compatible older Exchange API releases
- `0eb29e573` Paginate Exchange public version listings
- `dc53a7d57` Add readable Tabs Exchange listing details
- `7881ede1c` Add integrated Tabs extension developer sample
- `256382dcd` Surface Exchange signed revocation backlog
- `bba237fdb` Renew Exchange scan claims during long reviews
- `b3d613fd1` Track Exchange scan worker heartbeat
- `964a65eb1` Show Exchange reviewer queue health
- `2e98c6395` Expose Exchange publisher review history
- `956ff1388` Audit public npm dependencies during Exchange review
- `da8e44f02` Bound concurrent Exchange package uploads
- `090706dd3` Keep extension updates successful after backup cleanup failures
- `e8e5f49c0` Bound extension network DNS and request time
- `1a11dc3c5` Serve highest approved Exchange release in catalog
- `2916e143e` Compare Exchange submissions with semantic predecessor
- `cf4f4d1fa` Surface extension storage migrations in Exchange review
- `250484586` Protect local extension package updates with rollback
- `dda216286` Add versioned extension profile storage migrations
- `9cbbdddfc` Clean up failed extension package installations
- `4543569cb` Bind extension toolbar preferences to package origin
- `b29224f6b` Integrate extension tools with project toolbar preferences
- `856dab741` Show host-owned extension identity above full views
- `e8a5c9196` Gate Exchange catalog on signed target publication
- `069c9bd5f` Wire capability-gated Tabs MCP into ACP providers
- `bfeeed3c0` Expose project-granted extension AI commands through MCP
- `5c4ff1ccf` Bind MCP requests to live thread projects
- `c6c6e236e` Apply trusted extension updates at safe boundaries
- `1bd96bec4` Block known malicious extension digests during review
- `c6cddfd82` Show extension update permission increases accurately
- `792a66739` Add isolated extension computation commands
- `0b69ea156` feat(extensions): prove disposable QuickJS logic runtime
- `f42917f62` feat(exchange): show verified bounded review diffs
- `c15df3f95` feat(extensions): add isolated account credentials and profile sample
- `83997479d` feat(extensions): add versioned developer API and validate command
- `9c676d4dc` feat(extensions): add project-scoped HTTPS network broker
- `c164114aa` feat(extensions): add project-scoped read broker
- `ee25f84a3` fix(extensions): roll back failed Exchange activation
- `3f3d3dda5` fix(exchange): detect disguised executable package contents
- `cc9e4e6ca` feat(exchange): add publisher appeals and reviewer responses
- `0ce0caec1` fix(exchange): discover compatible approved versions
- `99fb64e16` feat(extensions): offer inventoried local data deletion on uninstall
- `508d227ea` feat(extensions): persist Exchange update pinning
- `dd646bc8b` feat(exchange): show release metadata in extension discovery
- `aa5b0c0ad` feat(exchange): show capability changes during version review
- `7ae19d625` feat(extensions): disable tools without erasing project state
- `6348efdb9` feat(extensions): monitor signed Exchange updates in background
- `49bfd335e` feat(extensions): verify and review manual Exchange updates
- `f06123102` feat(extensions): inventory scoped profile data and partitions
- `90b2d5888` feat(extensions): uninstall packages while retaining scoped profile data
- `cd527643b` feat(extensions): enforce signed Exchange revocations
- `566c115c2` feat(extensions): add manually reviewed trusted Exchange installs
- `e1bfa267d` feat(extensions): verify signed Exchange package downloads
- `819d77d84` feat(exchange): serve and publish verified TUF metadata
- `b9419e3fc` feat(extensions): verify signed Exchange targets with TUF client
- `c75e581d9` feat(extensions): browse validated Exchange catalog in desktop
- `29c156736` feat(extensions): isolate named profiles by project when selected
- `5793e1bc9` feat(extensions): add project-granted profile storage bridge
- `5e40eda85` docs(extensions): describe experimental Exchange status
- `d07a85f82` feat(exchange): add quarantined registry service and publisher portal
- `9ce751bd7` feat(extensions): import local archives in desktop development
- `fbc3438f8` test(extensions): reject traversal archive entries
- `ccfd176f2` feat(extensions): add deterministic package validation tooling
- `172e691af` feat(extensions): add desktop development tool foundation

### codex/tabs-extensions-exchange

- `941285bac` Await repeated extension view activation
- `dc351ab51` Guard extension activation against superseded view loads
- `80d25e36d` Give extension permission controls contextual accessible names
- `cccffa73b` Reverify all signed package objects during TUF publication
- `94311616e` Track Exchange self-host environment template
- `008a63a24` Constrain signed Exchange target versions to package identity rules
- `f38c13918` Verify desktop trust across TUF root rotation
- `7e8d94d96` Test TUF root rotation publication gate
- `0630f5301` Validate Exchange packages independently of server Tabs version
- `f93ffc556` Export verified approved targets for offline signing
- `ab17a13ea` Harden staged TUF metadata reads
- `0351ec52c` Complete publisher invitation decision flow
- `b63dbef4b` Add auditable namespace member revocation
- `7d6710187` Require accepted invitations for publisher membership
- `87fea6755` Expose signed metadata expiry in Exchange operations
- `097202b8b` Allow audited reviewer rescan of submissions
- `95320fbb7` Verify quarantine bytes before review approval
- `a727918a0` Prevent quarantine package object overwrite
- `039a0bdb9` Bound Exchange GitHub OAuth responses and reject redirects
- `950debdd1` Add project-scoped read-only Git status extension broker
- `e5c70e076` Verify quarantine objects before signed Exchange publication
- `9c3de8aa1` Handle batched Exchange metadata events within per-event bounds
- `0ff01bc2d` Publish draft Exchange registry OpenAPI contract
- `6b7dd9518` Dispose Exchange signed-metadata listeners safely
- `c0102618c` Verify Exchange package objects for recovery drills
- `8d4e60150` Wake desktop on signed Exchange metadata publication
- `9127e5b8c` Add reviewer portal for vetted digest batches
- `5d13e58cc` Support audited batch blocking of Exchange digests
- `9fe3dee3d` Test Exchange registry identity at install confirmation
- `2c92ba015` Paginate Exchange search across registry and clients
- `ac68ae32d` Rebuild Exchange search heads during schema migration
- `8cb3d333e` Keep Exchange search heads current after revocation
- `b42a03d51` Materialize signed Exchange search heads
- `2e7ef9cf2` Recheck opened extension workspace files
- `b9cff3906` Bound Exchange compatibility lookups and catalog size
- `829fd881b` Discover compatible older Exchange API releases
- `0eb29e573` Paginate Exchange public version listings
- `dc53a7d57` Add readable Tabs Exchange listing details
- `7881ede1c` Add integrated Tabs extension developer sample
- `256382dcd` Surface Exchange signed revocation backlog
- `bba237fdb` Renew Exchange scan claims during long reviews
- `b3d613fd1` Track Exchange scan worker heartbeat
- `964a65eb1` Show Exchange reviewer queue health
- `2e98c6395` Expose Exchange publisher review history
- `956ff1388` Audit public npm dependencies during Exchange review
- `da8e44f02` Bound concurrent Exchange package uploads
- `090706dd3` Keep extension updates successful after backup cleanup failures
- `e8e5f49c0` Bound extension network DNS and request time
- `1a11dc3c5` Serve highest approved Exchange release in catalog
- `2916e143e` Compare Exchange submissions with semantic predecessor
- `cf4f4d1fa` Surface extension storage migrations in Exchange review
- `250484586` Protect local extension package updates with rollback
- `dda216286` Add versioned extension profile storage migrations
- `9cbbdddfc` Clean up failed extension package installations
- `4543569cb` Bind extension toolbar preferences to package origin
- `b29224f6b` Integrate extension tools with project toolbar preferences
- `856dab741` Show host-owned extension identity above full views
- `e8a5c9196` Gate Exchange catalog on signed target publication
- `069c9bd5f` Wire capability-gated Tabs MCP into ACP providers
- `bfeeed3c0` Expose project-granted extension AI commands through MCP
- `5c4ff1ccf` Bind MCP requests to live thread projects
- `c6c6e236e` Apply trusted extension updates at safe boundaries
- `1bd96bec4` Block known malicious extension digests during review
- `c6cddfd82` Show extension update permission increases accurately
- `792a66739` Add isolated extension computation commands
- `0b69ea156` feat(extensions): prove disposable QuickJS logic runtime
- `f42917f62` feat(exchange): show verified bounded review diffs
- `c15df3f95` feat(extensions): add isolated account credentials and profile sample
- `83997479d` feat(extensions): add versioned developer API and validate command
- `9c676d4dc` feat(extensions): add project-scoped HTTPS network broker
- `c164114aa` feat(extensions): add project-scoped read broker
- `ee25f84a3` fix(extensions): roll back failed Exchange activation
- `3f3d3dda5` fix(exchange): detect disguised executable package contents
- `cc9e4e6ca` feat(exchange): add publisher appeals and reviewer responses
- `0ce0caec1` fix(exchange): discover compatible approved versions
- `99fb64e16` feat(extensions): offer inventoried local data deletion on uninstall
- `508d227ea` feat(extensions): persist Exchange update pinning
- `dd646bc8b` feat(exchange): show release metadata in extension discovery
- `aa5b0c0ad` feat(exchange): show capability changes during version review
- `7ae19d625` feat(extensions): disable tools without erasing project state
- `6348efdb9` feat(extensions): monitor signed Exchange updates in background
- `49bfd335e` feat(extensions): verify and review manual Exchange updates
- `f06123102` feat(extensions): inventory scoped profile data and partitions
- `90b2d5888` feat(extensions): uninstall packages while retaining scoped profile data
- `cd527643b` feat(extensions): enforce signed Exchange revocations
- `566c115c2` feat(extensions): add manually reviewed trusted Exchange installs
- `e1bfa267d` feat(extensions): verify signed Exchange package downloads
- `819d77d84` feat(exchange): serve and publish verified TUF metadata
- `b9419e3fc` feat(extensions): verify signed Exchange targets with TUF client
- `c75e581d9` feat(extensions): browse validated Exchange catalog in desktop
- `29c156736` feat(extensions): isolate named profiles by project when selected
- `5793e1bc9` feat(extensions): add project-granted profile storage bridge
- `5e40eda85` docs(extensions): describe experimental Exchange status
- `d07a85f82` feat(exchange): add quarantined registry service and publisher portal
- `9ce751bd7` feat(extensions): import local archives in desktop development
- `fbc3438f8` test(extensions): reject traversal archive entries
- `ccfd176f2` feat(extensions): add deterministic package validation tooling
- `172e691af` feat(extensions): add desktop development tool foundation

### codex/tabs-extensions-testing

- `bcc4bdda0` Record final extensions redesign acceptance checks
- `c5f401eef` Normalize baseline formatting and record redesign verification
- `27c0eb142` Redesign extension settings and Tabs Exchange presentation
- `6038d4902` Stabilize live integration teardown and record PR audit
- `e601fe7d0` Repair cross-service proof and package path containment
- `70743be2d` test(exchange): add strict cross-service integration test with real HTTPS and desktop client
- `d15307fd1` Strengthen real Electron extension smoke coverage and preserve unrelated views
- `6cac2bd5c` test(desktop): add real Electron WebContentsView smoke test with security assertions and performance metrics
- `334664147` Audit and harden Tabs Exchange handoff claims
- `0a93a0345` Fix overlapping extension view activations and scoped hide validation
- `d9da8daaf` feat(exchange): checkpoint 4 trust, operations, and fork-compatibility hardening
- `71c42494a` feat(exchange): checkpoint 3 product and accessibility verification
- `944dc12b8` feat(desktop): add desktop install, update, and isolation integration tests against exchange (Checkpoint 2)
- `1f63b807e` feat(exchange): add real local PostgreSQL and S3 service integration test harness (Checkpoint 1)
- `300d50f0f` Scope extension view events to activation attempts and harden lifecycle settlement
- `880724449` Add end-to-end integration tests for Tabs Exchange lifecycle
- `ed5d568ba` Add accessible error surface and safe retry for extension tool views
- `f08ec6ac9` Handle post-load extension view crashes with host cleanup and retry
- `941285bac` Await repeated extension view activation
- `dc351ab51` Guard extension activation against superseded view loads
- `80d25e36d` Give extension permission controls contextual accessible names
- `cccffa73b` Reverify all signed package objects during TUF publication
- `94311616e` Track Exchange self-host environment template
- `008a63a24` Constrain signed Exchange target versions to package identity rules
- `f38c13918` Verify desktop trust across TUF root rotation
- `7e8d94d96` Test TUF root rotation publication gate
- `0630f5301` Validate Exchange packages independently of server Tabs version
- `f93ffc556` Export verified approved targets for offline signing
- `ab17a13ea` Harden staged TUF metadata reads
- `0351ec52c` Complete publisher invitation decision flow
- `b63dbef4b` Add auditable namespace member revocation
- `7d6710187` Require accepted invitations for publisher membership
- `87fea6755` Expose signed metadata expiry in Exchange operations
- `097202b8b` Allow audited reviewer rescan of submissions
- `95320fbb7` Verify quarantine bytes before review approval
- `a727918a0` Prevent quarantine package object overwrite
- `039a0bdb9` Bound Exchange GitHub OAuth responses and reject redirects
- `950debdd1` Add project-scoped read-only Git status extension broker
- `e5c70e076` Verify quarantine objects before signed Exchange publication
- `9c3de8aa1` Handle batched Exchange metadata events within per-event bounds
- `0ff01bc2d` Publish draft Exchange registry OpenAPI contract
- `6b7dd9518` Dispose Exchange signed-metadata listeners safely
- `c0102618c` Verify Exchange package objects for recovery drills
- `8d4e60150` Wake desktop on signed Exchange metadata publication
- `9127e5b8c` Add reviewer portal for vetted digest batches
- `5d13e58cc` Support audited batch blocking of Exchange digests
- `9fe3dee3d` Test Exchange registry identity at install confirmation
- `2c92ba015` Paginate Exchange search across registry and clients
- `ac68ae32d` Rebuild Exchange search heads during schema migration
- `8cb3d333e` Keep Exchange search heads current after revocation
- `b42a03d51` Materialize signed Exchange search heads
- `2e7ef9cf2` Recheck opened extension workspace files
- `b9cff3906` Bound Exchange compatibility lookups and catalog size
- `829fd881b` Discover compatible older Exchange API releases
- `0eb29e573` Paginate Exchange public version listings
- `dc53a7d57` Add readable Tabs Exchange listing details
- `7881ede1c` Add integrated Tabs extension developer sample
- `256382dcd` Surface Exchange signed revocation backlog
- `bba237fdb` Renew Exchange scan claims during long reviews
- `b3d613fd1` Track Exchange scan worker heartbeat
- `964a65eb1` Show Exchange reviewer queue health
- `2e98c6395` Expose Exchange publisher review history
- `956ff1388` Audit public npm dependencies during Exchange review
- `da8e44f02` Bound concurrent Exchange package uploads
- `090706dd3` Keep extension updates successful after backup cleanup failures
- `e8e5f49c0` Bound extension network DNS and request time
- `1a11dc3c5` Serve highest approved Exchange release in catalog
- `2916e143e` Compare Exchange submissions with semantic predecessor
- `cf4f4d1fa` Surface extension storage migrations in Exchange review
- `250484586` Protect local extension package updates with rollback
- `dda216286` Add versioned extension profile storage migrations
- `9cbbdddfc` Clean up failed extension package installations
- `4543569cb` Bind extension toolbar preferences to package origin
- `b29224f6b` Integrate extension tools with project toolbar preferences
- `856dab741` Show host-owned extension identity above full views
- `e8a5c9196` Gate Exchange catalog on signed target publication
- `069c9bd5f` Wire capability-gated Tabs MCP into ACP providers
- `bfeeed3c0` Expose project-granted extension AI commands through MCP
- `5c4ff1ccf` Bind MCP requests to live thread projects
- `c6c6e236e` Apply trusted extension updates at safe boundaries
- `1bd96bec4` Block known malicious extension digests during review
- `c6cddfd82` Show extension update permission increases accurately
- `792a66739` Add isolated extension computation commands
- `0b69ea156` feat(extensions): prove disposable QuickJS logic runtime
- `f42917f62` feat(exchange): show verified bounded review diffs
- `c15df3f95` feat(extensions): add isolated account credentials and profile sample
- `83997479d` feat(extensions): add versioned developer API and validate command
- `9c676d4dc` feat(extensions): add project-scoped HTTPS network broker
- `c164114aa` feat(extensions): add project-scoped read broker
- `ee25f84a3` fix(extensions): roll back failed Exchange activation
- `3f3d3dda5` fix(exchange): detect disguised executable package contents
- `cc9e4e6ca` feat(exchange): add publisher appeals and reviewer responses
- `0ce0caec1` fix(exchange): discover compatible approved versions
- `99fb64e16` feat(extensions): offer inventoried local data deletion on uninstall
- `508d227ea` feat(extensions): persist Exchange update pinning
- `dd646bc8b` feat(exchange): show release metadata in extension discovery
- `aa5b0c0ad` feat(exchange): show capability changes during version review
- `7ae19d625` feat(extensions): disable tools without erasing project state
- `6348efdb9` feat(extensions): monitor signed Exchange updates in background
- `49bfd335e` feat(extensions): verify and review manual Exchange updates
- `f06123102` feat(extensions): inventory scoped profile data and partitions
- `90b2d5888` feat(extensions): uninstall packages while retaining scoped profile data
- `cd527643b` feat(extensions): enforce signed Exchange revocations
- `566c115c2` feat(extensions): add manually reviewed trusted Exchange installs
- `e1bfa267d` feat(extensions): verify signed Exchange package downloads
- `819d77d84` feat(exchange): serve and publish verified TUF metadata
- `b9419e3fc` feat(extensions): verify signed Exchange targets with TUF client
- `c75e581d9` feat(extensions): browse validated Exchange catalog in desktop
- `29c156736` feat(extensions): isolate named profiles by project when selected
- `5793e1bc9` feat(extensions): add project-granted profile storage bridge
- `5e40eda85` docs(extensions): describe experimental Exchange status
- `d07a85f82` feat(exchange): add quarantined registry service and publisher portal
- `9ce751bd7` feat(extensions): import local archives in desktop development
- `fbc3438f8` test(extensions): reject traversal archive entries
- `ccfd176f2` feat(extensions): add deterministic package validation tooling
- `172e691af` feat(extensions): add desktop development tool foundation

### codex/release-2.0.1

- `b481ad4ab` release: prepare Tabs 2.0.1 workspace update
- `352602897` feat(web): add desktop extension management and project tool surface

### codex/release-2.0.2

- `2fc28fa45` build: target macOS 11.0 in node-addon-api gypi for Code-OSS 1.142 native modules
- `4fb665308` release: prepare Tabs 2.0.2 workspace update
- `b90f6d8db` Merge branch 'codex/codeoss-1.142-review-fixes' into codex/release-2.0.2
- `b3c6cb860` docs: update Code-OSS 1.142.0 audit, parity notes and fork inventory for native host repairs
- `6138b3485` test(desktop): add native contract smoke gate against compiled Code-OSS runtime
- `e25fd54dc` fix(desktop): wire Code-OSS 1.142 native host dispatch, activity lifecycle and shutdown joins
- `bc7791c75` fix(desktop): observe GPU compositing and recovery with disposable listeners
- `98ebd1d8d` fix(desktop): add cancellation, streaming progress and partial cleanup to native ZIP operations
- `5ae391d80` fix(desktop): adapt editor and Agents invitation coordination with registered window ownership
- `718ad5bdd` fix(desktop): persist typed coordinator counters and impressions in native code host storage
- `ad962be5d` test(desktop): use temporary fixtures in codeHostManager clean-checkout resolver tests
- `dd1e96c89` fix(web): finish startup animation before a smooth upward reveal
- `b0ae9d06a` docs: record installer acceptance and packaged startup limits
- `83ddd5c38` test(linux): stop the full smoke process group before cleanup
- `8a0d2e89e` chore(code-oss): upgrade embedded runtime from 1.140.0 to VS Code 1.142.0
- `f861a0b2e` fix(exchange): serve portal styling and fonts under its strict policy
- `0931450fb` docs: record production recovery and final startup validation
- `641b9252b` fix(desktop): wait for backend listener before renderer authentication
- `9f6d494e8` perf(server): defer optional MCP SDK initialization
- `c83dd4845` fix(exchange): accept read-only platform secret mounts
- `826386073` Merge published 2.0.1 changes into the production fixes
- `b481ad4ab` release: prepare Tabs 2.0.1 workspace update
- `352602897` feat(web): add desktop extension management and project tool surface

### codex/codeoss-1.142-review-fixes

- `b3c6cb860` docs: update Code-OSS 1.142.0 audit, parity notes and fork inventory for native host repairs
- `6138b3485` test(desktop): add native contract smoke gate against compiled Code-OSS runtime
- `e25fd54dc` fix(desktop): wire Code-OSS 1.142 native host dispatch, activity lifecycle and shutdown joins
- `bc7791c75` fix(desktop): observe GPU compositing and recovery with disposable listeners
- `98ebd1d8d` fix(desktop): add cancellation, streaming progress and partial cleanup to native ZIP operations
- `5ae391d80` fix(desktop): adapt editor and Agents invitation coordination with registered window ownership
- `718ad5bdd` fix(desktop): persist typed coordinator counters and impressions in native code host storage
- `ad962be5d` test(desktop): use temporary fixtures in codeHostManager clean-checkout resolver tests
- `8a0d2e89e` chore(code-oss): upgrade embedded runtime from 1.140.0 to VS Code 1.142.0
