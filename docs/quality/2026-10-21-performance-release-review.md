# Performance and release review - 21 October 2026

## Release decision

Not yet ready to declare the complete application production-ready. Cold startup
still exceeds the requested half-second target, and Exchange metadata renewal is
not deployed. This report reconciles earlier work with current source and live
checks; it does not turn historical passing tests into proof of current production
behavior. The current GitHub desktop release is v2.0.1. Its tag is commit
b481ad4ab6a84d873990a74cd098aff46446385a. GitHub's comparison shows the
availability branch 16 commits ahead and two behind that tag: the released
extension-management UI commit 352602897e3b79a639cbf5fd5f5e10357d04eaa1 and
the version/release-notes commit. PR #35 carries that release line; #36 and its
#37/#38 stack follow a parallel line. Reconcile these before choosing the final
release source, rather than cutting a release from an older package version.

## Cold startup

The original airport animation and its exit behavior remain unchanged. No timer
was added to keep the animation on screen. Optional onboarding audio initialization
now waits until the existing airport exit completes and an idle opportunity
after a frame. An explicit dismissal notification uses the existing exit timer;
it does not extend startup or animation timing. Its
subscription/frame/idle callback are cancelled on cleanup; a pending audio resume
cannot start the music after cancellation. Music and the existing controls remain.

Desktop and backend bundles strip whitespace/comments while preserving function
and class names, without enabling extra compression or identifier mangling.
Desktop main output falls from 3.47 MB to 2.38 MB. Source maps remain enabled.

Matched runs use the same checkout, executable, runtime, machine and startup
harness, with five separate disposable profiles and compile caches per build.
The compiled embedded Code-OSS runtime is explicitly enabled. Builds, test runs
and CPU profiling were stopped during these measurements. Each process group and
profile is disposable. The measurement is process spawn to the existing observed
workspace-interactive signal, not animation duration or editor-tab readiness.

| Fresh-profile run | Before (seconds) | After (seconds) |
| ----------------- | ---------------- | --------------- |
| 1                 | 3.287            | 2.879           |
| 2                 | 2.858            | 2.342           |
| 3                 | 2.298            | 2.356           |
| 4                 | 2.274            | 2.328           |
| 5                 | 2.481            | 2.539           |
| Median            | 2.481            | 2.356           |

The observed median difference is 125 ms, about 5%. Some individual samples are
slower. This small local sample does not establish a universal or per-change
speedup, and remains far from 0.5 seconds. A preliminary comparison that also
lazily imported the first-run wizard is excluded: that approach was not retained,
because changing when a visible screen loads complicates the readiness comparison.

A final confirmation on the built current checkout, including the existing UI
work and the final exit notification, recorded 2.412, 2.055 and 2.057 seconds
(median 2.057 seconds), with builds, tests and profiling stopped. This is a separate
checkout/source confirmation, not an additional matched before/after speedup.
An earlier confirmation, started alongside a formatting check, recorded a 6.212s
outlier including 2.378s before JavaScript entry, then 2.056s and 2.045s. It is
retained in the raw evidence but excluded from the clean confirmation above.
First executable/native-entry variability remains unresolved.

Every disposable probe reached the existing two-second backend shutdown deadline
with its renderer connection still open. The harness then cleaned up the process
group. This is recorded separately from startup and is not claimed as a shutdown
fix.

Separate diagnostic CPU profiles identified backend module compilation and Effect
schema construction as substantial startup CPU costs. They also found audio-device
initialization on the first-run renderer path. Diagnostic runs are not timing
samples. Their profiling interval includes shutdown, so compile-cache persistence
observed there is not presented as a startup cost.

Native launch, Electron initialization, backend import/evaluation and snapshot
hydration still need architectural work to approach the requested target. Showing
a window within half a second would not prove that the workspace is usable.
Existing large-workspace, slower-hardware and signed-installer measurements remain
necessary; this run uses fresh empty profiles and does not claim those results.

## Recovered Exchange requirements and live status

The earlier Exchange dashboard discussion, launch-status records, developer/public
workflow guide and current implementation agree on the following requirements.
Anonymous HTTP checks were repeated against exchange.buildwithtabs.com.

| Requirement                                     | Current evidence                                                                               | Status                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Public discovery without login                  | `/v1/registry`: public, anonymous-read                                                         | Enabled live                                                     |
| Other developers can submit                     | publishingEnabled and namespaceManagementEnabled are true                                      | Enabled live; uploads remain authenticated                       |
| Review every extension version                  | reviewRequired is true; decisions bind exact version and digest                                | Implemented; new versions require their own review               |
| Publish reviewed versions securely              | Signed publication validates reviewed bytes and identity                                       | Implemented; approval alone is not publication                   |
| Keep existing approval while renewing freshness | PR #38 renews only previously published approved targets                                       | Implemented and tested; not deployed                             |
| Automatic freshness for public downloads        | Live timestamp is still version 1, expired 2026-10-20T08:52:25.938Z                            | Production blocker                                               |
| One-time non-root signer setup                  | Local export matches live root, includes only targets/snapshot/timestamp, mode 0600            | Export ready; host secret provisioning pending                   |
| Developer agent copy button                     | Live `/developers` shows populated instructions and reports successful copy                    | Present live                                                     |
| Clipboard failure recovery                      | Focus/select fallback is covered by new UI tests                                               | Regression coverage added                                        |
| Downloadable SDK and CLI                        | Live manifest and 24,202-byte bundle; SHA-256 matches manifest                                 | Download verified                                                |
| Shipped developer compatibility                 | Manifest labels bundle experimental-staging and requires a compatible Tabs 2.0.0 testing build | Reconcile with tested release before general-availability claims |

The automated browser's separate clipboard bridge returned empty text despite the
page's success status. Exact clipboard transfer and permission-denied fallback are
therefore verified in controlled UI tests, not claimed as a live OS-clipboard test.
No extension was uploaded, approved, revoked or published during this review.

A source bug was corrected: the developer page called its instructions editable
but marked the textarea read-only. The revised field accepts edits and the copy
action uses that exact edited text. The production page still has the old markup
until deployment; the corrected behavior is tested locally.

Production renewal requires deploying PR #38 and its prerequisites to the actual
registry service, mounting the exported non-root keys as a protected secret, setting
EXCHANGE_ONLINE_SIGNING_KEY_FILE, and testing an anonymous install after renewal.
The encrypted backup and root private key must stay local. Creating a desktop
release or merging a branch alone does not configure the registry host.

## Application checks and remaining gates

A fresh independent Vite development server and disposable Electron profile were
used for console and airport-animation ordering checks. Holding the workspace
import is an appearance-order test only, not a startup benchmark. Native/development
warnings remain visible; they are not silently suppressed.

The existing production-readiness work covers companion shortcuts, failed queue
sends, environment-aware routing, manual-scroll preservation, extension uninstall
storage isolation and browser workflows. Those features still require appropriate
release-artifact acceptance; no claim is made that every possible application
interaction has been exercised.

The primary checkout also contains 42 pre-existing modified web files plus
untracked UI/extension work. These were preserved. They must be reviewed and
validated as part of whichever source is actually released; validation of an
isolated release checkout does not certify separate uncommitted work.

The primary-checkout browser run found a regression in the separate UI work:
New Thread had a hardcoded macOS shortcut and no configured-shortcut tooltip.
Both now derive from the configured binding while retaining the current styling.
Three existing UI files also needed formatting only. These corrections remain
with the preserved UI work rather than staging that entire redesign into this PR.

## Verification results

- Isolated workspace run: all 18 tasks passed, including 7,561 server tests,
  644 desktop tests, 1,685 web tests and 542 Exchange tests. Existing 35 server and
  24 external-service Exchange skips remain. Later lifecycle and editable-field
  follow-ups passed focused tests; current-checkout checks cover final web source.
- Current checkout, including existing UI work: final web unit run passed
  1,689 tests in 224 files; final browser run passed 169 tests in 51 files.
  The initial browser run reproduced two shortcut-label failures; they were fixed
  before the complete passing rerun. Expected fixture router warnings and the
  intentionally simulated storage-quota error remain visible.
- Final current-checkout typecheck: all 16 tasks passed. Final desktop build:
  all four tasks passed. `vp check`: zero errors, 661 existing warnings.
- Exchange portal build passed. Astro checked 119 files with zero errors,
  warnings or hints. The editable field was exercised in the built local browser
  preview; clipboard denial/focus/select are covered by UI tests.
- Built-server RPC acceptance passed bootstrap, authentication, Git stage/unstage/checkout/diff/commit/push/pull against disposable
  repositories, option-injection rejection, terminal listing and support export.
- Final fresh Vite/Electron console audit: zero renderer exceptions and zero
  console errors. Original airport tiles appeared while the application import
  was held. Development/native diagnostics remain visible. The first harness
  cleanup raced a disposable-profile writer; deletion retry fixed the harness,
  and the final audit completed successfully.
- Release packaging smoke checks passed. VS Code pre-commit hygiene ran and
  found no staged files within its checkout; app lint/format checks use `vp check`.

The full current-checkout workspace run also passed all 18 tasks, including
7,561 server tests, 644 desktop tests, 1,687 web tests and 543 Exchange tests.
The later two lifecycle tests are included in the separate final 1,689-test web
run above. Existing skipped external-service and headless-shell cases remain.
No production deployment, merge, tag or new desktop release was performed.
