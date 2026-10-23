# Redesign parity audit — legacy retained

This is a source and routing inventory, not permission to retire legacy pages.
Controls with matching IDs alone do not prove working behavior. The dedicated
routes use separate handlers; their authorization, state transitions, recovery,
focus and real-account evidence must be checked independently.

| Retained publisher workflow                                        | Redesigned route and handler                                                              | Current verification boundary                                                                                                                                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Namespace creation                                                 | `/account/namespaces`; `account-pages.ts`                                                 | Real owner membership displayed; readiness/duplicate/401 recovery tests pass. New real creation already recorded in publishing acceptance.                                           |
| Namespace invitation                                               | `/account/namespaces`; `collaborators.ts`                                                 | Username-based invitation present; numeric-ID workflow retained in Advanced. Actual second-account invitation still required.                                                        |
| Recipient accept/decline                                           | `/account/namespaces`; `invitations.ts`                                                   | Terms/readiness and uncertain mutation reconciliation tested; actual two-person acceptance outstanding.                                                                              |
| Member removal and invitation cancellation                         | `/account/namespaces`; `members.ts`                                                       | Audit-reason/acknowledgement and serial reconciliation tested; read-only real owner refresh verified. Real second-account access removal/audit outstanding.                          |
| Scoped tokens, once-visible secret, revocation                     | `/account/tokens`; `tokens.ts`                                                            | Reveal lifecycle and stale response tests; actual desktop user credential handoff/persistence/revocation UI still required.                                                          |
| Raw archive upload                                                 | `/publish`; `publish.ts`, `upload.ts`                                                     | Real rejection, corrected upload and signed update recorded. Retained Advanced XHR upload remains separately supported and tested.                                                   |
| Submission list and exact-digest detail                            | `/account/extensions`, `/account/submissions/<digest>`; `submissions.ts`, `submission.ts` | Actual publisher versions and list keyboard refresh verified; list cancellation/stale response/failure tests pass. Complete detail lifecycle and screen-reader audit still required. |
| Appeal creation/history                                            | Exact-digest submission detail; `submission.ts`, `submissionAppeals`                      | Form and digest-bound request/history present; real rejected/revoked appeal and response walkthrough outstanding.                                                                    |
| Exact-digest scan/review decisions and approved release revocation | `/admin`; `review.ts`, `review-evidence.ts`                                               | Actual local rejection/approval recorded; complete real revocation and independent reviewer role walkthrough outstanding.                                                            |
| Operational queue/worker/signing status                            | `/admin`; `review-operations.ts`                                                          | Real owner snapshot loaded and readiness controls covered. Provider monitoring/paging/incident ownership unconfigured.                                                               |
| Extension release/review history                                   | `/admin`; `review-history.ts`                                                             | Dedicated history form and handler present. Complete keyboard and real second-reviewer audit remains unaccepted.                                                                     |
| Reviewer appeal responses                                          | `/admin`; `review-appeals.ts`                                                             | Response forms and generation/uncertain mutation guards present. Real appeal response is not yet accepted.                                                                           |
| Digest block/unblock and batch import                              | `/admin/security`; `review-security.ts`                                                   | Lifecycle, focus, bounded batch and safe mutation behavior tested; no real security action in recent read-only checks.                                                               |
| Publisher verification proof                                       | `/admin/security`; `review-security.ts`                                                   | Proof/reason UI and backend decision route present; actual ownership-verification ceremony not claimed.                                                                              |
| Operator reviewer grant/revoke/history                             | `/admin/reviewers`; `reviewer-roles.ts`                                                   | Real PanicMako operator provisioned; second signed-in account needed for real delegation/removal/history.                                                                            |
| Sign-out and reauthentication                                      | Shared dashboard `account.ts`; OAuth server and `/sign-in`                                | Real owner logout/relogin recorded; controlled provider error recovery tested. Full provider-denial and production OAuth acceptance outstanding.                                     |

The branded `/publisher` page still imports `/publisher.js` and retains the full
original control contracts, including numeric-ID invitations, review, security,
appeals and verification. The original `src/publisher.html` fallback also remains.
Neither has been deleted. Static contract tests support preservation but do not
prove all Advanced controls through a real account.

## Routing gap found and corrected

The built `404.html` existed without a live registry routing path. Unknown HTML
browser navigations now use it with HTTP 404 and the normal CSP/no-store headers.
Unknown API, OAuth/authentication and compiled-asset routes remain machine-readable;
POST/non-HTML requests do not use the frontend fallback. A missing build artifact
still falls through to the existing server error response. Tests exercise status,
headers, content negotiation and reserved-route separation.

The live private HTTP registry now visibly renders the branded missing-page screen,
with one main landmark, a working skip target and one H1. An unauthenticated private
API miss still returns the existing JSON authentication error (401); a non-HTML
page miss returns JSON 404. These are intentionally different paths.

## Retirement gate

Before removing legacy code, finish the unaccepted workflows above, verify browser
and CLI/API compatibility, exercise publisher/reviewer/operator roles and lost-access
recovery, compare bounded limits/error semantics, and finish keyboard/screen-reader
acceptance. The actual desktop, Windows and public-provider requirements remain in
`exchange-public-launch-acceptance.md`; this inventory does not substitute for them.

### Dashboard hierarchy checkpoint — 2026-10-04

- Main and nested dashboard controls now share `frontend/src/styles/dashboard.css`, imported only by the dashboard layout and scoped to `data-dashboard="true"`.
- Namespace features remain separate API clients, mounted into stable page slots. Owner-only collaboration and audited member removal remain available.
- All nine Advanced tasks remain available with existing IDs and contracts. Five publisher tasks are visible; four role-gated review/security tasks are grouped under a disclosure. Old heading deep links still work.
- Review queue evidence and decisions remain present inside per-version disclosures. Submission correction and appeal controls retain exact-digest binding and validated-history gating.
- Registry security's ownership, material blocks and current restrictions are local task views with the existing authorization, acknowledgement and audit requirements.
- Reviewer assignments, grant/revoke confirmation and audit history remain available. No production capability is inferred from visual QA or controlled DOM tests.

### Concept One dashboard composition checkpoint — 2026-10-04

The dashboard now derives its composition directly from the local marketing ConceptOne.astro and concept-one.css: compact desktop navigation with a small active marker, large restrained typography, layered action tabs, and paper-like working surfaces. The overview replaces the generic onboarding hero with the actual submission record through the existing bounded submissions loader. Namespace and CLI forms distinguish introductory guidance from the editable surface; CLI access comparison is available in a disclosure. Advanced, review, reviewer access and registry security share the new composition while retaining task IDs, exact-version evidence, permission boundaries, acknowledgements and confirmation steps. Motion observes reduced-motion preferences.

The collaborator invitation flow was also hardened: immutable serialized submission, inline validation, page lifecycle cancellation, and a GET-only uncertainty recovery that checks current ownership, membership and pending invitations before allowing another send. Seven new invitation UI tests cover these states; no real invitation or access grant was sent.

Validation: full workspace tests passed (18 tasks; 2 cached), typecheck passed (16 tasks), and check passed with zero errors and 425 existing warnings. Web build passed; Astro diagnostics report 96 files with zero errors/warnings/hints. Browser inspection covered all nine dashboard routes at 390px and 1280px without horizontal overflow, all nine Advanced hash destinations at mobile portrait with heading focus, and all three registry security panels at 768px with one rendered panel and heading focus. The full-screen menu closes with Escape and restores focus. Temporary viewport overrides were reset. Screenshots: workbench-concept-design.png and workbench-reviewer-design.png in the task visualization directory.

This checkpoint is local design and functional progress. It does not establish native desktop parity, real second-person delegation, Windows or screen-reader acceptance, production hosting, or production signing-key custody. The isolated native process remains running, but native UI observation timed out; it was not restarted. No legacy surface was retired and no production deployment was made.
