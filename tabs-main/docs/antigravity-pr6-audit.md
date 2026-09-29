# PR 6 independent audit

Reviewed PR: https://github.com/mxyxyz9/Tabs-ide/pull/6

PR head: `5d50bf1f9732502b26c7c3f0500503fc83eac9d8`

PR base: `941285bacc3be103985973e6d44c196e8109f15b`

Repair candidate: `codex/tabs-exchange-audit-repairs`, including `e601fe7d` and
the subsequent cross-service teardown repair. The Antigravity branch, the
existing extensions branch, and main were not merged or modified by this audit.

## Verdict

Do not merge the submitted PR head unchanged. The isolated repair candidate
addresses the confirmed code defects and misleading test assertions found in
this review, and is suitable for the next integration checkpoint. Production
launch remains unverified. The repository-wide formatting gate also remains
red on 23 files outside this repair set.

## Confirmed findings and repairs

- Removed environment-controlled HTTP exceptions from the desktop trust,
  package download, and signed-metadata hint paths. The local cross-service
  harness uses HTTPS with its own temporary certificate authority.
- Fixed view activation settlement and cancellation, stale bounds and hide
  requests, and installation unnecessarily closing another extension's view.
- Repaired backup validation, quoted restored column identifiers, included
  namespace membership audit rows, and restored serial sequence state. The
  documentation now identifies the helper as a small offline drill and explains
  that database and object storage restoration is not one atomic transaction.
- Made live integration suites opt-in. Their explicit commands fail when the
  required services are unavailable; ordinary tests report them as skipped.
- Replaced the alleged upload membership race with a live test that removes
  membership after preflight and before upload commit.
- Strengthened Electron smoke assertions with a listening network canary,
  installed foreign package, actual CSS response and computed style, browser
  storage isolation, stale bounds, and recovery checks. Timing and memory
  descriptions now state what was actually measured.
- Replaced an unused expired-metadata fixture with signed rollback and expiry
  responses consumed by the TUF client. Offline classification now also runs
  through installed-extension status handling.
- Added Work and Personal storage checks to the cross-service flow and canceled
  the staged permission-increasing update when consent is declined.
- Fixed package output containment through a symlinked destination parent.
  Archive fixtures now write outside their source directories, and a regression
  test covers the alias bypass.
- Removed shell interpolation from temporary certificate generation and checked
  OpenSSL failures. Closed the prerequisite PostgreSQL probe in a finally block.
- Removed the forced database drop from cross-service teardown. Concurrent live
  suites previously reproduced a PostgreSQL administrator-termination error
  after assertions passed; four consecutive concurrent runs passed afterward.

## Verification

| Check                                                   | Observed result                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| Full `vp run test`                                      | 17/17 package tasks passed                                              |
| `vp run typecheck`                                      | 15/15 packages passed                                                   |
| Desktop unit/integration suite                          | 542 passed                                                              |
| Extension package suite                                 | 9 passed                                                                |
| Ordinary Exchange suite                                 | 107 passed; 17 live cases skipped explicitly                            |
| `test:integration` with local PostgreSQL/S3             | 12 passed                                                               |
| `test:cross-integration` with local HTTPS/PostgreSQL/S3 | 5 passed                                                                |
| Both live suites concurrently after teardown repair     | Four consecutive runs passed                                            |
| Live command with unavailable PostgreSQL                | Failed with prerequisite instructions                                   |
| Ordinary Exchange suite with unavailable PostgreSQL     | Passed, with live suites skipped                                        |
| Focused Chromium accessibility/browser tests            | 3 passed across two files                                               |
| Actual Electron extension smoke                         | 13/13 stages passed                                                     |
| Formatting/lint for changed repair files                | Passed                                                                  |
| Full `vp check`                                         | Failed on 23 unrelated formatting files; untouched PR branch also fails |

The full server suite takes approximately four minutes here; its quiet reporter
was initially mistaken for a stall. A completed standalone run passed 1,848
tests, and the subsequent full workspace run completed successfully.

The Git pre-commit hook invokes the separate Code-OSS hygiene runner and fails
before checking files because its `event-stream` dependency is missing. The
final local audit commit bypasses that hook after the Tabs formatting/lint and
typecheck commands pass; this is not a successful Code-OSS hygiene result.

## What the evidence does and does not cover

The cross-service suite runs actual Exchange routes, scanning, PostgreSQL,
S3-compatible storage, HTTPS, TUF verification, package download/extraction, and
desktop install/state code. Its Electron view and view coordinator are mocked.
It does not exercise real main-process IPC registration or the React desktop
installation UI.

The Electron smoke test runs a real packaged extension in a real WebContentsView
and verifies renderer isolation, restricted requests, project/profile browser
storage, crash containment, and manager recovery. Its host is synthetic and
intercepts an attempted error IPC send. It does not connect Electron to the live
Exchange or prove delivery to the React retry UI. The Chromium component tests
cover that UI separately with a mocked bridge.

The cross-service update test calls the manager's update completion method
directly. Separate manager tests cover first-load failure and rollback, but the
cross-service test is not proof of an actual Electron update activation.
Likewise, the cross-service revocation flow verifies signed target removal and
then invokes manager revocation explicitly; it does not prove the full automatic
SSE/poll-to-active-view path in a running Tabs application.

TLS verification is configured with certificate verification enabled and the
temporary CA, and the real HTTPS path passed. The report's phrase "100% strict
TLS" exceeds the tested scope: this test is not a complete certificate-policy
or production transport audit.

Production TUF keys and signing ceremony, GitHub OAuth credentials, approved
publisher terms, Render/R2 deployment, live provider compatibility, external
monitoring, and a cold production backup/restore drill remain external launch
requirements. These tests do not establish that the whole original Extensions
and Exchange product plan is complete.

## Changed-file audit coverage

All 34 files in the PR diff were inspected, including all added test bodies and
the generated performance report:

- Desktop package scripts; performance script/report; Electron smoke launcher
  and runner; desktop lifecycle integration suite.
- Desktop trust configuration, signed package download, metadata hints, TUF
  client, extension view manager and its tests, main IPC handlers, and preload.
- Exchange test Compose configuration, package scripts, OAuth fixture routing,
  configuration, backup/restore, operational alerts, and all four new Exchange
  composition/service/hardening/cross-service test files.
- Extension tool surface and browser tests; Extensions settings and its unit
  and browser tests.
- Exchange and extensions documentation, root package scripts, extension view
  contracts, and IPC contracts.

The PR head was rechecked during review and remained `5d50bf1f`. Its GitHub
checks are Vercel preview checks, not evidence of the local test commands above.
