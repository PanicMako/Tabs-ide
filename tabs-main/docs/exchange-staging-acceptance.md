# Dedicated Exchange staging acceptance

Branch: `codex/tabs-extensions-testing`. Updated 1 October 2026.

The goal is a coherent developer-to-consumer staging product, not merely passing
package tests. No merge, public deployment, npm publication, or production
submission enablement is authorized by this report.

## Evidence established in the current continuation

- Downloaded SDK/CLI bundle: both React and HTML starters were installed, built,
  validated, packaged, inspected, and checked for deterministic output outside
  the repository. The tutorial fetches bundles through the frontend handler and
  checks their sizes and SHA-256 digests before extraction.
- Real Electron: the core isolation smoke completed; with the tutorial's
  optional Electron flag, the downloaded React starter rendered its heading,
  responded to its button, and reloaded through the host. The stale view was
  destroyed and a replacement rendered successfully.
- The complete optional tutorial also passed under Node 26.8.1, not just Bun.
  This proves the compiled CLI works in that observed Node environment; it is
  not a test of every supported Node version or operating system.
- The starter smoke no longer assumes SDK 1.6. Its expected API range comes from
  the downloaded release manifest. Enabling this check requires that version
  explicitly; omitting it fails rather than silently skipping compatibility.
- Dedicated reviewer UI now explains scan findings, requested access,
  comparison-release permission changes, dependency advisory coverage, storage
  migrations, package changes, and bounded text previews. Raw evidence remains
  available. Missing/failed scans do not imply unchanged permissions or safety.
- Reviewers can download archives for independent inspection and request an
  exact-digest rescan with a recorded reason. Backend state/membership/CSRF
  checks remain authoritative. There is no automatic mutation retry.
- Reviewer access failures clear the protected queue and offer reconnect
  guidance. Approval, signing/publication, and authenticated revocation remain
  distinct operations.
- Exchange package verification after the operational follow-up: 223 passed,
  21 skipped at that checkpoint. The latest security-controls run passed 227
  tests with 22 skipped. The skipped service
  integrations must be exercised explicitly; this result is not an integration
  or authenticated browser pass. Astro check: 51 files, no errors/warnings/hints.
- The fresh full workspace run after the earlier reviewer-evidence changes completed all 18
  test tasks (two cached) in 3m55s. The final fresh workspace typecheck completed
  all 16 tasks (none cached) in 1m19s. `vp check` reported zero errors and 426
  existing warnings. These results do not prove the unexercised browser and
  desktop acceptance journeys below.

## Reviewer operational follow-up

- The dedicated reviewer screen now presents server alerts, last activity in
  UTC, all four stored TUF-role expiry states, and exact pending revocation
  identities. It explicitly separates advisory expiry from signature validation
  and does not interpret operational readiness as a production certificate.
- Missing, malformed, duplicated or inconsistent operational evidence is
  rejected rather than displaying a healthy default. Truncated revocation lists
  show the remaining count. Late superseded responses cannot replace newer
  operational snapshots, and access expiry clears the protected view.
- Reviewer accounts gain a role-specific navigation entry. The link starts
  hidden and is reset on browser-cache restoration; backend authorization still
  protects every privileged route. Navigation visibility is not authorization.
- All 16 PostgreSQL/S3 service integrations passed, including parsing the actual
  operations response and denying that evidence to publisher/anonymous requests.
  Authentication used the local OAuth fixture, not a live GitHub account.
- Fresh workspace typecheck for this follow-up passed all 16 tasks. The default
  full-suite run failed on five-second CLI/ACP test timeouts while build and
  typecheck workloads ran concurrently; cancellation then produced worker pipe
  errors. The CLI workflow passed in isolation without assertion/timeout changes.
  A full `vp run test --concurrency=2` rerun is in progress; the failed run is
  retained and is not marked passed. Authenticated browser acceptance remains
  required.

## Reviewer security-controls follow-up

- `/admin/security` adds focused namespace verification, single-digest blocks,
  atomic 1–100-digest imports, current block evidence, and removal controls.
  Actions require reasons and explicit confirmations; failed or uncertain writes
  are not retried automatically. Block removal does not restore revoked releases.
- The batch parser is shared with the old portal, retaining its duplicate,
  entry-count and 64 KiB bounds. The server also rejects ownership-proof URLs
  containing credentials or fragments. No proof URL is fetched by the browser.
- All 17 PostgreSQL/S3 integrations passed, including these frontend-generated
  requests, publisher denial, namespace-verification history, and add/remove
  digest audit events. OAuth is a local fixture, not live GitHub proof.
- Exchange tests, Astro diagnostics and `vp check` passed. Full workspace
  verification remains open: the lower-concurrency run passed 17 of 18 tasks
  but two server WebSocket tests hit their existing 15-second deadlines. An
  isolated complete WebSocket-file run passed all 42 tests in 215 seconds with
  unchanged assertions and deadlines. This supports a concurrency-sensitive
  failure, not a proven root-cause repair. A full `vp run test --concurrency=1`
  rerun is live. Neither tests nor their limits were removed or relaxed.
- Fresh final typecheck passed all 16 workspace tasks without cache hits.
- The new controls still need authenticated browser/keyboard acceptance before
  the legacy portal can be retired. Code/API parity alone is insufficient.

Retained local output for the Node/Electron tutorial, Exchange tests, Astro
diagnostics, full workspace tests/typecheck and `vp check` is in the ignored directory
`.test-data/exchange-review-evidence-2026-10-01-kwiTgg/`. These logs contain local
fixture evidence, not production authentication or a final release certificate.

## Local browser fixture checkpoint (2026-10-02)

The isolated browser fixture uses a newly created PostgreSQL database and S3
bucket, real Exchange sessions and worker scanning, and explicitly fake OAuth
identities. It is guarded by both test mode and an explicit fixture flag and
rejects non-loopback infrastructure endpoints. It is not live GitHub evidence.

Browser observations verified anonymous Publish redirects to the local identity
selector, fake publisher sign-in returns to `/publish`, the account navigation
shows that publisher, upload remains disabled without namespace membership, and
namespace onboarding exposes labeled name, agreement, and invitation controls.
The fixture's original form CSP blocked the callback redirect across local
ports; its policy now permits only self and the exact local Exchange origin.
Agreement acceptance, namespace creation, upload, review, signing, and desktop
installation are not proven by these observations.

Further browser testing used synthetic agreement and namespace rows seeded only
in that fixture database; it does not establish agreement/namespace UI parity.
The actual file chooser selected `browser-tool-1.0.0.tabsext`, upload showed
100% progress and server-validation status, and acceptance redirected to the
exact-digest submission route. The real worker advanced the package to awaiting
manual review. The page displayed SHA-256
`98d0033ece017ef71703438acdb212b74253d437dab3d3c50bb3ab7919b9e875`,
Tabs range `>=1.3.0 <2.0.0`, and API range `^1.7.0`. Its scan-claimed timeline
was still reported as unrecorded; investigate this separately before timeline
acceptance. Review/signing/install/update remain unverified by this walkthrough.

The fixture guard suite passes all three tests and Exchange typecheck passes.
The retained `vp check` rerun completed with zero errors and 426 warnings;
the initial stdout-output panic was not counted as a pass. A fresh serial full
workspace run is recorded in `.test-data/exchange-full-workspace-2026-10-02.log`;
do not count it passed until its terminal result is inspected.

The missing scan timeline was traced to reuse of the renewable lease timestamp,
which is intentionally cleared after scanning. Additive `scan_started_at` and
`scan_completed_at` columns now retain the latest scan attempt independently;
publisher detail/status endpoints expose them and the native timeline labels
them as latest scan start/completion. No historical timestamps are fabricated.
All 17 real PostgreSQL/S3 service integration tests pass after this change,
including ordering and retained history with cleared lease/token assertions.
Exchange typecheck and Astro diagnostics (54 files, zero errors/warnings/hints)
also pass. The rebuilt browser view still needs to be exercised with a fresh
scan before counting the visual timeline repaired.

The local reviewer browser flow returned to `/admin` under the fake reviewer
identity, exposed requested access, scan findings, package changes and text
previews, and correctly flagged missing TUF roles. Exact-digest approval of the
sample recorded the fake reviewer, timestamp and reason in history. The UI
showed one approved release awaiting signed publication and the explicit
"Approval recorded. This is not publication" message; focus returned to Refresh
queue. This verifies the local browser decision path, not production review,
signing, publication, or independent security assessment of third-party code.

The one-shot fixture signing helper generated an in-memory ephemeral Ed25519
key and published all four TUF roles through the real verifier for the approved
sample. Its test trust root expires after 24 hours and is not a production root.
Browser navigation then displayed the public canonical listing, meaningful title,
stable release selector, exact digest, first-publication time, permissions, README,
and registry-specific installation guidance. This establishes local browser
upload -> worker scan -> browser approval -> signed publication -> listing.
It does not establish CLI parity or desktop installation/update acceptance.

Latest workspace validation: `vp run typecheck` passed all 16 tasks in 51.902s.
The retained serial workspace test run completed with 17/18 tasks successful;
the server package had 1847 passing tests, 27 skipped and one 15-second timeout
in `supports projects.readFile within the workspace root`. A focused rerun of
that unchanged test passed. This is evidence of a suite-sensitive deadline
failure, not proof of its cause or a full-suite pass. No test assertion/deadline
was relaxed. The signing-helper `vp check` passed with zero errors and 426
warnings in 2132 files.

The fresh cross-service integration run passed all five tests in 2.75s using
real PostgreSQL/S3, HTTPS certificate validation, CLI publishing, signed
metadata and desktop install services. Its Electron session/view objects are
mocked: these results support transport and service lifecycle behavior, not
real `WebContentsView` activation or keyboard acceptance. Keep that distinction
when combining this evidence with the separate Electron local-package smoke.

The refreshed real Electron smoke exited successfully: actual view sandboxing,
blocked loopback requests/popups/navigation, traversal/foreign-package denial,
profile-partition localStorage separation, stale activation guards and renderer
crash recovery were exercised. It still installs a local package rather than
the signed registry release, and does not establish keyboard-only acceptance.
Retained output: `.test-data/exchange-electron-security-2026-10-02.log`.

Visual redesign checkpoint: the shared rounded puzzle/inset SVG rendered in
the built Exchange header. Catalog state tests (two tests), Astro diagnostics
(55 files, zero errors/warnings/hints), the Exchange build and `vp check`
(zero errors, 426 warnings) passed for the shared mark. The homepage search
addition also passed Astro/build checks. In the actual browser, entering
`reviewing` and pressing Return navigated to `/extensions?q=reviewing` and found
the signed fixture whose description alone contains that term. Refresh preserved
the query/result and Back restored the homepage search value. This covers that
specific search/history path, not all category/sort/request-race cases or the
complete visual redesign.

The earlier serial full-suite process handle and temporary log were unavailable
on continuation. That run is not counted as a verified pass.

## Acceptance still required

The following work has not been established by the evidence above. Existing code
or historical tests may cover portions; inspect and exercise them before marking
each requirement accepted.

- Authenticated browser publisher journey: sign in, return route, agreement,
  namespace, known-account collaboration, accessible upload/cancellation,
  uncertain upload recovery, and submission polling/timeline.
- Authenticated reviewer journey: exact-digest decisions, readable evidence,
  rescan, archive download, appeals, and expired/removed reviewer access.
- Administrative parity: authenticated browser verification of namespace
  verification, digest blocks/removal/imports, operational presentation and
  reviewer navigation. Keep the legacy portal until parity
  is verified, then retire duplicate routes without losing workflows.
- Browser and CLI submission of the same package through the real service,
  followed by scan, approval, offline signing, and public discovery.
- A second clean desktop environment installs that signed release, then
  updates/rolls back while preserving project grants and separate Work/Personal
  profiles. Electron view loading alone is not this acceptance test.
- Desktop keyboard activation, focus restoration, and denied-permission
  interaction; browser mobile navigation, keyboard publishing, visible focus,
  and screen-reader progress/error behavior.
- Catalog back/forward/refresh, cancellation races, large release histories,
  reviewed screenshots, stable/prerelease selection, private listing metadata,
  and trusted installation instructions in the actual browser.
- Every documented command and SDK example, not just the quickstart and
  generated-reference/link checks.
- Canonical marketing redirects and legacy-link preservation against trusted
  instance configuration; self-hosted branding/docs/support in deployed assets.
- Private registry enumeration/assets/download/TUF authentication, expiration,
  membership removal, redirect/caching isolation, and reconnect behavior.
- Fresh security regressions and operational backup/restore, signing rotation,
  revocation and self-hosting drills; the full current workspace suite,
  `vp check`, and `vp run typecheck`.
- Final user walkthrough, retained evidence, current limitations, and a branch
  diff ready for testing. Do not use temporary logs as the only durable handoff.

### 2026-10-02 resources and navigation checkpoint

- Added `/resources` with developer toolkit, publishing/account, operator/API,
  contribution, and private vulnerability-reporting guidance. Header and footer
  expose the page; the footer now links to the browsable API reference.
- Unconfigured support is explicitly labeled. No working group, sponsor program,
  status service, confidential inbox, bounty or response deadline is invented.
- Route tests: 12 passed, including exact resources routes and traversal
  rejection. Astro diagnostics: 56 files, zero errors/warnings/hints. Frontend
  build passed. `vp check`: zero errors, 426 warnings across 2,134 files.
- Browser/mobile/keyboard acceptance of this new page remains unverified;
  the complete redesign and optional footer game are not complete.

### 2026-10-02 shared-shell visual and resources verification

- Shared browsing shell now has larger typography, rounded controls, a framed
  publisher-account link, and an oversized instance-name footer signature.
  The signature is restricted to home/catalog/detail pages; publisher, account,
  reviewer and documentation pages retain a task-focused footer.
- Static preview browser verification reached Resources using header navigation.
  At 390 x 844, Resources had no horizontal overflow. Tab reached the skip
  link, and Enter moved focus to `main`. This is not a full screen-reader audit.
- Built-page verifier now checks resource destinations and signature scope on
  seven page types. It passed alongside 12 frontend route tests. Astro: 56 files,
  zero diagnostics. Build passed; `vp check`: zero errors/426 warnings;
  `vp run typecheck`: 16/16 successful. The full workspace suite still has the
  previously recorded server read-file timeout; it is not declared green.
- Static preview has no registry API and is used only for visual/navigation
  verification. Live publishing and private authentication require the real API.

### 2026-10-02 opt-in Exchange footer puzzle

- Added an optional Connect the tools puzzle below the browsing-page signature.
  Its logic is dynamically imported on disclosure opening. There are no timers,
  animations, remote services, account requests, persistence, audio or tracking.
  It does not appear on publisher, account, reviewer or documentation screens.
- Rules tests cover solvability, permutation validation, fixed endpoints, invalid
  swaps and arrow navigation. Built-page verification checks puzzle presence
  alongside signature scope. Actual browser keyboard run solved the puzzle in
  three swaps, announced success, reset the board, and closed with Escape while
  restoring focus to the disclosure.
- Exchange suite: 50 files passed, 2 integration files skipped by their normal
  environment gates; 236 tests passed, 22 skipped. This is not a new real-service
  integration run. Astro: 59 files, zero diagnostics; build and documentation
  verifier passed; `vp check`: zero errors, 426 warnings; typecheck 16/16 passed.
- Marketing footer integration, phone-width/touch puzzle checks, and a real
  screen-reader run are still pending. The broader marketplace acceptance goal
  remains incomplete.

### 2026-10-02 live-registry real Electron checkpoint

- Cross-service acceptance now launches a separate clean real Electron process
  against the live PostgreSQL/S3/HTTPS Exchange after exact-digest review and
  signed publication of versions 1.0.0 and 1.1.0. It provisions the root from
  test fixture bytes, verifies TLS with its ephemeral CA, and prohibits transport
  origin escapes. It does not disable certificate validation.
- The consumer discovers, prepares and installs 1.0.0 through production signed
  installation services, activates the actual sandboxed WebContentsView, checks
  Node unavailability, separates Work/Personal localStorage, discovers and
  installs a permission-neutral update, reactivates both profiles, and checks
  partition data plus project-grant assignment retention.
- Initial failures exposed a fixture heading mismatch and an attempted silent
  update while a view remained active. The harness now uses the real heading and
  hides the active view before confirming at a safe activation boundary; host
  protections were not weakened. The full cross-service file passed 5 tests.
  Current typechecks passed 16/16. This is stronger than combining separate mock
  registry and local-package view tests, but not complete product acceptance.
- Still missing here: actual Tabs React install/consent UI, keyboard focus flows,
  host-storage/credential denial and preservation, and failed-update rollback in
  this combined real Electron path. Local test OAuth is not live GitHub proof.

### 2026-10-02 marketing alignment direction

- Inspected the live buildwithtabs.com homepage in the browser and its local
  Headspace / Edition Two source. Exchange now uses the same background, blue,
  ink and muted tokens, plus a centered oversized headline with italic serif
  accent. Browser-rendered homepage was inspected after rebuilding.
- This is initial visual alignment, not finished parity across all screens.
  Exact self-hosted font distribution remains pending; the serif currently falls
  back to Georgia when Instrument Serif is unavailable. Astro, build and
  repository checks passed with zero errors (426 existing warnings).
- User revised the game direction to a Tabs-themed Dino-style runner. The
  implemented tile puzzle remains a predecessor until the runner, accessible
  untimed alternative, and shared marketing-footer integration are verified.

### 2026-10-02 user-directed footer and radius correction

- User explicitly deferred game work. Removed game imports/rendering from both
  website footers, preserving draft sources for their later redesign. The overall
  marketplace goal is not paused. Built-page verification rejects a visible game.
- Exchange controls and surfaces now use one `--radius: 12px` token rather than
  mixed pill/8/10/20px corners. Added regressions for the token, no gradients,
  and absence of game imports/rendering in both website layouts.
- Browsing-page footer now has oversized blue Tabs / Exchange lettering and a
  marketing-style baseline. Custom registry names remain supported. Browser
  computed styles confirmed nine homepage controls/surfaces at 12px and the
  signature at rgb(50, 89, 237). At 390px, document width and content width both
  remained 390px; no horizontal overflow was observed.
- Exchange Astro diagnostics: 59 files, zero errors/warnings/hints. Both sites
  built, the documentation verifier passed, the two design tests passed, and
  workspace typecheck passed 16/16. This is not full staging acceptance.
- The `4323` preview is static visual verification only: account/catalog API
  operations need the separately running real registry, not this preview server.

## Latest staging checkpoint: Concept One and failure recovery

- The later user request supersedes the historical 12px/white-footer checkpoint:
  shared controls now use a 999px pill token, multiline surfaces use 28px, the
  header rule/active underlines are gone, and every page has a Concept One blue
  footer with oversized pale-blue lettering. The marketing custom cursor is
  reused with keyboard/text-entry/touch/reduced-motion fallback. No gradients or
  mounted game were added. Account and documentation mobile checks found no
  horizontal overflow at 390px.
- Publishing now separates identity/terms from package selection and shows
  scan, manual-review, and signed-publication guidance. A local fixture account
  without namespace membership remained gated. This check did not submit a new
  package or prove a live GitHub login. Developer cards link to real built guides.
- Documentation search/copy/navigation were restyled without replacing the
  generated references. Browser `profile` search returned 12 anchored sections.
  Malformed API and documentation-index responses now provide safe recovery
  guidance rather than raw parser/server diagnostics. Latest Exchange suite:
  251 passed, 22 normally gated integration tests skipped; Astro 59 files without
  diagnostics; build/docs verifier passed; typecheck 16/16; check zero errors,
  426 existing warnings. This is not a full workspace pass.
- Combined live HTTPS/real Electron acceptance now also verifies failed-entry
  rollback and Work/Personal partition/grant retention. Explicit retry currently
  requires moving the failed digest extraction aside in the disposable harness;
  it does not prove an automatic user-facing retry. The cross-service suite
  passed five tests. Host credentials and actual React consent/focus flows remain
  outstanding in this combined path.
- The fresh full workspace suite finished with 17/18 tasks passing. The former
  file-read failure passed in 4.967s; a different WebSocket startup test
  (malformed-keybindings fallback) hit its unchanged 15s deadline. That test
  passed in isolation (6.93s test execution). The cause remains unproven; neither
  isolated success nor the other green packages establishes a full-suite pass.

### Rollback retry follow-up

The host now moves a failed update extraction into an identity-checked recovery
directory after restoring and persisting the prior version. It retains the
failed bytes rather than deleting profile/account data. A retry freshly extracts
the signed archive; the real Electron harness no longer performs a manual
extraction move. This supersedes the retry limitation recorded above. Desktop
manager tests passed 65 cases, including retry and an external-symlink boundary;
live PostgreSQL/S3/HTTPS/real Electron cross-service tests passed five cases.
Actual React consent/focus acceptance and full-suite stability remain pending.

## External public-launch gates

Production GitHub OAuth, publisher agreements, storage and worker ownership,
signing custody, distributed client trust roots, abuse handling, monitoring,
privacy/support ownership, and operational recovery remain explicit launch
gates. Local OAuth fixtures must be labeled as fixtures, never live GitHub proof.
Staging acceptance does not enable a public launch automatically.

# WebSocket fixture isolation checkpoint

The opt-in startup trace identified dependency construction, rather than HTTP
startup, as the slow phase. The transport fixture constructed the built-in
native agent catalog despite supplying explicit transport provider statuses.
`wsServer.test.ts` now supplies an empty native-driver catalog only in that test
module, retaining real registry/hydration and orchestration wiring. Native
driver, registry, and hydration tests are not mocked by this file-scoped change.
No test deadline or expected assertion was relaxed.

The complete 42-test WebSocket file passed in 6.80 seconds (3.35 seconds in
tests); the final traced dependency construction was 27ms and HTTP ready 52ms.
Evidence: `.test-data/exchange-ws-isolated-drivers.log`. The fresh full workspace
run finished successfully: 18/18 tasks, two cached, in 1m0.216s. Server coverage
was 228 passing files, five pre-existing skipped files, 1,848 passing tests and
27 pre-existing skips. All 42 WebSocket tests passed under workspace load;
dedicated native-driver and registry tests also ran outside the fixture mock.
Evidence: `.test-data/exchange-full-workspace-isolated-drivers.log`. This
supersedes the preceding intermittent timeout results, not the remaining
desktop UX, executable documentation, operational, or external launch gates.

# Executable SDK documentation checkpoint

`packages/extension-api/test/documentation.test.ts` extracts the five usage
snippets directly from the documentation source, typechecks them against the
distributed SDK declaration, and executes each with a typed controlled bridge
fixture. It verifies storage calls, Git invocation, network credential options,
logic arguments, and the workspace denial catch path. The two generated source
excerpts are classified separately, not represented as runnable tutorials.
Seven tests pass. This proves example syntax/API alignment and fixture behavior,
not production broker enforcement, real credentials, or Electron integration.

The audit also found and repaired token-page instructions naming the nonexistent
`tabs-extension` executable. The release package exposes `tabsext`; the page
now uses it for search and publishing, guarded by a package-bin regression test.
Five Exchange design checks and the updated frontend build pass. Automated
coverage of every documented command and real-host execution remains incomplete.

# Real Electron SDK storage and signed lifecycle checkpoint

The local-package Electron smoke harness now extracts the exact storage example
from the generated documentation and executes it in a real sandboxed view
through the production preload, synthetic host IPC transport, and production
manager/storage. It verifies host-storage Work/Personal isolation, project-grant
revocation after reactivation, preserved data after regrant, and crash recovery.
The zero-permission public starter is unchanged; a copied test package declares
storage. `.test-data/exchange-real-sdk-storage-retry.log` reports PASS and
`documentedStorageExampleVerified: true`. The first attempt exposed a harness
error (calling a retired view after assignment change), corrected without
weakening the host lifecycle.

The signed HTTPS Exchange/Electron harness now checks both browser localStorage
and host profile storage. It verifies denied access before granting the second
project, distinct Work/Personal data after explicit grants, and retained host
storage and assignments through failed-load rollback and verified update retry.
The dedicated Colima test profile was stopped; its existing PostgreSQL/S3
services were restarted without deleting data. The prerequisite failure is
retained in `.test-data/exchange-real-sdk-signed-storage.log`; the retry passed
all five cross-service tests in 8.08 seconds, recorded in
`.test-data/exchange-real-sdk-signed-storage-retry.log`.

Workspace tests passed 18/18 tasks; typecheck passed 16/16; hygiene reports zero
errors and existing warnings. Evidence logs use the `exchange-real-sdk-signed-`
prefix. This still does not prove actual Tabs React installation consent,
keyboard focus restoration, live GitHub OAuth, secure credential preservation,
or every remaining SDK example against real resource brokers.

## Fresh standalone tutorial and development-watch checkpoint

Ran `TABS_TUTORIAL_ELECTRON=1 bun scripts/verify-extension-tutorial.mjs`
against the current developer release. The verifier downloads the bundle from
the local Exchange frontend, checks advertised digests, and installs its CLI
outside the checkout. Both React and HTML starters built, validated, packed
deterministically and passed inspection and npm audit at the high threshold.
The React starter passed the real Electron sandbox/load/reload checks and the
documented host-storage example, including denied grants and profile isolation.

The verifier now also runs the distributed `tabsext dev` for both templates,
changes a source heading, waits for the new text in packaged assets, and checks
that the CLI responds to SIGTERM. Cleanup is bounded to the verifier-owned
process group. This proves CLI cancellation response, not that every descendant
process necessarily exits without the verifier's group cleanup. A first attempt
left the test heading in place and failed the independent Electron heading
assertion; the verifier now restores and rebuilds the original starter before
that check. No production assertion was relaxed.

Fresh evidence: `.test-data/exchange-fresh-developer-tutorial.log` and
`.test-data/exchange-developer-watch-tutorial-retry.log`. The expanded retry
exited zero. Workspace tests passed 18/18 tasks; typecheck passed 16/16; final
vp check passed with zero errors and 426 existing warnings. This does not
exercise publishing, live OAuth, every documented CLI command, Windows process
cleanup, or actual Tabs React install-consent interactions. Those acceptance
items remain open.

## October 3: typography, controls, roles and recovery follow-up

The shared Exchange shell now bundles DM Sans from the licensed Fontsource
package instead of merely declaring an unavailable font. The official footer
wordmark uses near-viewport width, measured fitting, and a scaled gap; browser
inspection confirmed equal small outer margins and a single baseline. Shared
entrance/control motion is enabled only when reduced motion is not requested.

Custom select controls preserve native form values while adding a styled
combobox/listbox interaction. Browser inspection verified catalog keyboard
selection, URL changes and Escape. Five DOM regression tests cover committing
values, cancellation, dynamic options, validation announcements, disabled
controls and disposal. This is not proof of every account form's authenticated
browser journey or a VoiceOver audit.

Explicit operator configuration and transactional reviewer delegation are now
implemented. The database-backed service suite verifies authorization, CSRF,
concurrent idempotent grants, audit events and revocation of existing sessions.
The `/admin/reviewers` interface is implemented, but its authenticated keyboard
acceptance remains open. No real operator account has been assigned.

Backup format 3 retains 18 tables, including reviewer assignments and events.
The local PostgreSQL/S3 service suite verifies those rows survive restoration
into fresh services. Unit tests verify versions 1/2 without reviewer tables do
not invent access. Logs: `.test-data/exchange-reviewer-restore-unit.log` and
`.test-data/exchange-reviewer-restore-service.log`. This does not establish a
production cold-backup drill, managed-provider recovery, or live OAuth success.
