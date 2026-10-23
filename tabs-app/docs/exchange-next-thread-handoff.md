# Tabs Exchange: next-chat handoff

Updated 2026-10-05. This is a continuation checkpoint, not final launch acceptance.

## Working location

- Checkout: `/Users/rushil.dev/.codex/worktrees/tabs-exchange-claude-ui/tabs/tabs-main`
- Branch: `codex/tabs-exchange-claude-ui`
- `/Users/rushil.dev/Desktop/tabs` is the wrapper workspace, not the checkout above.
- Preserve all existing modified and untracked files. Read applicable AGENTS.md before editing. Do not reset, stash, merge, retire legacy paths, deploy, publish to npm, or enable public submissions automatically.
- Latest user scope is **every dashboard page and every nested view**. Public Extensions, Developers, Docs, and Resources are design references. User has not accepted the dashboard's final aesthetics.

## Already implemented or verified

- SDK/CLI, backend, publishing, review, signing, and private registry foundations exist. This is not a from-scratch project.
- Real local GitHub OAuth works. PanicMako (GitHub ID 121330302) is the Operator. Login/logout and privileged denial after logout were verified. Production OAuth remains separate.
- Namespace `panicmako-local-test` exists, owned by PanicMako and unverified. Draft publisher terms `2026-09-24` were explicitly accepted for private local testing only.
- Real website publishing journey: `workspace-note@1.0.0` uploaded, scanned, and rejected; `1.0.1` corrected, inspected, approved, and signed offline; `1.0.2` updated through the same flow and is signed latest. Older signed listing was also checked. Do not repeat consequential actions blindly.
- Downloaded SDK commands init/install/build/validate/pack/inspect were exercised. Six samples and 24 commands exercised filesystem/Git/network brokers and logic workers on macOS. This does not prove native view IPC or Windows behavior.
- Real signed data cold restore was tested into a fresh local DB/bucket, including archives and digest checks. Clone credential revocation and root rotation/replay recovery were tested. Production provider drills and native trust distribution remain open.
- Existing UI reliability fixes and tests cover bounded requests, upload/account/token state, review/security, memberships, invitations, and submission lifecycle. Read the chronological acceptance record for evidence.

## Latest dashboard implementation

The previous pale-card-heavy pass was rejected. Latest work includes:

- Compact desktop rail with a small current-page marker; full-screen blue mobile navigation retained.
- `DashboardDrawing.astro`: decorative code-native SVG drawings for identity, scoped access, reviewer hierarchy, exact package material, evidence, and release records. Reduced-motion-aware subtle transitions.
- Overview uses actual submission lifecycle data with Build / Submit / Follow links and a mint release-record composition.
- Namespaces have structured membership records and distinct identity, creation, collaboration, and invitation surfaces.
- CLI access uses a perforated-ticket composition, real 30-day lifetime label, and access comparison disclosure.
- Submission lists separate namespace/tool/version/state/digest while retaining the exact accessible identity. Exact details use a release passport with true UTC timestamps and hollow unrecorded stages.
- Advanced has nine task panels with contextual headings and differentiated controls. Review has four nested views; registry security has three. Reviewer access preserves the actual prepare/confirm permission flow.
- Review history renders validated structured versions and decisions, retaining exact reasons, digests, timestamps, and provenance. No fake placeholder activity.
- Namespace creation now has pagehide/BFCache lifecycle protection, atomic actor/membership validation, duplicate protection, and GET-only “Check namespace before retrying” recovery for uncertain POST outcomes. Ten focused namespace tests passed.

### Last change needing visual recheck

In `frontend/src/styles/dashboard.css`, split a mixed `:is(.task-form, #token-create .access-form-side)` selector. Its ID specificity accidentally forced the review-history form to flex instead of its desktop grid. The fix built successfully, but the final live horizontal form layout has **not yet been rechecked**.

## Remaining work, in priority order

1. **Complete the dashboard design pass and review.** Audit Overview, Namespaces, Submissions, exact submission details, CLI access, Publish, all nine Advanced tasks, Review and its nested views, Reviewer access, and three registry-security tasks. Use Concept One marketing and existing public pages as references. Remove generic filler through purposeful composition, concise copy, consistent control sizing, useful data, and restrained custom motion. Preserve features and authorization boundaries.
2. **Finish final responsive and interaction QA.** Recheck the last CSS fix, refresh screenshots across all root routes and nested views on desktop/mobile/tablet, inspect overflow/footer collisions, custom dropdown selected/hover states, arrows, profile/header/menu behavior, loading/errors/empty states, and reduced motion. The latest pass tested all 16 nested views at 1280 and 390 pixels without horizontal overflow and with focused headings; that is not complete final visual acceptance.
3. **Independent functional/accessibility/source review.** Keyboard focus, forms and error recovery, menus/dialogs, private data cleanup, correct role visibility, and actual screen-reader walkthroughs for publisher/operator/reviewer. Browser accessibility snapshots alone do not establish screen-reader acceptance.
4. **Real second-account collaborator/reviewer acceptance.** A friend must sign in. Exercise invitation and acceptance, role boundaries, reviewer grant/revoke, and audit history. Reviewer may review but must not delegate or sign. Operator provisioning is already done; do not recreate it. Get explicit authorization for consequential grants/invitations.
5. **Actual Tabs desktop journey.** Bind to the correct isolated development app, have the owner create/enter a private read token without putting it in chat, then verify signed discovery/install, permission review/cancel, project enablement, Work/Personal data isolation, OS credential persistence/reconnection/revoke, update/rollback/uninstall, and recovery. Harness/native transport tests are not this actual UI journey.
6. **Remaining CLI/documented commands.** Real scoped publish token through CLI publish/status/watch/cancel; private-token catalog search; native load/reload/views/grants/IPC; Windows `tabsext.cmd` and process cleanup. Production compose/API/worker readiness, failure, and object checks remain unaccepted. Consult the command acceptance matrix before rerunning commands.
7. **Production operations/security acceptance.** Real-provider backup/restore and failure drills, private credential UX and persistence, signing-key custody/quorum, root distribution and actual native trust clients. Local clone restore/rotation evidence already exists.
8. **Same-domain hosting configuration.** Keep Exchange under the existing marketing domain, proposed `/exchange`; user explicitly does not want another purchased domain. Backend proposal is Render API + worker + Postgres and R2, but it is not selected/provisioned. Resolve provider/budget, production DB/storage, path routing, OAuth callback, HTTPS/cookies/CORS/CSP, workers, health checks, and public listing configuration.
9. **Launch policies and ownership.** Final terms/privacy/support, review staffing, abuse handling, monitoring, backup and incident owners/procedures, and signing custody. Local draft terms acceptance does not authorize public launch.
10. **Final combined acceptance and branch review.** Gather real evidence for the whole requirement set, run fresh appropriate full checks after new changes, and prepare a final report. Commit/integration/deployment/public publishing require their own authorization. Retire legacy paths only after proved feature parity and authorization.

## Last verification checkpoint

- Full workspace tests: 18 tasks passed, 2 cached, in `/tmp/tabs-exchange-redesign/dashboard-folio-workspace-final.log`. This preceded only the last CSS specificity fix.
- Final typecheck: 16 tasks successful in `dashboard-folio-types-final.log`.
- Final `vp check`: zero errors, 425 existing warnings in `dashboard-folio-check-final.log`.
- Astro: 98 files, zero errors/warnings/hints in `dashboard-folio-astro-final.log`.
- Final frontend build after CSS fix passed in `dashboard-folio-build.log`.
- Focused namespace creation: 10 tests; review history and structured records: 6 tests; submission detail/list/namespace combined: 21 tests.
- Real read-only history lookup returned three versions and three decisions. Its screenshot predates the final CSS grid fix.
- Temporary logs are local evidence, not durable production backups. Old terminal IDs for check/typecheck are gone; logs confirmed completion. Do not restart checks just because an old handle is unknown.

## Runtime and protected state

Revalidate ports, processes, state, and current date before trusting old handles or restarting anything.

- Prior local HTTP handle 32811: localhost:8787, private-submissions acceptance server.
- Prior read-only TLS handle 70881: https://localhost:9443, same real local DB/bucket and dedicated CA.
- Prior isolated desktop handle 73057 was running at last poll. Correct development app is `apps/desktop/.electron-runtime/Tabs.app` in this checkout. It shares bundle ID `com.tabs.app` with installed `/Applications/Tabs.app`; do not accidentally test the installed app. Native window binding was unresolved.
- Private ignored state: `.test-data/exchange-real-github/state.json`; DB `tabs_exchange_auth_45e1f018381a3f33`; bucket `tabs-exchange-auth-45e1f018381a3f33`.
- `.env.local` and offline keys are ignored, mode 0600. Never print secrets, browser cookies, tokens, or credential-bearing configuration. No desktop read token was created in this pass.
- Local root pin: `0a9971222d8ea180550a16b9f10bb3d616b27e4b699ce2d771bc5f822be753be`. Local test root expires **2026-10-10**; check expiry and do not treat this as production trust.
- Restore evidence: `.test-data/exchange-real-github/cold-restore-efEjj6/report.json`.

## Canonical reading

- `docs/exchange-public-launch-acceptance.md`: chronological evidence and remaining acceptance; last entries predate part of the latest drawing/history/lifecycle refinement.
- `docs/exchange-redesign-parity.md`: route and feature parity, not permission to remove legacy.
- `docs/exchange-desktop-acceptance.md`: exact native walkthrough and private credential handoff.
- `docs/exchange-command-acceptance.md`: command matrix.
- `docs/exchange-production-setup.md`: proposed hosting and launch gates.
- `docs/exchange-github-setup.md`: existing real local OAuth setup.

Pending human inputs are a second real account, an isolated native window and owner-entered read credential, a Windows host, hosting provider/budget, and final launch policies/owners/approvals. Continue independent design/source work while those are unavailable. Do not restart the project or claim fixture checks as real-user acceptance.

## Continuation checkpoint — 2026-10-05

See `docs/exchange-dashboard-review-2026-10-05.md` for current runtime verification,
shared nested-navigation focus fixes, mobile heading refinement, and route QA.
The old review-history grid fix has now been visually rechecked successfully.
The prior HTTP/TLS listeners and this checkout's isolated desktop process were
not running. A separate GET-only fixture frontend preview is on 127.0.0.1:4333;
it has no protected registry connection and is not real-account evidence.
Root and nested screenshot coverage is now present at desktop, tablet and mobile
widths. Final aesthetics, full pointer/screen-reader acceptance, and all human or
production requirements above remain pending. Existing changes were preserved;
no merge, deploy, commit, public publishing, or consequential account action.

### Latest user correction and design revision

The user rejected residual AI-looking patterns, especially arbitrary colored top
and left borders, detached namespace sections and a transparent hamburger menu.
`workspace-composition.css` now uses restrained document/roster/form layouts across
all dashboard views, removes those edge strips and nested pastel frames, and hides
repeated decorative task drawings. Namespace teams sit with their identity records;
sent and received invitations are explicitly separate. The menu transparency was
a CSS specificity bug and is fixed with an opaque blue open-menu surface. It no
longer fades the whole overlay over the page. Screenshots for this newer pass are
in `dashboard-qa/editorial/`, superseding the earlier folio screenshots. Final
aesthetic acceptance still belongs to the user; do not claim it from these checks.

### Latest team controls, illustrations, and naming request

The user asked to retain the distinctive custom illustrations and animation.
Publish archive artwork and nested task drawings are visible again. Namespace
members use compact roster rows, designed inline removal/invitation decisions,
and Keep unchanged/Escape cancellation with restored focus. A sole owner is
labelled Last owner. Mutation locking and uncertain-outcome reconciliation remain.

Publish now has a display-name/package-name planner, similar-tool catalog link,
copyable manifest fields, and authenticated GET /v1/publisher/name-check. It
checks all recorded package versions only within namespaces the actor belongs to.
Display names may repeat; IDs are still namespace.name. No reservation is created,
and names must be set in the source manifest before building the uploaded archive.
The preview includes fixture name-check responses; those are not real registry
availability evidence. No real account mutation or publication was performed.

Final follow-up checks: 18 workspace tasks passed (2 cached) with bounded Vitest
workers; Exchange 428 passed/24 gated skipped; typecheck 16 successful tasks;
vp check zero errors/425 existing warnings; Astro 99 files with zero diagnostics;
frontend build passed. Final logs use roster-names-\*-final in
/tmp/tabs-exchange-redesign. Final measured responsive results contain 78 checks
at 1280/768/390 with no overflow or incorrect task focus. Dashboard secondary
button hover no longer paints a partial sliding fill; artwork animation remains.
