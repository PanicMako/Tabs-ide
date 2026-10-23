# Exchange operator and reviewer hierarchy

Implementation follow-up requested with the October 3 typography feedback.
The server-side role foundation and `/admin/reviewers` interface are implemented;
authenticated keyboard-accessible browser acceptance remains outstanding.

## Current evidence

`auth.ts` resolves review access from configured reviewers, explicit operators,
and active database assignments on every authenticated request. Namespace owner/contributor membership is separate
from registry administration. Reviewer screens already expose package evidence,
exact-digest decisions and history. `EXCHANGE_OPERATOR_GITHUB_IDS` bootstraps
operators. `/v1/operator/reviewers` provides operator-only listing and
CSRF-protected grant/revoke mutations for known accounts, with transactional
audit events. The interface includes an explicit confirmation step and audit
history; it is not yet verified in an authenticated browser acceptance run.

The PostgreSQL-backed service test verifies denied publisher/legacy-reviewer
delegation, invalid CSRF, concurrent idempotent grants, audit history, and
revocation affecting the same session. Its GitHub identities are fixtures;
this is not evidence of live GitHub OAuth success.

Five DOM tests exercise the actual operator-screen script and page markup with
a mocked API: non-operator denial, confirmation cancellation/focus restoration,
expired-access reconnect, one confirmed mutation with safe audit-text rendering,
and removal of the privileged view with focus moved to reconnect after revocation.
These complement the PostgreSQL-backed authorization tests; they do not replace
an authenticated browser walkthrough or screen-reader acceptance.

The isolated PostgreSQL/S3 browser fixture now includes an explicitly configured
fake operator. Browser verification found and repaired a missing OAuth-return
allowlist entry for `/admin/reviewers` (and the existing `/admin/security` task).
Retesting returned to the correct operator screen, loaded current authorization,
and verified keyboard preparation and Escape cancellation with focus restored.
No reviewer access was granted in this browser check. Evidence/packages are
retained under `.test-data/exchange-browser-SPQ2jf`; the fixture is not live
GitHub OAuth. Browser mutation/revocation and screen-reader acceptance remain open.

The inspected upstream Open VSX UserService separately handles namespace owner
and contributor membership. Keep the same conceptual separation: owning a
publisher namespace must never confer registry review authority.

## Required design

- Operator: bootstrap from an explicit server-configured numeric GitHub ID
  allowlist. Can assign and revoke reviewer access for known accounts. Never
  infer ownership from a login name, first sign-in, or namespace membership.
- Reviewer: inspect quarantined package files, scan evidence, permission diffs,
  history and source links; approve/reject the exact immutable digest. Cannot
  delegate privileges, access signing keys, or bypass scanning/publication.
- Publisher owner/contributor: manage only their namespace and submissions;
  cannot see other publishers' quarantined code or registry administration.
- Anonymous/public reader: only signed published catalog and reviewed assets;
  private deployments additionally enforce the configured access allowlist.

Add a durable reviewer assignment table and immutable grant/revoke audit events.
Use CSRF-protected operator-only mutation endpoints. Resolve current assignments
on every privileged request so revocation affects existing sessions. Prevent
self-escalation and reviewers modifying operator accounts. Keep signing offline.
Retain the existing admin allowlist as an explicitly documented migration path,
not automatic promotion of every existing administrator to operator.

The operator UI must show account identity, role, reason, actor and timestamp;
delegation needs a clear confirmation screen. Do not assign real accounts until
the operator identities are explicitly provisioned. Cover unauthorized access,
CSRF, membership removal, reviewer revocation, concurrent grants and audit history
with service integration tests and keyboard-accessible browser tests.

## GitHub sign-in prerequisite

Port 4323 is an Astro static preview, not the Exchange account/API server.
Real sign-in requires a GitHub OAuth app, its private client secret, the configured
Exchange origin and its matching `/auth/github/callback` URL, plus database and
storage configuration. Only `.env.example` exists in this worktree. Do not put
secrets into frontend assets or replace live sign-in with an unlabeled fixture.
The account page now identifies an unavailable account API rather than offering
a misleading sign-in action on a static preview.
