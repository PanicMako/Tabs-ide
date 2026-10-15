# Exchange PostgreSQL on Neon

The Exchange database is linked to Neon project `orange-credit-28098153`, branch `production`, in Singapore. Neon hosts PostgreSQL; the Exchange HTTP service still needs its Render deployment. Existing GitHub OAuth and S3-compatible storage remain the application architecture.

## Local setup

Run commands from `tabs-app/apps/exchange` in the integration checkout. The project uses Bun workspaces and the existing `pg` driver. Do not install a second ORM or replace this driver with an HTTP-only driver: Exchange uses transactions and PostgreSQL notifications.

```sh
neon login
neon link --org-id org-nameless-voice-99839565 --project-id orange-credit-28098153 --branch production -y
neon config plan
neon deploy
```

The CLI writes `.neon` and `.env.local`, both ignored by Git. Never commit credentials. Preserve any pre-existing environment values before rerunning setup; `neon deploy` pulls Neon-managed variables after applying configuration.

## Runtime connections

- `DATABASE_URL`: pooled application traffic.
- `DATABASE_URL_UNPOOLED`: direct connection for migrations and the dedicated `LISTEN` session.
- `NEON_BRANCH`: CLI branch metadata; not a Git branch.

Configure both connection strings as secrets in Render. A pooled connection must not be used for the notification listener. Local PostgreSQL deployments using a direct `DATABASE_URL` can omit `DATABASE_URL_UNPOOLED`.

`neon deploy` reconciles Neon services. It does not start the Exchange API on Render, apply the application SQL schema, configure GitHub OAuth, or configure package storage. Application schema migrations use `bun run migrate`; validate them on a temporary database branch before production.

## Verification on 15 October 2026

- CLI installation: Neon 8.4.5. Official `neon`, `neon-postgres`, and `neon-postgres-branches` agent skills installed.
- `neon deploy`: no changes required; production already matches the PostgreSQL-only policy. Three variables pulled into the ignored environment file.
- A temporary database branch passed initial migration and a second idempotency pass, transactional write/read/rollback through pooled PostgreSQL, direct LISTEN with pooled NOTIFY, and the real Exchange HTTP health and catalog endpoints.
- The same checks passed against production. Production initially had zero public tables; the application schema was installed. No test publishers, credentials, or extension packages were inserted. The write/read probe used a temporary table inside a rolled-back transaction.
- `npm run build` from `tabs-app`: 6 successful tasks. Exchange `build:portal` also passed separately.
- Exchange test suite: 430 passed, 24 skipped. Skipped external-service suites are not claimed as new Neon acceptance coverage.
- Exchange TypeScript check passed. Full registry sign-in, upload, scanning, and trusted installation still need the remaining real deployment configuration.

The first temporary-branch creation attempt with an explicit suspend timeout was rejected by the Free plan. Retrying with its default timeout succeeded. The current PostgreSQL driver also emitted an SSL-mode deprecation warning for Neon's generated `sslmode=require` URLs; this did not fail connections and no certificate verification was disabled.

The initial Code OSS precommit attempt was blocked by missing build-folder dependencies, including `gulp-merge-json`. Installing the existing build lockfile with `npm ci --ignore-scripts --no-audit --no-fund` repaired the consolidation worktree. `npm run precommit` then exited successfully (no staged Code OSS files), and an explicit hygiene check of `build/lib/gulp/facade.ts` passed. No build manifest, lockfile, or application source changes were required for that dependency repair. This does not claim a full Code OSS source audit.

## References

- https://neon.com/docs/connect/connection-pooling
- https://neon.com/docs/introduction/branching
- https://github.com/neondatabase/agent-skills

## Verified private object storage

Neon Object Storage is now declared in `apps/exchange/neon.ts` as private bucket `tabs-exchange` on production. No R2 subscription, paid Neon plan, or payment method was activated. The temporary compatibility branch was separate from production and removed after validation.

The application accepts Neon's generated `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`. Explicit `S3_*` settings retain precedence for existing deployments. `S3_BUCKET=tabs-exchange` selects the production bucket. Publishing remains disabled until the remaining production configuration and acceptance checks are complete.

Live checks passed on both temporary and production storage:

- Authenticated private bucket access.
- The real Exchange `putImmutablePackageObject` and `boundedObject` helpers upload and retrieve identical bytes.
- Retrying identical bytes succeeds; different bytes cannot overwrite the same key, and the original content remains intact.
- Two simultaneous conditional writes produce exactly one success and one HTTP 412.
- Anonymous object access is denied.

The probe objects were removed. These checks validate the required behavior despite conditional writes not being documented explicitly in Neon's compatibility table. They do not prove real GitHub sign-in or a public Render deployment.

Exchange tests after storage wiring: 431 passed, 24 skipped. `npm run build` succeeded (6 tasks), Exchange typecheck passed, and workspace `vp check` reported zero errors with existing warnings.

Stay within Free-plan limits: 5 GB of object storage and 5 GB/month of public network transfer shared across products. A working storage connection does not remove these quotas or the separate database compute allowance.
