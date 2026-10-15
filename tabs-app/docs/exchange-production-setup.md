# Production setup proposal — not deployed

The existing marketing site stays on Vercel. The proposed canonical Exchange
origin is `https://exchange.buildwithtabs.com`, a subdomain of the existing domain.
It needs owner approval and DNS configuration; it is not provisioned. Current
Exchange routes and desktop trust require an origin root, so `/exchange` is not
a supported substitute without further implementation and acceptance.

## Proposed services

| Component    | Proposed setup                     | Application configuration                                                                                    |
| ------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Registry API | Render Docker web service          | Repository-root build context, `apps/exchange/Dockerfile`, default image command, `/healthz` health check    |
| Scan worker  | Render Docker background worker    | Same reviewed image; command `bun run --cwd apps/exchange worker`                                            |
| Database     | Render Postgres                    | Provider-supplied `DATABASE_URL`; same database for API, worker, migration, signing publication and recovery |
| Packages     | Private Cloudflare R2 bucket       | Account S3 endpoint; `S3_REGION=auto`; bucket-scoped object read/write credentials                           |
| Signing      | Separately operated offline signer | No private signing keys in API/worker environment, repository or image                                       |

Render supports Docker builds with a custom Dockerfile and command override.
Background workers run continuously without receiving incoming traffic.
[Renders Docker configuration](https://render.com/docs/docker) and
[background workers](https://render.com/docs/background-workers) establish platform
capabilities, not compatibility acceptance for this application. R2 exposes an
S3-compatible endpoint with a documented supported-operation matrix; verify every
operation used by Exchange against the real bucket before acceptance.
[Cloudflare S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/).

## Settings to prepare before any deployment

Set automatic deployments **Off** on both services. Render defaults new connected
services to deployment on commits; the owner requires explicit approval for each
deployment. [Render deployment settings](https://render.com/docs/deploys).

Use runtime secret environment variables for `DATABASE_URL`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Never set
sensitive Docker build arguments or add credential files to the build context.
Only site name, documentation URL and approved public support URL belong in
`EXCHANGE_WEB_*` build arguments. The current Docker ignore excludes `.env*`,
`.test-data`, local builds and dependency directories; production secret files
need their own explicit exclusions if that delivery mechanism is chosen.

For private staging use:

- `EXCHANGE_ORIGIN=https://exchange.buildwithtabs.com` only after that exact origin
  is chosen and configured; use a different explicitly approved staging origin
  if production and staging must be separate.
- `EXCHANGE_VISIBILITY=private`, `EXCHANGE_ALLOWED_GITHUB_IDS=121330302`,
  `EXCHANGE_OPERATOR_GITHUB_IDS=121330302`, empty `EXCHANGE_ADMIN_GITHUB_IDS`.
- `EXCHANGE_PUBLISHING_ENABLED=false`. Add another allowed identity or grant a
  reviewer only after the owner approves the specific account and access.
- Bucket endpoint and bucket name from R2; do not enable public bucket access.

Use a separate production OAuth app, exact HTTPS homepage and
`https://exchange.buildwithtabs.com/auth/github/callback`, with wildcard matching
and Device Flow disabled. The owner generates and enters the secret privately.
The existing localhost OAuth app is not production acceptance.

## Ordered acceptance gates

1. Choose provider, region, service/database sizes and budget; configure domain,
   secret ownership, approved terms/privacy/support and operational contacts.
2. Review the combined branch and pin a deployable revision/image. Local
   uncommitted work is not a deployable reviewed release. No automatic merge.
3. After explicit deployment approval, provision private staging. Run schema
   migration once before starting API/worker, then verify private bucket access
   with `storage:ready`. These commands mutate or connect to the configured
   resources; they have not been executed against production.
4. Verify HTTPS, exact-origin OAuth, real owner and second-reviewer access,
   disabled submissions, worker heartbeat, queue/scan behavior, controlled signed
   publication, signed listings, and actual desktop installation with the
   separately distributed production root. A database `/healthz` response does
   not prove storage, scanning, signing or worker readiness.
5. Run the cold backup/restore and key-rotation drills on isolated production-like
   resources; confirm package counts/digests, credential invalidation, restore
   time, responsible operator, monitoring and incident escalation. Local clone
   drills already recorded elsewhere do not establish provider recovery.
6. Obtain separate explicit approvals for production deployment, public
   visibility/submissions and npm publication. Record who operates moderation,
   signing, backup, security alerts, abuse appeals and incident response.

The bundled Compose recipe is an alternative single-host configuration, not a
Render blueprint. It requires the documented URL-safe PostgreSQL password because
it embeds that password in its connection URI. A dry-run with synthetic URL-safe
credentials confirms all three DB URLs and private/submissions-disabled API and
worker settings resolve. A diagnostic with reserved URI characters confirms the
URL-safe constraint is real. No container, cloud service, DNS change or credential
was created by these checks. Provider pricing and ownership choices are still
unresolved; no paid plan is selected or authorized by this proposal.
