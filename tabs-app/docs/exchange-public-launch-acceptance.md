# Exchange public-launch acceptance

Checkpoint: 2026-10-03, `codex/tabs-exchange-claude-ui`. This is an incomplete
acceptance report. Changes remain uncommitted; nothing has been merged,
deployed, enabled for public submissions, or published to npm.

## Deployment direction

The user requires the existing `buildwithtabs.com` domain and no purchase of
another domain. `exchange.buildwithtabs.com` would be a subdomain of that
existing domain, not another domain registration. It is a proposed canonical
registry origin, not a provisioned service. A `/exchange` path deployment is
not currently supported: the frontend, OAuth callbacks, API routes, and desktop
registry trust assume an origin-root deployment. The marketing build currently
produces a static Vercel Build Output API artifact. The registry API and scan
worker are separate persistent Bun processes with PostgreSQL and private S3
storage; placing static pages on Vercel does not provision those services.

GitHub CLI authentication reports `PanicMako`, numeric ID `121330302`. This
identifies the locally authenticated CLI account; the user has now confirmed that identity as the owner/operator. The ignored
0600 `apps/exchange/.env.local` records the owner ID and a private local
acceptance origin (`http://localhost:8787`). The owner saved the OAuth secret
privately; the real local server and Operator session are now verified. Dedicated
local PostgreSQL and S3 resources are provisioned by the acceptance launcher.
The owner signed into GitHub and explicitly approved registration of app
`3902038`; its ownership and exact localhost redirect were verified in the
browser. The Client ID and secret are saved locally without being printed in reports. The walkthrough
is in `docs/exchange-github-setup.md`.

## Verified in this checkpoint

- The documentation search now uses a roomy, styled dialog, five topic filters,
  real indexed sections, highlighted text, safe text-node rendering, and direct
  section links. Live browser checks exercised filtering, arrow-key navigation,
  Escape, close-button focus restoration, and a 390 px mobile viewport.
- The homepage now uses a static illustration of building a custom tool,
  placing it alongside Code/Browser/Terminal, and sharing it through Exchange.
  It has a complete accessible description and no mock interactive controls.
  Live viewport checks at 1440 px and 390 px showed no horizontal page overflow.
- Fixed a deployment gap: Compose now passes `EXCHANGE_OPERATOR_GITHUB_IDS` to
  both API and worker. Configured reviewer accounts are optional, enabling an
  operator-only bootstrap without assigning static legacy reviewers.
  All configured role IDs are trimmed and validated as numeric GitHub IDs.
  Origins with embedded credentials, non-root paths, or non-HTTP localhost
  schemes are rejected. Five config tests cover these invariants.
- Integration prerequisite diagnostics no longer print connection URLs,
  passwords embedded in URLs, or raw service errors.
- Started the existing dedicated `tabs-exchange-tests` Colima profile and its
  loopback-only test PostgreSQL/S3 containers. No production resources were used.
- `bun run --cwd apps/exchange test:integration`: 18 passed against real local
  PostgreSQL and S3-compatible storage, with fixture OAuth identities.
- `bun run --cwd apps/exchange test:cross-integration`: five passed against the
  local services with HTTPS, signed metadata, CLI and desktop integrations.
  The workflow includes an Electron subprocess assertion. This is not a
  complete walkthrough of the actual production React desktop UI.
- `vp run test`: all 18 workspace tasks passed (two cached) after the changes.
  A simultaneous typecheck/test run first exceeded the SDK documentation test's
  five-second timeout; the subsequent full run without concurrent typechecking
  passed. No test assertions were weakened.
- `vp run typecheck`: all 16 tasks passed without cache.
- `bun run --cwd apps/exchange check:web`: the latest subpage checkpoint covered
  81 files, zero errors/warnings/hints.
- `bun run --cwd apps/exchange build:web`: successful.
- Scoped `vp check` and `git diff --check` passed.

Command logs for this local run are under `/tmp/tabs-exchange-redesign/`:
`launch-service-integration.log`, `launch-cross-integration.log`, `hero-tests.log`,
`hero-typecheck.log`, `hero-astro.log`, and `hero-build.log`. Temporary logs are
supporting evidence, not durable production acceptance artifacts.

## Recovery and developer-workflow follow-up

- Fixed the documentation verifier's stale API-parameter markup assumptions;
  it verifies required path labels, the endpoint filter, 10 documentation pages,
  all 53 indexed section/API targets, local assets and developer downloads.
  The redesigned resources page retains confidential-reporting guidance.
- Executed `bun scripts/verify-extension-tutorial.mjs` against the current
  downloaded SDK/CLI bundle. Both React and HTML starters passed install/build,
  validate/pack/inspect, deterministic output, watch rebuild and cancellation
  on this macOS host. This run did not enable the optional Electron check and
  does not establish Windows or actual resource-broker acceptance.
- Added `test:recovery`: an explicitly enabled cold drill using the dedicated
  loopback test Compose PostgreSQL and S3 services. No API/worker/signer runs in
  its source or restore environments. A real PostgreSQL custom-format dump and
  disk-backed package copy restore into fresh empty services. All 22 public
  tables compare exactly; the one review-stage archive passes digest/size/key
  verification. Audit sequences continue after restore.
- Added `recovery:invalidate-credentials --confirm-offline-restore`, and included
  it in the cold-restore instructions. One transaction deletes restored sessions
  and OAuth states and revokes active tokens. The drill proves old session and
  token replay fail, newly issued credentials work, and invalidation is
  idempotent. Unit checks cover rollback on failure.
- Local cold-drill report: `.test-data/exchange-cold-recovery-w5NVhK/report.json`.
  It is fixture evidence, not production disaster recovery or signing-key custody.
- Actual real-account signed recovery follow-up (2026-10-03T22:27:54Z):
  stopped the private HTTP API/worker and read-only TLS registry, verified zero
  other database connections, then captured the actual acceptance database and
  its two package objects. Restored into new empty local database/bucket resources;
  all 22 tables matched exactly before credential invalidation. Both packages
  passed canonical-key, byte-size and SHA-256 verification, including rejected
  1.0.0 and signed/published 1.0.1. All four signed metadata roles were byte-identical
  to the offline ceremony output. The original services were restarted against
  their existing resources; source login state and publication were preserved.
- Exercised `apps/desktop/src/trustedExchange.ts` against the restored registry at
  an isolated HTTPS localhost endpoint using explicit local-CA validation and the
  independently pinned initial root. It resolved signed 1.0.1, excluded rejected
  1.0.0, and downloaded the exact 1900-byte signed target digest. Anonymous access
  and revoked clone-only bearer tokens returned 401; a fresh clone-only read token
  worked. All clone credentials were invalidated afterward. Controlled tokens
  were generated only inside the restored copy and never printed or persisted as
  plaintext. This proves the production trust verifier and restored private
  transport, not the still-pending actual native desktop UI journey.
- Operational root rotation on that restored actual-data clone also passed:
  generated distinct new Ed25519 keys for all four roles; rejected a root signed
  only by the old key and confirmed no database metadata changed; then published
  root version 2 signed by both old and new root keys with version-2 role metadata.
  The same already-trusting production desktop verifier advanced its existing
  cache from root 1 to root 2 without rebootstrap, removed the old root key, rejected
  a replayed version-1 timestamp and recovered with fresh version-2 metadata.
  This threshold-one local ceremony does not establish production key custody,
  distribution, quorum controls or native desktop acceptance.
- Actual recovery evidence: `.test-data/exchange-real-github/cold-restore-efEjj6/report.json`.
  Private dump/object files use mode 0600 under a mode-0700 directory; clone
  database/bucket are retained for further drills. This remains local evidence,
  not production disaster recovery or signing-key custody.
- The marketing custom cursor is adapted for Exchange with text/disabled-control
  fallbacks, keyboard/reduced-motion/touch handling, and native-dialog top-layer
  placement. The footer uses Concept One's saturated blue and pale wordmark.
  The default Exchange suite now passes 308 tests (24 skipped); recovery passes
  separately. Fresh final typecheck passes all 16 tasks; Astro check covers 83 files with
  zero errors/warnings/hints; web build and documentation verifier pass. Scoped
  lint has zero errors and one existing control-regex warning. Full workspace
  verification passes all 18 tasks (two cached) after these follow-up edits.

## Real account and authenticated design follow-up

- The owner saved the OAuth client secret privately. Real GitHub authorization
  requested public data only, with no repository scopes. PanicMako signed in as
  Operator. The actual reviewer access, audit history, review queue, and security
  endpoints loaded. Logout removed privileged access; returning GitHub login
  restored it. No reviewer grant/revoke has been performed. The owner explicitly
  approved terms version 2026-09-24 for private local testing; acceptance was
  recorded as PanicMako at 2026-10-03T17:08:48.073Z.
- Added a private localhost acceptance launcher with isolated retained database
  and bucket identities, a real scan worker, loopback-only listeners, and guards
  against remote services, fixture authentication, mismatched resources, and
  missing owner/OAuth settings. Publishing stays off by default. The current
  loopback acceptance process uses `--enable-private-submissions`, restricted
  to this isolated local instance; public submissions remain disabled.
- Redesigned review, reviewer access, registry security, publisher overview,
  namespaces, submissions/details, CLI tokens, and advanced controls. Illustrated
  workflow/identity/access scenes describe capabilities, not fabricated accounts
  or releases. The review queue places packages first and displays a real empty
  state. Audit rows separate identity, access, actor, time, and reason.
- The backend now serves the styled publisher and draft terms routes. The full
  existing publisher form contracts and credential handling remain intact;
  contract tests verify every legacy control ID is preserved exactly once. Legacy
  fallback files remain available. The original draft legal wording is preserved.
- Footer CTA uses white liquid waves with blue text, including keyboard focus and
  a reduced-motion fallback. Existing Publish design is retained.
- Actual browser checks covered owner access, confirmation preview/cancellation,
  Escape focus restoration, all publisher routes and all review routes at 390px,
  and footer animation. No page overflow was found. This is not a screen-reader
  or second-account permissions acceptance.
- Fresh checks: 312 Exchange tests pass (24 skipped), all 18 workspace test tasks
  pass (two cached), all 16 typecheck tasks pass, Astro reports 86 files with zero
  errors/warnings/hints, scoped lint/format and web build pass. Documentation
  verifier checks 10 pages and 53 targets. Logs: `/tmp/tabs-exchange-redesign/`.

## Focused workspaces and real publishing follow-up

- Advanced now opens one task at a time: namespace/team, tokens, upload,
  submissions, appeals and role-authorized review/security controls. Existing
  control IDs and form behavior remain; role-hidden panels are never revealed
  by local navigation. No-JavaScript fallback retains the available form set.
- Review separates package inspection, health, history and appeals. The health
  advisory remains outside the selected pane. Query and version filters apply
  only to the explicitly loaded queue, with distinct empty and no-match states.
- Reviewer access has a guided workbench, visible operator/reviewer boundaries,
  action-specific confirmation and usable empty team/history states. Shared
  button motion, keyboard focus and reduced-motion behavior remain in use.
- The real PanicMako session created `panicmako-local-test`, built an HTML tool
  using the locally served SDK, and uploaded `workspace-note@1.0.0` through the
  browser. The scan passed and the downloaded quarantine archive matched digest
  `76add80cb64b440d69aa22c26671ce71ab2ea6edc74c2b231f6b09b3ffd52ca5`.
- A deliberate rejection drill recorded the correction reason in the publisher
  view. The corrected note interaction was rebuilt as `1.0.1`, uploaded, scanned,
  independently downloaded and inspected. Digest:
  `def38791a02ae0010e2299e955806008b0b2304d1269df88c01b8c84ad4abd1a`.
  Real browser approval at 2026-10-03T17:32:00.843Z shows
  **Approved; awaiting signed publication** at that checkpoint. The subsequent
  private signing ceremony below published version 1.0.1; 1.0.0 remains rejected.
- Desktop-width and 390px browser checks covered focus movement, keeping form
  values across tasks, live queue matching/no-match, and no horizontal overflow.
  Unit tests cover role changes, malformed fragments, old anchors, history and
  motion cancellation. This is not full screen-reader acceptance.
- Current checks: 317 Exchange tests pass (24 skipped); all 18 workspace test
  tasks pass; all 16 typecheck tasks pass. Astro checks 89 files with zero
  errors/warnings/hints. Web build, scoped format/lint, documentation verification
  and `git diff --check` pass. Logs: `/tmp/tabs-exchange-redesign/control-room-*`.

## Private signed publication and dashboard checkpoint (2026-10-04)

- Exported the real approved 1.0.1 target after rechecking its stored package
  digest. Distinct local Ed25519 root, targets, snapshot and timestamp keys
  signed metadata outside the API/worker. Publication validated metadata and
  committed at 2026-10-03T17:40:04.121Z. The real publisher view reports signed
  publication, and `/extensions/panicmako-local-test/workspace-note` displays the
  published release. The rejected 1.0.0 version is excluded. This registry is
  private and loopback-only; this is not public launch acceptance.
- The independently checked local root pin is
  `0a9971222d8ea180550a16b9f10bb3d616b27e4b699ce2d771bc5f822be753be`.
  These short-lived single-key test roles do not establish production custody.
- A read-only HTTPS endpoint on `https://localhost:9443` shares the isolated
  registry resources. Its dedicated test CA verifies successfully; anonymous
  catalog requests return 401. The actual isolated Tabs runtime started with
  that CA and root pin. CUA could not bind its native window, and the private
  desktop read credential handoff remains pending. No installation, permission,
  project/profile, update, rollback or uninstall UI acceptance is claimed.
- Publisher and operator routes now share a dedicated dashboard shell with a
  compact account header, role-aware sidebar and a small documentation footer.
  Existing forms and advanced capabilities remain. Main destinations were
  checked in the real signed-in browser at 1440 and 390px: no horizontal page
  overflow and the footer below content. Advanced navigation now occupies normal
  layout flow instead of overlapping shorter panels and their footer.
- The overview uses three equal action cards with concise copy. Mobile/tablet
  navigation opens a blue full-screen panel, blocks background interaction,
  traps keyboard focus, supports Escape and restores focus. The hamburger is
  beside the logo. Public pages use the same mobile navigation pattern.
- Account disclosures show the GitHub username and profile photo, with a safe
  initial fallback and no referrer sent for the image. Only GitHub and its avatar
  host were added to the frontend image policy. The real profile image loaded.
  Removed the account disclosure's inherited animated-button styling that made
  hover text disappear. Category filtering now uses the shared custom select;
  arbitrary publisher category slugs remain available through Other category
  and direct filter links. Keyboard selection was exercised against real data.
- SVG arrows align to their controls. Selected options use a checkmark and
  pointer navigation maintains one active highlight. Focus outlines use blue.
- Tabs desktop discovery now has publisher and requested-access filters over
  explicitly loaded results, including clear/no-match states and pagination
  guidance. Display names remain primary; technical IDs are disclosed separately.
  This change has unit coverage; its actual native desktop UI remains unaccepted.
- Final dashboard checks: 323 Exchange tests pass (24 skipped), all 18 workspace
  test tasks pass (one cached), and all 16 typecheck tasks pass without cache.
  Astro checks 94 files with zero errors, warnings or hints. Web build, docs
  verification and `git diff --check` pass. Workspace `vp check` exits successfully
  with no errors and the existing 425 warnings. Logs are the `dashboard-*` files
  under `/tmp/tabs-exchange-redesign/`. Browser checks also verified the real avatar,
  category keyboard filtering, menu focus wrapping/Escape, and centered button
  arrows. This remains an incomplete public-launch acceptance report.

## Publishing control audit follow-up

- Source review found that dropping multiple files after a valid selection left
  the earlier archive internally selected while showing an error. The upload
  controller now clears both that archive and its visible summary, disables
  submission, and refuses to send a stale package.
- Submit readiness now requires an eligible account, namespace, accepted terms,
  and valid package, with no active upload. Namespace/terms changes update the
  control immediately. Cancelling while agreement recording or digest calculation
  is pending prevents the package request; completed/error paths hide the old
  progress meter. Small-package summaries use bytes/KiB rather than rounding to
  zero MiB.
- Four publishing UI tests pass, including stale-file rejection, prerequisite
  changes, cancellation before package transmission, and disabled drop targets.
  The real owner browser session showed disabled submission initially, enabled
  submission after choosing its existing namespace and archive, and keyboard Tab
  focus on the ready submit control. The selected 1900-byte archive displays
  `1.86 KiB`. No duplicate submission or new agreement was sent by this check.
- Browser proof: `publishing-prerequisites-focus.png` in the retained visualizations
  directory. These checks supplement prior actual publishing evidence; they do
  not establish complete screen-reader or authenticated-route acceptance.

## Documented samples and real broker follow-up

- Executed all six sample package validation/packing commands for Tabs 1.3.17,
  inspected every archive, and packed each sample twice into fresh destinations:
  Hello, Workspace Reader, GitHub Profile, Git Status, Calculator and Project
  Companion. All 24 CLI invocations passed; repeat archives matched SHA-256.
- Exercised the current production workspace reader against separate local Work
  and Personal roots. Both read their own README; an outside symlink and a `..`
  traversal were denied. Exercised the current Git-status broker against a real
  local repository in dirty and clean states, with a fixed branch, and verified
  that a directory outside any Git repository is rejected.
- Called the current network broker with its default transport against GitHub's
  public `/users/PanicMako` endpoint: real DNS resolution, pinned HTTPS request,
  certificate validation and owner-ID match passed. An undeclared host and
  loopback destination were rejected. No token was submitted; this does not
  establish the GitHub Profile sample's credentialed `/user` workflow.
- Executed the Calculator and Project Companion package logic in the actual
  disposable QuickJS-in-WASM worker. Arithmetic/text results matched, oversized
  sample input was denied, and Node/network/host-bridge globals were absent.
- Evidence: `.test-data/sdk-resource-acceptance-20261004/run-Zng9YC/report.json`.
  These were direct production broker and worker calls on macOS. Electron views,
  IPC/grant authorization, OS credential persistence, profile-specific real
  accounts and Windows development-process cleanup still require acceptance.
- Revalidated the isolated desktop process: its terminal session remains live.
  Native computer-use binding to the exact acceptance-app path still times out;
  an observation failure was not treated as a terminated process or used to
  justify restarting it.

## Token-secret lifecycle audit follow-up

- Source review found a late-response race: hiding or navigating away from the
  token page cleared its secret field, but a pending creation response could
  subsequently reveal the secret again. A concealment generation now invalidates
  pending reveals when the page is hidden, navigated away from, or explicitly
  concealed. Returning to the page before the response cannot restore that reveal.
- A concealed successful response leaves the secret blank and advises refreshing
  the token list and revoking the newly created token before another attempt.
  No real token was created or inspected during this audit.
- Three regression tests pass with synthetic response tokens: late pagehide,
  hide-and-return during creation, and ordinary visible completion followed by
  navigation. Ordinary completion still focuses the secret heading. This adds
  lifecycle coverage; it does not prove OS credential persistence or the pending
  real private-registry credential handoff.

- Fresh combined-worktree verification after the token lifecycle fix: all 18
  workspace test tasks passed (two cached), including 328 Exchange tests with 24
  opt-in cases skipped; all 16 typecheck tasks passed with no cache. Astro checked
  94 files with zero errors/warnings/hints; web build and the 10-page/53-target
  documentation verifier passed. `vp check` reported zero errors and 425 existing
  warnings; `git diff --check` was clean. These checks do not replace the explicit
  real-user, native desktop, Windows, screen-reader and production gates below.
  Logs: `/tmp/tabs-exchange-redesign/sdk-broker-final-*.log`.

## Real publishing update follow-up

- Built `workspace-note@1.0.2` from the downloaded HTML starter project, adding
  only an in-memory word count. No capabilities or network hosts were added.
  Validation, packing and inspection passed: 2043 bytes, digest
  `a389b193dfffedb7cc12e85424345f5656c8988e9af8d1d5fb13123ebd84385d`.
- The actual PanicMako browser session submitted the update at
  2026-10-03T22:50:52.959Z. Scanning completed at 22:50:53.355Z. The review desk
  displayed comparison with approved 1.0.1: zero permission changes, zero added
  or removed files, and three modified files (`dist/app.js`, README and manifest).
  Independently downloaded quarantine bytes matched the expected digest and
  every reviewed source file. Actual review approval was recorded at
  2026-10-03T22:51:32.129Z with that inspection reason.
- Published version-2 targets/snapshot/timestamp metadata using the existing
  pinned root and distinct offline role keys. The publication gate verified
  signatures, approved identities and package storage. Signed targets retain
  1.0.1 and add 1.0.2; the derived latest head is 1.0.2, and rejected 1.0.0 is
  excluded. First publication of 1.0.2 was recorded at 22:52:41.417Z.
- The actual publisher page displayed **Published in signed metadata**. The
  listing selected 1.0.2 as latest, and lazy-loaded published history showed
  exactly 1.0.2 and 1.0.1. Opening the older release retained its original digest,
  README and first-publication timestamp. This is browser release selection,
  not desktop update/rollback acceptance.
- Publish now reuses the server-confirmed acceptance of the current terms rather
  than recording it again on every upload. A regression test verifies that a
  subsequent upload makes no agreement POST. The actual owner's agreement
  remains dated 2026-10-03T17:08:48.073Z; no new legal acceptance was submitted.
- Evidence: `.test-data/exchange-real-github/publish-update-report.json` and
  `private-signed-update-102.png` in the retained visualizations directory.
  This registry remains private and local. No public deployment, submissions,
  npm publication, trust-root replacement or automatic merge occurred.

- Fresh verification after the agreement-reuse change and actual update:
  all 18 workspace test tasks and all 16 typecheck tasks passed; 329 Exchange
  tests passed with 24 opt-in tests skipped. Astro checked 94 files with no
  diagnostics; build and documentation verifier passed. `vp check` reported
  zero errors and 425 existing warnings; diff whitespace was clean. Logs:
  `/tmp/tabs-exchange-redesign/publishing-update-*.log`.
- The README heading finding below was corrected in the subsequent accessibility
  follow-up; complete screen-reader acceptance still remains open.

## Listing heading accessibility follow-up

- Packaged README headings now nest under the listing's Overview section instead
  of restarting the page outline at level 1. The renderer accepts a bounded
  heading context; Exchange requests level 3, preserves relative heading depths,
  and caps deep headings at level 6. Documents starting at level 2 also begin at
  level 3 in this context. Other renderer callers retain their default headings.
- Three new DOM tests verify hierarchy, inline-content retention, context limits,
  unchanged default rendering, inert raw HTML, exact packaged-image handling and
  safe links. The existing Markdown boundary tests also pass.
- The real private 1.0.2 listing's accessibility tree shows its page title at level
  1, Overview at level 2 and packaged README title at level 3. DOM inspection
  confirms exactly one level-one heading. Browser proof:
  `listing-readme-heading-context.png` in the retained visualizations directory.
  This verifies the outline exposed to assistive technology, not a completed
  VoiceOver/screen-reader walkthrough.

## GitHub sign-in recovery follow-up

- Browser sign-in failures now redirect to a styled `/sign-in` recovery page with
  bounded cancellation, expired-link, private-account-denial and unavailable-service
  guidance. The retry link preserves only a validated task destination. Provider
  error descriptions and exception details never enter the recovery URL or page.
- State and cookie validation still precede database consumption and provider
  requests. A valid cancellation consumes the one-time state without a token
  exchange. Expired or mismatched attempts never reach GitHub; private-account
  denial creates neither a user nor a session. Recovery clears only the OAuth
  attempt cookie, preserving any existing session.
- Focused auth, frontend-route and recovery UI tests pass (30 tests total,
  including 11 new recovery cases). The real private server's missing-state
  callback opens the expired-link page, retains the signed-in PanicMako profile,
  and exposes a keyboard-reachable retry link. Desktop and narrow layouts were
  visually checked; proof is `sign-in-recovery.png` in the retained visualization
  directory. Cancellation, denied-account and transport-failure cases are
  controlled tests, not a new live provider-denial walkthrough.
- Exchange Astro checking reports zero errors, warnings or hints across 96 files;
  frontend build and Exchange typechecking pass. The full workspace test run
  passes all 18 tasks (2 cached), and all 16 workspace typecheck tasks pass.
  `vp check` reports zero errors and 425 existing warnings across 2210 files.
  A final complete production acceptance remains open.

## Authenticated review keyboard follow-up

- Revalidated the existing actual isolated desktop runtime (session 73057) and
  HTTPS registry (session 73946): both process handles remain running. Native
  inventory identifies the running Tabs application, but binding its exact
  worktree `.electron-runtime/Tabs.app` still times out. The app was not restarted
  because of this observation failure. Native installation acceptance and the
  user-saved private read-token handoff remain outstanding.
- Reproduced a real authenticated Reviewer Access bug: refreshing assignments
  left `document.activeElement` on the body. Loading now returns focus to Refresh
  after completion; expired access focuses reconnect, and lost privileges focus
  the status explanation. Deliberate focus moves during loading are respected.
- Applied equivalent recovery to the review queue and to privileged-view removal
  during asynchronous operational checks. Failed decisions that require reconnect
  focus the visible recovery control rather than returning to a removed view.
- Live PanicMako checks confirm `roles-refresh` and `review-refresh` retain focus
  after their corresponding reloads. Existing role assignments and release
  decisions were not changed. Browser proof: `reviewer-refresh-focus.png`.
- Thirteen focused tests pass, including eight new refresh focus cases. Exchange
  typechecking, frontend build, Astro checking (96 files; zero errors, warnings
  or hints), and `git diff --check` pass. `vp check` reports zero errors and the
  same 425 existing warnings across 2211 files. These checks do not constitute
  a VoiceOver walkthrough or a second real reviewer's grant/revoke acceptance.
- The live queue audit identified release headings at level 2 beneath the
  level-2 Packages to inspect section; the subsequent follow-up below corrects
  and verifies this hierarchy.

## Review-desk heading hierarchy follow-up

- Individual release headings now use level 3 beneath the level-2 package desk.
  Pending-package manifest and scan sections use level 4 beneath their release.
  Targeted CSS preserves readable sizing and wrapping for long release names.
- A rendering test covers pending and approved release identities, the enclosing
  level-2 section, level-3 releases, level-4 evidence and retained decision forms.
  The focused queue/evidence suite passes all eight tests. Exchange typechecking,
  frontend build, Astro checking (96 files; zero errors, warnings or hints),
  `vp check` (zero errors, 425 existing warnings) and `git diff --check` pass.
- The real signed-in PanicMako queue exposes Review desk at level 1, Packages to
  inspect at level 2, and both approved versions at level 3. Browser and read-only
  DOM evidence agree. Following the Package desk link focuses its named section.
  Proof: `review-heading-hierarchy.png`. The current live queue has no pending
  submissions, so the level-4 evidence hierarchy is covered by the rendering
  test rather than a new live pending-package submission. Complete screen-reader
  acceptance remains open.
- Fresh combined verification after the heading and focus changes passes all 18
  workspace test tasks (2 cached) and all 16 typecheck tasks (none cached).
  Exchange reports 352 passing tests and 24 explicitly skipped integration tests.
  The documentation verifier passes all 10 pages and 53 section/API targets.
  Logs: `/tmp/tabs-exchange-redesign/review-heading-workspace-tests.log`,
  `review-heading-workspace-types.log` and `review-heading-docs.log`. Skipped
  opt-in integration cases and green source checks do not replace the remaining
  actual-user, native UI, Windows, screen-reader or production launch gates.

## Documented-command execution follow-up

- Found and corrected an executable-instruction mismatch: the Development page's
  HTML initialization command omitted the required desktop target. The original
  command fails before creating a project; the corrected command succeeds. Also
  updated the CLI README's old 1.6.0 SDK path to current 1.7.0, removed its false
  default-target claim, and clarified project-target requirements for publishing
  and future npm instructions.
- Executed the actual npm-installed CLI executable under Node v26.8.1 in a fresh
  folder: current tarball installation, React initialization with local SDK and
  explicit target, npm install/build, validation, packing and archive inspection
  all pass. This supplements the existing source/Bun and downloaded-bundle tests.
- Ran the corrected HTML init/install/build/validate/pack workflow in another
  fresh folder. Re-ran the downloaded-bundle tutorial: both templates pass
  standalone install/build/validate/pack/inspect, deterministic output, watch
  rebuild and cancellation on macOS. Native Electron loading remains unchecked.
- The current installed executable's `registry` command succeeds against the
  actual private HTTPS registry with explicit validated test CA and no token.
  `curl --fail` health verification also passes on the real HTTP service.
  Neither read-only result proves protected catalog search or CLI publishing.
- Added [the command-acceptance ledger](exchange-command-acceptance.md) with
  command-specific execution evidence and explicit remaining token, native,
  Windows and production-operation requirements. No npm publication occurred.
- CLI workflow tests (3), marketing typechecking, Exchange Astro checking,
  rebuilt frontend, documentation verifier, `vp check` and `git diff --check`
  pass. Live Development documentation shows the corrected HTML command.
  Browser proof: `documentation-html-command.png`. Supporting command logs and
  report locations are listed in the ledger.

## Registry-security lifecycle follow-up

- Source audit found that security mutations lacked navigation cancellation and
  their finalizers unconditionally moved focus to Refresh. A history-restored
  page could also skip evidence loading while an old mutation remained pending.
- Security mutations now carry their own abort signal. Page navigation invalidates
  the generation, aborts pending reads and mutations, and releases the stale busy
  state. A restored page reloads authorization and evidence; late mutation results
  cannot change the restored view, release a newer action's busy state, or steal
  focus. No automatic mutation retry is made. A restored page warns that an
  interrupted request may already have been accepted and directs the reviewer to
  inspect refreshed evidence and audit records before retrying.
- Refresh restores focus to its button, expired access focuses reconnect, and
  loss of reviewer privileges focuses the status explanation. Deliberate focus
  moves during a request are respected.
- Five controlled DOM/transport tests cover refresh, expired access, lost
  privileges, abort/history restore with a late response, and deliberate focus
  movement. All pass. Exchange typechecking, frontend build, Astro checks (96
  files; zero errors, warnings or hints), `vp check` (zero errors, 425 existing
  warnings) and `git diff --check` pass.
- The actual signed-in PanicMako security page loads zero current digest blocks;
  read-only refresh returns focus to `security-refresh`, keeps the privileged
  content visible, and exposes status through `role=status`. Proof:
  `security-refresh-focus.png`. No live verification, block, unblock or role
  change was made; controlled lifecycle tests are not actual-user security-action
  acceptance or a complete screen-reader walkthrough.
- CUA's current inventory still identifies running Tabs but exposes no native
  window identity suitable for direct selection. This leaves the previously
  verified desktop process running and the actual desktop UI journey outstanding.
- Fresh combined verification passes all 18 workspace test tasks (2 cached) and
  all 16 typecheck tasks (none cached). Exchange has 357 passing tests and 24
  explicitly skipped integration tests. Logs: `/tmp/tabs-exchange-redesign/`
  `security-lifecycle-workspace-tests.log` and
  `security-lifecycle-workspace-types.log`. The remaining actual-user and
  production requirements below remain open.

## Advanced publisher credential follow-up

- The retained advanced publisher route still runs `src/publisher.js`. Control-ID
  parity did not prove lifecycle parity: its token handler lacked concealment
  on page hide and could reveal a response after a hidden page returned.
- The advanced handler now clears displayed tokens on navigation, visibility
  loss and manual dismissal; concealment invalidates any pending reveal. A
  creation response received after concealment never enters the token field and
  directs the user to reload the list and revoke the unrecoverable token before
  creating another. New creation clears older visible credentials, rejects
  malformed responses and prevents duplicate submissions while pending.
- Five controlled tests exercise late responses after navigation and hide/return,
  normal reveal followed by concealment, manual dismissal/duplicate creation,
  and malformed responses. Combined with the newer token UI and frontend route
  parity tests, all 21 focused tests pass. Synthetic credentials remain confined
  to tests; no actual token was created, read or revoked for this follow-up.
- The actual signed-in PanicMako advanced page loads its namespace and CLI-access
  panels. The token result is hidden and its value is empty on initial load.
  Proof: `advanced-token-controls.png`. This only verifies loading and initial
  state; real credential creation remains a user handoff and OS persistence
  remains unverified.
- Fresh combined checks pass all 18 workspace test tasks (2 cached) and all 16
  typecheck tasks (none cached). Focused fixtures use the legacy body without
  unrelated stylesheet loading. The publisher browser module has a declaration
  identifying its side-effect-only interface. Logs:
  `/tmp/tabs-exchange-redesign/advanced-token-tests.log`,
  `advanced-token-workspace-tests.log` and `advanced-token-workspace-types.log`.
  Legacy controls remain; retirement is not authorized by these limited checks.

## Advanced publisher transport follow-up

- Independent source review found that the retained publisher JSON helper used
  default redirect following and unbounded response parsing. It also displayed
  arbitrary upstream error text instead of the bounded shared recovery guidance.
- The advanced publisher now reuses the newer dashboard's API helper for JSON
  requests, token revocation and sign-out. It retains the existing form payloads
  while gaining same-origin credentials, session CSRF binding, redirect rejection,
  no-store requests, request deadlines, bounded UTF-8/JSON response reading and
  canonical safe error guidance. Sign-out now checks the server response rather
  than reloading after an unchecked HTTP failure.
- The web build emits a browser bundle at `apps/exchange/dist/publisher.js` and
  the server serves it at the existing `/publisher.js` URL. This includes its
  shared dependencies without exposing TypeScript imports to the browser. The
  documented `dev`/portal and Docker build paths execute that web build. Existing
  publisher controls and legacy fallback HTML remain; this is not their retirement.
  The separate XHR archive-upload progress path is outside this JSON-transport
  change and still needs complete legacy flow acceptance.
- Added three controlled cases for advanced CSRF/transport options, upstream
  error redaction and oversized-response rejection. The combined advanced token,
  API-boundary and frontend parity suite passes all 32 tests. No real token was
  created, read or revoked and no live security decision was changed.
- Revalidated both local service handles before deliberately restarting them to
  load the changed asset mapping. The retained real database/bucket and signing
  identity were reused. HTTP acceptance is session 16111; read-only HTTPS registry
  is session 70881. This was a code-change restart, not a response to an observation
  timeout. The native desktop was not restarted.
- The real signed-in PanicMako advanced token panel loads via the compiled script;
  identity and controls remain visible, with token result hidden and value empty.
  Proof: `advanced-shared-transport.png`. Real token creation remains a user handoff.
- Fresh web build, all 18 workspace test tasks (2 cached), all 16 typecheck tasks
  (none cached), `vp check` (zero errors, 425 existing warnings) and
  `git diff --check` pass. Logs: `/tmp/tabs-exchange-redesign/advanced-transport-*`.

## Remaining acceptance requirements

| Requirement                               | Current evidence                                                                                                                                   | Required next evidence                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Independent redesign review               | Search behavior, mobile and desktop views, relevant tests, broad workspace verification                                                            | Complete source/behavior audit of all routes and authenticated roles                                                            |
| Real GitHub sign-in                       | Real app 3902038; saved secret works; PanicMako login, logout, denied privileged access after logout, and returning login verified                 | OAuth error walkthrough and separate production OAuth setup                                                                     |
| Operator/reviewer management              | Real GitHub owner session identifies PanicMako as Operator; review queue and access/audit endpoints load                                           | Actual grant/revoke/history walkthrough with a second signed-in account                                                         |
| Publishing, rejection, correction, update | Real owner initial journey, rejection/correction, and 1.0.2 update through scan/inspection/review/signing/latest and older private listings pass   | Real desktop update/rollback acceptance and eventual public-origin validation                                                   |
| Tabs desktop UI                           | Local cross-service workflow and Electron harness pass                                                                                             | Actual settings/discovery/install/consent/project/profile/update/rollback/uninstall UI acceptance                               |
| Developer commands and SDK examples       | Downloaded SDK tutorial, all six sample CLI packages, direct production filesystem/Git/network brokers and sample logic workers pass on macOS      | Actual native sample views/IPC, credentialed Work/Personal account calls and OS persistence; Windows process cleanup on Windows |
| Accessibility                             | Docs keyboard/focus and mobile checked; UI behavior tests pass                                                                                     | Screen-reader walkthrough, authenticated publisher/operator/reviewer flows, and complete focus audit                            |
| Private credentials and revocation        | Automated cross-service/security tests                                                                                                             | User-visible connection/revocation UI, OS credential persistence and recovery acceptance                                        |
| Root rotation                             | Actual-data local clone ceremony, old/new signature gate, already-trusting production verifier and timestamp replay rejection pass                 | Production key custody, quorum and root distribution; actual native desktop acceptance                                          |
| Backup and restore                        | Actual real-account signed cold restore: 22 tables, both package hashes, production trust verifier over validated TLS, clone token revocation pass | Production recovery, signing-key custody and actual native desktop UI acceptance                                                |
| Final combined branch                     | Current worktree tests pass                                                                                                                        | Combined branch reviewed and fully verified; no automatic merge; legacy parity proved before removal                            |
| Public operations                         | Source defaults submissions off; no deployment                                                                                                     | Hosting/database/storage/OAuth setup, final terms/privacy/support/owners, staffed review, monitoring, abuse/incident procedures |
| Launch approval                           | No release action taken                                                                                                                            | Explicit approval for deployment, enabling public submissions, and npm publication independently                                |

Do not interpret automated fixture identities, mocked SDK brokers, frontend-only
Astro previews, or a green default test suite as real-user or production acceptance.

## Retained advanced upload follow-up

The retained publisher upload form now guards against duplicate submit events and publishing-disabled submissions, rejects empty archives, clears stale file selection after a multi-file drop, hides progress after completion or failure, and handles XHR aborts with explicit guidance to inspect submissions before retrying an immutable version. HTTP failures use shared canonical recovery guidance instead of exposing arbitrary upstream diagnostics. Completed responses over one MiB of text or without a version and SHA-256 digest are rejected before announcing success. The XHR progress transport remains in place; its completed-response check is not a streaming memory bound or a redirect prohibition.

Five controlled DOM/XHR tests cover duplicate submission, success cleanup, network interruption, abort recovery, diagnostic redaction, empty archives, and oversized completed responses. The combined focused upload/token suite passed 13 tests. Browser assets rebuilt successfully; all 16 workspace typecheck tasks passed, and lint returned zero errors with 425 existing warnings. The first concurrent full test run hit the existing CLI workflow's five-second timeout and cancelled dependent tasks; the reduced-concurrency full rerun passed all 18 workspace test tasks (two cached), including 370 Exchange tests with 24 intentionally gated integration tests skipped. No real upload, credential creation, or registry mutation was performed in this follow-up. Legacy pages remain retained pending complete parity acceptance.

Logs: `/tmp/tabs-exchange-redesign/advanced-upload-{tests,build,types,check,workspace-tests,workspace-tests-rerun}.log`.

## Native acceptance resumption audit

Re-polled the existing actual desktop handle `73057`: it remains live. Process
inspection independently confirmed the worktree Electron main and server child,
and the local HTTP and read-only HTTPS registry processes. CUA inventory reports
Tabs running but exposes no window IDs; binding the exact worktree app path still
returns an observation timeout. Binding `com.tabs.app` is explicitly ambiguous
between the worktree runtime and `/Applications/Tabs.app`. No process was restarted
and no credential was read, created, entered, or revoked. Requested the owner to
bring the development window forward and report whether Settings → Extensions
opens.

The source-level walkthrough in [exchange-desktop-acceptance.md](exchange-desktop-acceptance.md)
records exact controls and acceptance criteria for the remaining native journey.
Inspection of `ExtensionsSettings.tsx` and `extensionViewManager.ts` confirms that
rollback is automatic on failed first activation, not a manual Settings action;
checkpoint commitment follows successful activation. Discovery installs the
latest listed version and has no historical-version picker. A current-version
install cannot establish update/rollback acceptance; a prior signed installation
or subsequent reviewed signed local release and a bounded first-load failure
exercise are still needed. This audit changes the next native verification steps,
but does not prove the native journey itself. Documentation formatting and
`git diff --check` pass; no application source changed in this resumption audit.

## Namespace creation readiness audit

The redesigned namespace creation handler now requires loaded publishing-enabled
account state, a valid form, and explicitly checked publisher terms. It captures
the name and terms version before sending, locks all inputs while creation and
membership refresh are pending, and ignores duplicate submit events. Initial
markup disables its controls until account readiness is known. A 401 conceals
account controls, leaves creation disabled, and restores focus to the reconnect
link. The server remains authoritative for terms and membership enforcement.

Four controlled DOM tests cover disabled publishing, missing agreement/invalid
names, a pending duplicate request with field locking and successful refresh, and
session-expiry recovery focus. All four pass. The browser assets rebuilt, lint
returned zero errors with 425 existing warnings, and the live owner page reloaded
with `panicmako-local-test · owner`, account ready, enabled namespace input, and
unchecked terms. No namespace creation, collaborator invitation, role grant, or
terms acceptance occurred. Screenshot: `namespace-readiness.png`.

This closes a frontend readiness gap, not the remaining second-person acceptance.
Collaborator scripts and the actual reviewer invitation/grant/revoke/audit flow
still need their full remaining source/behavior and real-account walkthrough.
Logs: `/tmp/tabs-exchange-redesign/namespace-readiness-{tests,build,check,types,workspace-tests}.log`.

Fresh combined verification after this change: all 18 workspace test tasks passed
(two cached), including 374 Exchange tests with 24 gated integration cases skipped;
all 16 typecheck tasks passed without cached tasks. Formatting and diff whitespace
checks pass. These results do not replace the intentionally gated real-user,
native, Windows, screen-reader, or production acceptance evidence.

## Invitation decision reconciliation audit

Independent inspection found that a recorded invitation decision followed by a
failed list reload could re-enable the original decision controls. The redesigned
recipient flow now serializes decision and refresh requests, locks all decision
controls while pending, and rejects acceptance without explicit agreement or
publishing readiness. A recorded decision whose reload fails, or an uncertain
network failure, clears stale decision controls and asks for a fresh invitation
list before another action. No automatic retry occurs. Keyboard focus recovers
to Refresh invitations after a decision or refresh, while deliberate navigation
focus is preserved.

Five controlled DOM tests pass: explicit agreement, overlapping actions/list
refresh, recorded-decision reload failure, uncertain mutation failure followed
by recovery, and no focus stealing. The rebuilt live PanicMako page reports no
pending invitations; pressing Enter on Refresh invitations returns keyboard
focus to that control after loading the actual empty list. Screenshot:
`invitation-refresh-focus.png`. This was read-only; no invitation, terms
acceptance, role grant, or membership change occurred. Actual second-person
acceptance remains outstanding. Lint returned zero errors with 425 existing
warnings, and the browser build passed.

Logs: `/tmp/tabs-exchange-redesign/invitation-recovery-{tests,build,check,types,workspace-tests}.log`.

Fresh combined verification after invitation recovery changes: all 18 workspace
test tasks passed (two cached), with 379 Exchange tests passing and 24 gated
integration cases skipped. All 16 workspace typecheck tasks passed without
cached tasks. Formatting and `git diff --check` pass. Actual two-person invitation
acceptance and reviewer grant/revoke/audit remain distinct, unaccepted gates.

## Namespace owner action reconciliation audit

The redesigned namespace member-removal and pending-invitation revocation handlers
previously re-enabled stale action controls when a recorded mutation's list reload
failed. Both now share one local mutation/reconciliation helper: it serializes
member/revocation/refresh operations within a namespace, captures the audit reason,
locks inputs while pending, and clears stale member/invitation controls on uncertain
failure or failed post-mutation refresh. A fresh successful list is required before
another action. Explicit removal acknowledgement and non-empty audit reasons remain
required; server authorization, last-owner protection, and audit persistence remain
authoritative. The helper restores focus to Refresh members without stealing focus
from deliberate navigation. Failed read refresh also clears stale privileged actions.

Six controlled DOM tests pass for both recorded-action reload failures, concurrent
member/revocation/refresh actions, uncertain mutation recovery, required removal
acknowledgement, and late completion without focus stealing. Together with the
recipient invitation suite, 11 focused tests pass. Browser build passed; lint
returned zero errors and 425 existing warnings. On the real PanicMako account,
keyboard activation of Refresh panicmako-local-test members completed, left the
owner as the one current member, and restored focus to the enabled refresh button.
Proof: `member-refresh-focus.png`. No membership or invitation was changed.
Actual second-person grant/revoke/audit acceptance remains unproven.

Logs: `/tmp/tabs-exchange-redesign/member-recovery-{tests,build,check,types,workspace-tests}.log`.

Fresh full verification for this owner-action change passed all 18 workspace test
tasks (two cached), including 385 Exchange tests with 24 gated integration tests
skipped. All 16 workspace typecheck tasks passed without cached tasks. Formatting
and `git diff --check` pass. Native UI, real second-person access, Windows,
screen-reader, and production-launch requirements remain separate outstanding gates.

## Production setup preparation audit

Inspected the actual Compose recipe, Dockerfile, Docker ignore, configuration,
API listener/health endpoint, bucket readiness and object transport. The API binds
`0.0.0.0` with the supplied `PORT`; its `/healthz` probes PostgreSQL only. The Docker
build runs the compiled portal path and does not receive signing private keys.
Existing environment files and acceptance data are excluded from the build context.
The Compose recipe's documented URL-safe PostgreSQL password constraint was
confirmed with synthetic reserved-character diagnostics; a synthetic URL-safe
configuration dry-run passed all three DB URLs and private, submissions-disabled
API/worker settings. Neither diagnostic launched containers or touched live secrets.

[exchange-production-setup.md](exchange-production-setup.md) now provides a concrete,
unprovisioned provider proposal, exact runtime/public-build settings, OAuth fields,
image/worker commands, separate approval gates, and ordered real-provider acceptance.
Current official Render Docker/worker/deploy and Cloudflare R2 S3 documents were
checked for the platform capabilities described. This is configuration preparation,
not real Render/R2 compatibility or deployment acceptance. Asked the owner to choose
backend hosting and a monthly budget. Existing Vercel marketing hosting and the
no-new-domain requirement are preserved; no provider, paid plan, DNS change,
production OAuth app, access grant, or deployment was created. Documentation
formatting and `git diff --check` pass; application code did not change in this audit.

## Workflow parity and missing-page routing audit

[exchange-redesign-parity.md](exchange-redesign-parity.md) maps retained publisher
workflows to their redesigned routes, handlers, observed evidence and outstanding
real-user/accessibility gates. The numeric-ID Advanced invitation flow, complete
legacy publisher controls and original fallback HTML remain retained. Matching IDs
are explicitly insufficient retirement evidence. The inventory highlights appeals,
verification, delegation, revocation, and list/history lifecycle walkthroughs that
remain unaccepted.

A concrete routing gap was fixed: the built branded 404 page was unreachable from
the registry's unknown-page path. HTML GET navigations now receive that page with
HTTP 404, no-store caching, normal CSP and framing restrictions. API/auth/compiled-
asset namespaces, non-HTML requests and non-GET methods preserve their existing
machine-readable errors. Frontend routing tests pass (14 tests), covering page
status/headers/content negotiation and reserved-route separation. Missing build
artifacts still fall through safely rather than becoming success responses.

The verified-live HTTP handle `16111` was gracefully stopped specifically to load
the changed server router, then restarted via the same guarded local acceptance
launcher with persistent private resources; new HTTP handle is `32811`. Read-only
HTTPS handle `70881` and desktop handle `73057` were not restarted. Live browser
proof `branded-not-found.png` shows one main landmark, valid skip target, and one
H1. Actual HTTP checks confirm browser-page 404 HTML, non-HTML page 404 JSON and
unchanged unauthenticated private API 401 JSON. No credential, membership, package,
role or terms was changed.

Fresh full checks pass: all 18 workspace test tasks (two cached), all 16 typecheck
tasks (none cached), lint zero errors with 425 existing warnings, formatting and
`git diff --check`. Logs: `/tmp/tabs-exchange-redesign/not-found-{tests,check,types,workspace-tests}.log`.
This does not complete independent behavioral parity or the remaining native,
real second-person, Windows, screen-reader and production requirements.

## Submission list lifecycle audit

The dedicated submission list lacked request serialization, page-exit cancellation,
stale-response guards and failure cleanup. It now uses an AbortController and
request generation, ignores duplicate refreshes, clears protected entries on
pagehide and any failed refresh, and reloads after a persisted pageshow. Expired
access conceals account controls and exposes reconnect guidance; keyboard refresh
restores focus unless the user deliberately moves it elsewhere. Entire responses
are validated before rendering: maximum 100 entries, typed namespace/tool/version
identities, exact SHA-256, boolean publication state and known lifecycle. A malformed
entry cannot leave a partially rendered list.

Five controlled lifecycle tests pass for stale-data cleanup/focus, malformed-list
rejection, 401 reconnect, pagehide/BFCache restore with late original completion,
and serialized refresh without focus stealing. Browser build and lint pass (zero
errors, 425 existing warnings). The live signed-in owner page loaded all three
real versions: published 1.0.2/1.0.1 and rejected 1.0.0. Keyboard refresh returned
focus to the enabled refresh control and preserved the three exact digest links.
Proof: `submission-list-refresh.png`. No release or permission changed. DOM and
visual checks establish visible link labels, but a real screen-reader walkthrough
remains required; no screen-reader acceptance is inferred from these checks.

Logs: `/tmp/tabs-exchange-redesign/submission-list-{tests,build,check,types,workspace-tests}.log`.

Fresh combined verification after list lifecycle changes passes all 18 workspace
test tasks (two cached), including 391 Exchange tests with 24 intentionally gated
integration cases skipped. All 16 workspace typecheck tasks pass without cached
tasks. Formatting and diff whitespace checks pass. The parity ledger now records
list lifecycle evidence while leaving exact-detail, real screen-reader and broader
native/second-person/Windows/production acceptance open.

### Dashboard design pass — 2026-10-04

The dashboard now uses the public Exchange workshop's typography, blue accent, editorial rows and restrained surfaces. Overview, namespace management, submissions, CLI access, submission details, Advanced tasks, the review desk, reviewer access and registry security share field groups and action sizing. Features and server authorization remain in place; this is a UI acceptance checkpoint, not public-launch approval.

Namespace collaborator, invitation and member sections mount into explicit slots rather than changing order with request completion. Advanced keeps five publishing tasks visible and groups four privileged tasks under a disclosure. Authorized deep links open that disclosure; role-hidden tasks remain hidden. Security has three local task views. Nested navigation focuses the heading instead of outlining the entire panel. Review evidence and exact-digest decisions are preserved inside per-version disclosures; the history action opens the history view before focusing its lookup.

The forms follow [USWDS form guidance](https://designsystem.digital.gov/components/form/) on grouping related controls and keeping labels with inputs. The task hierarchy follows the focused-task approach in [GOV.UK question-page guidance](https://design-system.service.gov.uk/patterns/question-pages/). The public Developers, Docs, Extensions and Resources pages remain the visual references, rather than introducing a separate dashboard brand.

Real-owner browser checks on the private localhost instance verified the eight main dashboard routes at 390 px, all nine Advanced tasks at desktop and 390 px, tablet security task switching at 768 px, and the rejected exact-digest submission detail. No horizontal page overflow was observed in those checks. The mobile menu exposes all eight authorized destinations, Escape restores toggle focus, and namespace dropdowns use full-width 46 px custom triggers. Submission refresh restored focus and left appeals enabled only after fresh empty history for the rejected digest. No invitation, access grant, token creation, appeal or review decision was sent during these checks.

Validation: browser build succeeded; all 18 workspace test tasks passed with task concurrency limited to one (two cached). Exchange: 397 passed, 24 opt-in integration tests skipped. Earlier parallel runs exposed unrelated timing failures in SDK/keyboard/WebSocket tests; no unrelated implementation or timeout changes were made. The review heading test was updated for intentional evidence disclosures, and task tests now cover privileged disclosure deep links and heading focus. Workspace typecheck, lint and Astro results are recorded in `/tmp/tabs-exchange-redesign/dashboard-design-{types-final,check-final,astro-final}.log`.

Preview files are under `/Users/rushil.dev/.codex/visualizations/2026/10/03/01a10225-8ab8-7c22-a7b7-2ea89f52e4a0/`: `dashboard-overview-preview.png`, `dashboard-overview-design.png`, `dashboard-namespaces-design.png`, `dashboard-reviewers-design.png`, and `dashboard-menu-design.png`.

This does not establish actual two-person reviewer acceptance, native desktop installation/update/rollback, Windows behavior, screen-reader acceptance, production custody or deployment readiness. Those existing acceptance items remain outstanding.

### Concept One dashboard composition checkpoint — 2026-10-04

The dashboard now derives its composition directly from the local marketing ConceptOne.astro and concept-one.css: compact desktop navigation with a small active marker, large restrained typography, layered action tabs, and paper-like working surfaces. The overview replaces the generic onboarding hero with the actual submission record through the existing bounded submissions loader. Namespace and CLI forms distinguish introductory guidance from the editable surface; CLI access comparison is available in a disclosure. Advanced, review, reviewer access and registry security share the new composition while retaining task IDs, exact-version evidence, permission boundaries, acknowledgements and confirmation steps. Motion observes reduced-motion preferences.

The collaborator invitation flow was also hardened: immutable serialized submission, inline validation, page lifecycle cancellation, and a GET-only uncertainty recovery that checks current ownership, membership and pending invitations before allowing another send. Seven new invitation UI tests cover these states; no real invitation or access grant was sent.

Validation: full workspace tests passed (18 tasks; 2 cached), typecheck passed (16 tasks), and check passed with zero errors and 425 existing warnings. Web build passed; Astro diagnostics report 96 files with zero errors/warnings/hints. Browser inspection covered all nine dashboard routes at 390px and 1280px without horizontal overflow, all nine Advanced hash destinations at mobile portrait with heading focus, and all three registry security panels at 768px with one rendered panel and heading focus. The full-screen menu closes with Escape and restores focus. Temporary viewport overrides were reset. Screenshots: workbench-concept-design.png and workbench-reviewer-design.png in the task visualization directory.

This checkpoint is local design and functional progress. It does not establish native desktop parity, real second-person delegation, Windows or screen-reader acceptance, production hosting, or production signing-key custody. The isolated native process remains running, but native UI observation timed out; it was not restarted. No legacy surface was retired and no production deployment was made.
