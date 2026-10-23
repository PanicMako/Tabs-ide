# Exchange ecosystem verification checkpoint

> Historical checkpoint for the earlier ecosystem UI and SDK 1.6. It is not a
> completion report for the dedicated Exchange staging goal. Current evidence
> and outstanding acceptance work are tracked in
> [exchange-staging-acceptance.md](exchange-staging-acceptance.md).

Testing branch: `codex/tabs-extensions-testing`. No merge, deployment, npm release,
or public-publishing enablement is authorized by this checkpoint.

## Implemented

- Ten-page developer documentation, generated manifest/SDK reference, search,
  mobile navigation, keyboard-focusable examples, and copy status announcements.
- Dependency-free SDK 1.6.0 declarations and compiled standalone Node CLI with
  React/TypeScript/Vite and HTML starters, explicit staging, validation,
  deterministic packaging, inspection, watch builds, registry selection,
  publishing, and submission status.
  Authenticated CLI catalog search is available for private deployments.
- Host-owned development reload and private-registry connection controls.
- Reviewed package listing metadata, raster icons and bounded README transport,
  escaped Markdown, safe links, categories, newest/name sorting, and readable URLs.
- Same-origin registry marketplace and existing publisher/reviewer dashboard;
  manifest-derived browser upload, progress, file selection without dragging,
  immutable duplicate-version errors, and explicit lifecycle states.
- Show-once hashed 30-day scoped read/publish tokens, revocation, and current
  namespace membership checks. No token-based namespace administration or review.
- Private-instance GitHub allowlisting, authenticated catalog/assets/download/TUF,
  origin-bound OS-backed desktop credentials, redirect rejection, no-store caching,
  and reconnect behavior separate from signed package revocation.
- Docker/Render configuration with submissions disabled. Pinned, ignored,
  read-only Open VSX reference; no upstream source imported.

## Verified evidence

Local logs live in ignored `.test-data/`; they are not production credentials.

- Standalone release tarballs installed outside the checkout. Both templates
  install/build/audit/validate/pack/inspect successfully; identical inputs have
  identical archive digests and source secrets do not enter staging.
- Actual Electron sandbox smoke loads the CLI-generated React starter and
  destroys the old view on host reload. Existing sandbox/profile tests pass.
- PostgreSQL/S3 suite: 13 cases, including submit/scan/review/sign/discover,
  listing assets/categories/newest SQL, token expiry/revocation/member removal,
  browser/namespace duplicate-digest behavior, and recovery into fresh services.
  These 13 cases and the 5 cross-service cases also pass against the actual
  SeaweedFS S3 service, not only the object-storage test double.
- TLS Exchange/desktop suite: 5 cases, including installation/update/profile
  isolation, authenticated private TUF transport, expiry reconnect, redirects,
  rollback/tampering, offline checks, and revocation.
- Workspace typecheck: 16 packages successful. `vp check`: zero errors;
  existing workspace warnings remain.
- Marketing build: 17 static pages. Targeted marketing/package/registry suites
  pass. Browser inspection confirms mobile navigation, search, no horizontal
  overflow, and copy-code announcements.
- Built and started the complete Docker/PostgreSQL/SeaweedFS stack with one
  shared registry image. Authenticated storage readiness and migrations complete
  before API/worker startup; private catalog rejects anonymous requests and the
  worker records its heartbeat. This is a local single-node drill, not a
  production high-availability or live-provider certification.
- Executable documentation validation checks all ten built pages, sidebar
  destinations, local assets, generated references and unsupported labels.
- Real CLI publishing/status/read-token search are exercised by the cross-service
  tests against the same API used by the browser submission flow.

## Final workspace verification

- The final full workspace run passes all 18 tasks, including 1,848 server
  tests (27 intentional skips) and 548 desktop tests. Its log is
  `.test-data/ecosystem-full-tests-verified.log`.
- During verification, the existing AppImage rollback test reproduced a
  liveness defect: an exited process retaining a PID could be treated as a
  successful relaunch. The installer now rejects zombie/absent process states;
  all four updater tests and the subsequent full suite pass. No test was skipped
  or weakened to obtain that result.
- The final real-S3 cross-service run additionally proves a successful compiled
  CLI upload, identical-digest browser duplicate detection, and transition to
  manual review. `.test-data/ecosystem-seaweed-cross-final.log`: five cases pass.

## Requirement-to-evidence map

| Checkpoint                  | Current implementation                                                                                        | Verification                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Reference and comparison    | `docs/exchange-openvsx-comparison.md`, ignored read-only pinned checkout                                      | Revision and ignore rule checked; no upstream imports                                                                                           |
| Standalone authoring        | `packages/extension-api`, `packages/extension-cli`, explicit `.tabs-extension` staging                        | Executable tutorial builds both tarballs/templates outside checkout; real Electron loads React output and reloads its isolated view             |
| Documentation               | Ten `/docs/extensions` pages, introduction, actual declaration/schema generation                              | Static build, documentation verifier, marketing tests and mobile/keyboard/copy browser inspection                                               |
| Public marketplace          | Marketing routes and same-origin registry portal; categories, sorting, safe README/icons and release metadata | Real PostgreSQL query/asset tests, Markdown tests, legacy redirect/build configuration checks                                                   |
| Publisher workflow          | Existing OAuth account/namespace/invitation/review services; browser upload and scoped CLI tokens             | Real service lifecycle, digest mismatch/mutated object/CSRF/membership/duplicate tests; compiled CLI success/status                             |
| Private access              | Allowlist, read tokens, protected catalog/assets/download/TUF, separate desktop OS vault                      | Unauthorized enumeration, expiry/revocation/membership, origin/redirect/caching and authenticated TUF cross-service tests                       |
| Installation and updates    | Existing trusted desktop installer and project/profile broker                                                 | Real TLS submit-to-install/update/revocation workflow; Work/Personal data isolation, declined permission increase, tampering and rollback tests |
| Self-hosting and operations | Render configuration, Docker API/worker/PostgreSQL/S3 stack, disabled publication, backup/restore guidance    | Full local stack startup, authenticated S3 readiness, worker heartbeat, real-S3 lifecycle and fresh-database/object restore                     |

These proofs apply to this testing checkout and local fixtures. They do not
prove npm publication, deployed website availability, live OAuth configuration,
production secret custody, or operator acceptance of launch gates below.

The vendored Code-OSS precommit command cannot start without `event-stream` in
its separate dependency tree. No Code-OSS source was changed; app-level checks
do not establish that missing vendored check as passed.

## External launch gates — intentionally disabled

Before npm release: verify namespace/package ownership and authorize publication.
Before public submissions: approve publisher terms/privacy policy, configure real
GitHub OAuth, private storage and database ownership, signing ceremony and key
custody, independent client root distribution, reviewer/operator ownership,
rate limiting/monitoring, restore and rotation drills, and security sign-off.
Test keys, mock GitHub identities, and local scans are not production assurance.

Private hosting controls future downloads; it cannot erase already downloaded
archives. Backups must not resurrect revoked sessions/tokens. Browser execution,
privileged background tools, federation, reviews/ratings, and OIDC trusted
publishing remain explicitly unsupported, not hidden acceptance failures.
