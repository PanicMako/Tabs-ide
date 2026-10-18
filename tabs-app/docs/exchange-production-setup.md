# Exchange production setup

The initial public-read pilot is live at `https://tabs-exchange-api.onrender.com`.
Render assigned this address; no additional domain was purchased. The existing
marketing site stays on Vercel. Exchange authentication and API routes share the
registry origin. Publishing remains disabled until the remaining acceptance gates
are complete; this is not a fully launched signed extension marketplace.

## Current services

| Component    | Current setup                                      | Configuration                                                                                                                                          |
| ------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Registry API | One Free Render Docker service in Singapore        | `codex/exchange-deployment` application-only branch; Docker context `.`, Dockerfile `apps/exchange/Dockerfile`, default command, `/livez` health check |
| Scan worker  | Not deployed                                       | Publishing stays disabled until a scanning deployment is accepted                                                                                      |
| Database     | Neon Free PostgreSQL in Singapore                  | Pooled `DATABASE_URL`; direct `DATABASE_URL_UNPOOLED` for migrations and notifications                                                                 |
| Packages     | Private Neon Object Storage bucket `tabs-exchange` | `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `S3_BUCKET`                                                     |
| Signing      | Production signer/root not provisioned             | Private signing keys must stay out of the API/worker environment, repository, and image                                                                |

The application-only branch is a subtree projection of `tabs-app`. The complete
integration branch remains `codex/release-consolidation-2026-10-15`. This avoids
Render's checkout failure on unrelated vendored Code-OSS Git LFS fixtures without
removing source or rewriting the original history. See `exchange-hosting.md` for
the update procedure and shared Free-instance-hour limits.

## Current runtime settings

Automatic deployment is Off. A manual deployment selects an explicit revision.
The Docker command applies idempotent migrations before starting the API; Free
Render does not support a pre-deploy command. `/healthz` queries PostgreSQL for
readiness; `/livez` does not query the database on every Render health probe.

Database, storage, `GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET` are runtime
secrets on Render. They are not Docker build arguments. The Docker context
excludes environment files, Neon CLI state, local builds, and dependencies.

- `EXCHANGE_ORIGIN=https://tabs-exchange-api.onrender.com`
- `EXCHANGE_VISIBILITY=public` allows anonymous catalog reads.
- `EXCHANGE_OPERATOR_GITHUB_IDS=121330302` and
  `EXCHANGE_ADMIN_GITHUB_IDS=121330302` select the verified repository owner's ID.
- `EXCHANGE_PUBLISHING_ENABLED=false` keeps submissions disabled.
- `S3_BUCKET=tabs-exchange`; the bucket remains private.

The registered GitHub OAuth application uses the same HTTPS homepage and
`https://tabs-exchange-api.onrender.com/auth/github/callback`. Wildcard matching
and Device Flow are disabled. The owner supplied the secret through an ignored,
private environment file. The deployed login redirect and cookie protections
have been checked. The owner completed real browser authorization, and the
expected GitHub identity and active session were verified in Neon.

The live `/livez`, `/healthz`, `/`, `/sign-in`, and `/v1/extensions` routes return
HTTP 200, and `/v1/registry` confirms publishing is disabled. Database and storage
compatibility checks are recorded in `exchange-neon-setup.md`. These checks do not
establish scanning, signed publication, recovery, or trusted desktop installation.

## Ordered acceptance gates

1. The Free provider, region, service, database, bucket, and assigned origin are
   configured. Reviewed terms/privacy/support and operational contacts remain.
2. Review the combined branch and pin a deployable revision/image. Local
   uncommitted work is not a deployable reviewed release. No automatic merge.
3. Production migrations and real private storage checks have passed. A separate
   scanner and production-like acceptance environment are still needed for the
   remaining publication and recovery tests.
4. Verify HTTPS, exact-origin OAuth, real owner and second-reviewer access,
   disabled submissions, worker heartbeat, queue/scan behavior, controlled signed
   publication, signed listings, and actual desktop installation with the
   separately distributed production root. A database `/healthz` response does
   not prove storage, scanning, signing or worker readiness.
5. Run the cold backup/restore and key-rotation drills on isolated production-like
   resources; confirm package counts/digests, credential invalidation, restore
   time, responsible operator, monitoring and incident escalation. Local clone
   drills already recorded elsewhere do not establish provider recovery.
6. Keep public submissions and npm publication outside the initial pilot until
   their readiness and release scope are established. Record who operates moderation,
   signing, backup, security alerts, abuse appeals and incident response.

The bundled Compose recipe is an alternative single-host configuration, not a
Render blueprint. It requires the documented URL-safe PostgreSQL password because
it embeds that password in its connection URI. A dry-run with synthetic URL-safe
credentials confirms all three DB URLs and private/submissions-disabled API and
worker settings resolve. A diagnostic with reserved URI characters confirms the
URL-safe constraint is real. These Compose checks are separate from the live Render pilot. No paid plan or
new DNS purchase was selected for the initial deployment.

## Publisher account setup, 18 October 2026

Namespace/team management is now controlled independently by
`EXCHANGE_NAMESPACE_MANAGEMENT_ENABLED`. Set it to `true` to allow authenticated
users to create namespaces, send owner-authorized team invitations, and accept
invitations after explicit terms acceptance. It does not grant reviewer roles,
mark publishers verified, permit uploads, or publish packages. Existing OAuth,
CSRF, membership, invitation-recipient and last-owner checks remain in place.

Keep `EXCHANGE_PUBLISHING_ENABLED=false` while scanning/signing readiness is
incomplete. The public registry and signed-in account API expose both flags so
the portal can enable account setup while clearly explaining that uploads are
closed. If the new setting is omitted, namespace management follows the existing
publishing flag for backward compatibility; an explicit `false` disables it.

## Account-only submission pilot, 18 October 2026

`EXCHANGE_PILOT_PUBLISHER_GITHUB_IDS` allows an explicit list of numeric GitHub
identities to submit while `EXCHANGE_PUBLISHING_ENABLED=false`. The deployed
pilot is restricted to the owner's verified ID, `121330302`. Other accounts and
anonymous clients remain unable to upload. Namespace membership, CSRF, terms,
immutable storage, scans and manual review still apply. The signed-in `/v1/me`
response reports that account's submission access; `/v1/registry` continues to
report public submissions disabled. The Publish page labels the pilot explicitly.

`EXCHANGE_EMBEDDED_SCANNER_ENABLED=true` runs the same scanning implementation
alongside the API in the existing Render service. It processes one job at a time,
records worker heartbeats and drains an active scan before closing database and
storage clients at shutdown. Pilot uploads require a recent scanner heartbeat.
This does not add a paid service or artificial keep-alive traffic, though scanning
and heartbeat queries consume the existing database compute allowance while the
service is awake. Render may sleep; queued work resumes when the service wakes.

This opens submission and review, **not signed marketplace installation**. Private
signing keys remain outside the API. Production trust-root provisioning,
independently distributed desktop trust and signed publication are still separate
acceptance work; the pilot does not bypass those checks or auto-approve a package.
