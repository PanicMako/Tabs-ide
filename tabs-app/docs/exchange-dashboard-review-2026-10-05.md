# Dashboard continuation review — 2026-10-05

This records local frontend QA, not final aesthetic, real-account, screen-reader,
native desktop, or launch acceptance. Existing uncommitted work was preserved.
No commit, merge, deployment, permission grant, publication, or real registry
mutation was performed.

## Runtime verified before work

No listeners were present on the former Exchange HTTP/TLS ports 8787/9443 or
local PostgreSQL/storage ports 5432/9000. The running Tabs development process
belonged to `/Users/rushil.dev/Desktop/tabs/tabs-app`, not this checkout. It was
left untouched. The real-account state identity and cold-restore report remain
present; `.env.local` and state.json remain mode 0600. Stored local roots expire
2026-10-10T17:39:47.038Z. This is local test trust only.

A separate loopback frontend QA server runs on 127.0.0.1:4333 with explicit
qa-publisher fixtures. Every non-GET request returns 405. It does not connect to
the protected database or bucket. Its operator identity, release, accepted terms,
and health values are fixtures, not new real-account evidence.

## Changes in this continuation

- Nested task navigation now restores focus to the destination heading when
  browser history hides the focused task. Background authorization updates also
  move focus out of a departing role panel without stealing focus from navigation.
- Clicked heading fragments use the same safe URI decoding as direct deep links.
- Task destinations leave 100 pixels above the heading during focus scrolling.
- After the user rejected residual decorative patterns, the composition stylesheet
  was redesigned across all routes: neutral document surfaces, no colored edge
  strips, no nested pastel card frames, and no token-ticket perforations. The user
  explicitly asked to retain the distinctive illustrations: Publish archive animation
  and all task/header drawings remain visible, with compact responsive sizing.
- Namespace team records now sit beside their identities. Members, sent invitations,
  and invitations received by the user have distinct headings. Creation follows
  team management. Empty member results now explain what to check.
- Publishing uses direct namespace/archive headings and a compact file drop area.
- The mobile menu background bug came from the transparent sidebar selector
  winning over the mobile blue surface. A scoped open-menu selector now wins;
  overlay opacity animation is disabled so the surface is solid from its first frame.
- Three regression cases extend workspace panel tests to seven passing tests.

## Route coverage

All ten root routes were checked at 1280×900, 768×1024, and 390×844:
`/account`, `/account/namespaces`, `/account/extensions`, an exact-digest
`/account/submissions/<digest>`, `/account/tokens`, `/publish`, `/publisher`,
`/admin`, `/admin/reviewers`, and `/admin/security`. Each had one H1 and no
horizontal document overflow. Root routes were additionally checked at 320×740.

All sixteen nested tasks were checked at desktop, tablet, and mobile widths:

| Area     | Tasks                                                                                                                                        |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Advanced | Identity & team; CLI access; Package upload; Submissions; Appeals; Package review; Release revocation; Digest blocks; Publisher verification |
| Review   | Package desk; Registry health; Release history; Publisher appeals                                                                            |
| Security | Ownership; Block material; Current blocks                                                                                                    |

Nested checks verified one rendered panel, the expected destination heading
focus, and no horizontal document overflow. Keyboard activation passed for every
mobile/tablet task. Some rapid automated mobile pointer clicks after scrolling
hit different controls; those samples were retained in results.json and replaced
by explicitly verified keyboard samples. A fresh stable-page pointer check of
Block material succeeded. This does not establish complete pointer acceptance.

The review-history specificity fix from the previous chat is visually confirmed:
both desktop fields have the same Y position and separate grid columns; mobile
stacks them. Workspace menu Escape closes the modal, restores toggle focus, and
clears background inert state. CLI dropdown ArrowDown/Enter selects read access
and disables its publisher namespace control. Profile menu Escape closes it and
restores summary focus. No token was created.

Screenshots and measured results are in:
`/Users/rushil.dev/.codex/visualizations/2026/10/05/01a10b79-5d8b-74e2-93dd-b4fc2d957182/dashboard-qa/`.
There are root-route and nested-task screenshots for all three main widths.
Final redesign screenshots and results are under the `editorial/` subdirectory.
The blue mobile-menu screenshot confirms a solid surface; computed background
is rgb(50, 89, 237), opacity 1, fixed positioning, and full viewport dimensions.

## Validation

- Final full workspace run: 18 successful tasks, 2 cached with
  `vp run test --concurrency=1 -- --maxWorkers=2`.
- Exchange: 428 passed, 24 integration/environment-gated tests skipped.
- Name-check API/UI and member decisions: 17 focused tests, including invalid and
  nonmember checks, stale-response cancellation, audit workflow cancellation and
  sole-owner protection. Existing workspace navigation tests remain green.
- Workspace typecheck: 16 successful tasks.
- `vp check`: zero errors, 425 existing warnings.
- Astro: 99 files; zero errors, warnings, or hints.
- Final frontend/SDK staging build and `git diff --check` passed.
- Two earlier broader runs hit unrelated telemetry/assertion and websocket/Git
  timeout failures. The telemetry test passed in isolation; both subsequent full
  runs with bounded Vitest workers passed. No unrelated tests were changed.

Final logs are under `/tmp/tabs-exchange-redesign/`, with prefixes
`roster-names-workspace-final`, `roster-names-types-final`,
`roster-names-check-final`, `roster-names-astro-final`, and
`roster-names-build-final`. Final responsive metrics are in
`dashboard-qa/editorial/final-results.json`: 78 root/nested checks at measured
1280, 768 and 390 widths, with no horizontal overflow or wrong task focus.

## Latest team and naming follow-up

- Team rows now have compact identity/role/action alignment, a neutral inline audit
  decision form, acknowledgement, and Keep unchanged/Escape cancellation that clears
  the draft and restores disclosure focus. Invitation cancellation uses the same
  layout and interaction. Sole owners show Last owner instead of an impossible
  removal action; the backend remains authoritative.
- Publish has display-name/package-name planning, a suggested slug that stops
  changing once edited, similar-tool catalog search, and copyable manifest fields.
  GET /v1/publisher/name-check requires sign-in and membership of the checked
  namespace. One parameterized database query checks all recorded version states;
  responses are private/no-store and expose no other namespace's usage.
- Availability is a snapshot, not reservation. Display names are shared; package
  IDs remain namespace.name. The uploaded archive is never silently renamed.
- Expanded roster and both name-check outcomes were checked with GET-only fixtures.
  No member was removed, invitation revoked, terms accepted, or archive submitted.
- The final responsive pass records actual DOM viewport dimensions, rather than
  relying on an override request alone. Final screenshots use the final- prefix.

Dashboard secondary buttons also use a steady, legible hover surface instead of
an animated fill that could transiently leave white text over white. Illustration
animation and reduced-motion rules remain. Name checks restore their trigger focus
on completion without stealing focus from another control. The fixture preview
remains running; temporary responsive viewport overrides were reset.
