# Exchange hosting decision — 15 October 2026

The existing Vercel marketing site can stay in place. The registry currently requires a Bun/Node HTTP process, PostgreSQL, private S3-compatible package storage, and a scanning worker. The Astro account/reviewer portal expects same-origin API and authentication routes. A static frontend alone does not provide those services.

## Recommended first step

Use a free Render web service for a **small pilot**, with Neon Free PostgreSQL and Neon Object Storage. Neon storage was selected after live compatibility checks on 15 October 2026, avoiding R2 subscription activation and its payment-method requirement. Keep submissions disabled until the scanner, signing ceremony, operator access, OAuth callback, backups, and trusted-client installation have been exercised against the deployed service. This is a conditional deployment plan, not an already-running registry or a guarantee of zero bills.

Render Free sleeps after 15 minutes of inactivity and can take approximately one minute to wake. It does not provide a free standalone background-worker service, and its free database expires after 30 days. Do not use that expiring database as the registry's durable store. A combined API/scanner process or an explicitly scheduled scanner needs implementation and shutdown/recovery validation before using this single-service pilot. Never keep a free host awake with artificial traffic. The root `render.yaml` now declares exactly one Free Singapore web service using the existing Neon database and private bucket. It does not provision a paid worker or database. Database migrations run before the API starts because Free does not support pre-deploy commands. Render probes `/livez` without querying Neon; `/healthz` remains the database readiness check. The Docker build context excludes local environment files and dependencies.

Neon currently includes 1 GB of database storage and 100 CU-hours per project per month, with no card required. The current worker polls and writes heartbeats continuously: while the service is awake, that activity prevents database scale-to-zero and consumes the compute allowance. Monitor the actual allowance before enabling continuous scanning.

Neon Free includes 5 GB of Object Storage and 5 GB of monthly public network transfer per project, shared across products. Keep the project on Free and account for both storage and download quotas. This does not provide unlimited package downloads. Live tests verified private access, exact-byte upload/download, idempotent identical retries, rejected different-byte overwrites, and one winner under concurrent conditional creation. See `exchange-neon-setup.md` for the completed storage setup.

R2 remains an alternative, not an active dependency. R2 Standard includes 10 GB-month of storage, one million Class A operations, and ten million Class B operations monthly, with free direct egress. Usage above that allowance is billable. No R2 subscription was activated and no payment method was added by this setup.

Render failed to check out the full monorepo because a vendored Code-OSS simulation fixture is unavailable from the fork's Git LFS endpoint. A service-level `GIT_LFS_SKIP_SMUDGE` variable did not affect Render's checkout step. The deployment source is therefore `codex/exchange-deployment`, produced by `git subtree split --prefix=tabs-app`. It contains the application workspace at its root, with no LFS pointers, while the full repository and original commits remain on the integration branch. Render uses Docker context `.` and Dockerfile `apps/exchange/Dockerfile` on this deployment branch.

After committing changes to the full repository, update the deployment projection with `git subtree split --prefix=tabs-app` and push the returned commit to `refs/heads/codex/exchange-deployment` without forcing. Verify that the projection tree matches `HEAD:tabs-app` before deploying it. Auto-deploy remains off.

## Alternatives considered

- Koyeb Free offers one 512 MB, 0.1-vCPU instance in Frankfurt or Washington, sleeps after an hour, and cannot be a worker service. Its signup/billing flow requires a card and can default to a paid plan. It is not the safest default for a strict no-spend request.
- Supabase Free combines a 500 MB PostgreSQL database and 1 GB object storage, but pauses inactive projects. Its S3 compatibility documentation does not establish the conditional PutObject behavior this registry relies on for immutable quarantine writes. Verify that exact behavior before replacing R2; do not remove the immutability check to accommodate a host.
- Cloudflare Workers would require porting the existing HTTP/PostgreSQL/worker runtime. It is a possible later architecture, not a drop-in deployment of the current implementation.

The workspace already contains an unrelated Free service, `user-management`. Both services share the workspace's monthly Free instance hours; do not assume the new service has the entire allowance or suspend the existing service without approval.

## Configuration still needed

The Free Render service `tabs-exchange-api` now has the assigned origin `https://tabs-exchange-api.onrender.com`. Database, private storage, and GitHub OAuth credentials are configured privately on Render; operator access is restricted to the owner's numeric GitHub ID. Render reports the pilot live, and HTTPS liveness, PostgreSQL readiness, portal, and catalog checks have passed. Actual owner GitHub sign-in is verified: the expected numeric GitHub identity exists in Neon with an active session, and the owner confirmed the browser completed sign-in. Reviewed publisher terms, a scanning deployment, and a production TUF root/signing arrangement remain necessary before enabling publication. Test identities and test signing roots must not replace them.

The marketing website may link to a same-origin portal on the registry host. If the Exchange portal itself is moved to Vercel, proxy authentication and API routes through the portal origin and verify cookies, CSRF, signed metadata, and streaming. Do not split protected frontend/API origins by changing a URL alone.

## Primary sources

- https://render.com/docs/free
- https://neon.com/pricing
- https://developers.cloudflare.com/r2/pricing/
- https://www.koyeb.com/docs/reference/instances
- https://www.koyeb.com/docs/faqs/pricing
- https://supabase.com/pricing
- https://supabase.com/docs/guides/storage/s3/compatibility

No new paid hosting or production keys were provisioned by this investigation.
