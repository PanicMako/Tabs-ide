# Tabs Exchange (in development)

## Developer toolkit release retention

`bun run --cwd apps/exchange build:web` preserves versioned toolkit assets in
`apps/exchange/developer-releases` before rebuilding the frontend and restores
them afterward. The latest `manifest.json` is regenerated, not restored from
an older build. A collision at an existing versioned path fails the build;
existing bytes are never silently replaced.

The archive is ignored build data, not a source-controlled release catalog.
For a fresh checkout, container build or CI runner, supply the previous archive
as a trusted build artifact before running the build. Back it up alongside
published website artifacts. A clean build without that artifact cannot retain
releases it has never received. Toolkit checksums are not a signing trust root.

Tabs Exchange is a separate service from the static marketing website. The
implementation lives in `apps/exchange` and has an HTTP API, PostgreSQL state,
an S3-compatible quarantine bucket, and a polling scan worker. It uses GitHub
OAuth for publisher and reviewer sessions. Uploaded bytes never enter the
public catalog until an admin approves the exact SHA-256 digest after scanning
and the corresponding signed TUF target is published. The publisher portal
distinguishes approval from signed publication.
Approval re-reads the private quarantine object and verifies its recorded
length and digest after the scan, before recording the exact-digest decision.

**Do not enable public publishing yet.** `EXCHANGE_PUBLISHING_ENABLED` defaults
to `false`. The publisher terms are a draft. The scanner does not include a
malware intelligence feed, and its npm advisory checks cannot identify every
dependency embedded in bundled assets. The reviewer view shows bounded text
diffs but cannot display large or binary files, so reviewers must inspect the
exact archive separately. A production root signing ceremony is not implemented.
Signed-metadata events are only best-effort wake-up hints; desktop still relies
on periodic signed status checks when events are missed.
Experimental permission-neutral automatic updates are available only with an
independently pinned trust root and explicit desktop opt-in. Desktop builds can
display compatible approved listings from
`TABS_EXCHANGE_ORIGIN`; a separately provisioned trust root is required for
manual installation. The versioned native `/v1` interface is described by
`/v1/openapi.json`; it is not VS Code gallery or Open VSX package compatibility.
This testing branch has not launched a production registry or published its SDK.

## Developer ecosystem and private registries

The website documentation at `/docs/extensions` is generated partly from the
actual manifest contract and SDK declarations. The staging SDK/CLI bundle is
version 1.7.0 and supports a standalone React/TypeScript/Vite starter and a plain
HTML alternative. Authors obtain the versioned download from `/developers`;
they do not need to clone Tabs or prepare internal release tarballs. npm
publication remains separately gated on namespace ownership and release approval. Run
`node scripts/verify-extension-tutorial.mjs` to exercise both starters outside
the repository, including deterministic packaging and dependency audit.
On a machine with Electron GUI support, run
`TABS_TUTORIAL_ELECTRON=1 node scripts/verify-extension-tutorial.mjs` to additionally
load the downloaded React starter in a real `WebContentsView` and exercise
host-owned development reload. The default tutorial command does not prove
desktop loading. Neither command proves live GitHub publishing or a clean
desktop registry installation/update journey.

Optional manifest `listing` metadata requires API 1.6.0 compatibility. README
paths must be packaged Markdown; icons must be PNG/JPEG/WebP. Raw HTML is escaped,
unsafe link schemes removed, and images are restricted to declared reviewed
assets. Packaged screenshot metadata requires API 1.7.0 compatibility. No ratings,
download counts, or purported popularity are fabricated.

The registry itself serves `/extensions` and `/publisher` on its own origin.
Use these surfaces for authenticated/private deployments, not cross-site cookie
access from the static website. Set `EXCHANGE_VISIBILITY=private` and
`EXCHANGE_ALLOWED_GITHUB_IDS` to numeric account IDs. Private catalog, assets,
downloads, and TUF transport require current allowlisted authentication and use
no-store caching. Private event streams are disabled; desktop signed polling
continues. Signing is mandatory even on a private instance.

Publisher sessions can create show-once, hashed, 30-day read tokens or
namespace-bound publish tokens. Tokens are revocable and cannot administer
accounts or approve packages. Membership and private allowlisting are rechecked
per request. Browser upload derives identity from the validated manifest;
CLI upload uses the same immutable review service. The public upload limit is
25 MiB, two concurrent uploads per process, with a two-minute deadline.
Operators must configure distributed request/account limits at their proxy;
the service does not claim built-in distributed abuse prevention.

Desktop registry read credentials use an OS-backed vault separate from extension
profiles. They are bound to the exact HTTPS origin and never forwarded across
redirects. Expiry/revocation prompts reconnection, not a false package-revocation
message. Private hosting cannot erase previously downloaded packages.

Portable JSON recovery excludes OAuth state, sessions, and token hashes. Full
PostgreSQL snapshots contain them: revoke restored sessions/tokens before
reopening access so recovery cannot resurrect old credentials.

## Metadata trust work in progress

The desktop tree includes a [TUF](https://theupdateframework.io/docs/metadata/)
client adapter backed by `tuf-js`. It requires
an initial self-signed root delivered out of band, persists verified metadata
by registry origin and trust identity, rejects redirected/cross-origin metadata
requests, and looks up signed package targets at
`extensions/:namespace/:name/:version.tabsext`. Tests exercise a signed target,
target revocation, rollback, expiration, and tampering. Manual desktop
installation now uses this adapter and verifies the signed target digest and
length before presenting a permission review. Desktop checks installed versions
at startup, every minute, after system resume, and before activation, persisting signed
revocations and closing an active view when its version is revoked. Experimental
permission-neutral automatic updates require an explicit desktop opt-in and a
pinned trust root. Exchange serves signed metadata from
PostgreSQL at `/v1/tuf/metadata/:file` and approved package targets at
`/v1/tuf/targets/extensions/:namespace/:name/:version.tabsext`. The package
route returns 404 immediately after revocation, even before a new signed
targets role is published.

An operator can produce TUF metadata with standard TUF tooling outside the API
and worker, then transfer only the signed JSON files to a database-connected
machine. The staged directory must contain `root.json`, `timestamp.json`,
`snapshot.json`, and `targets.json`; include numbered root transitions and
versioned snapshot/targets files when the repository uses them. Each target
path is `extensions/:namespace/:name/:version.tabsext` and its SHA-256 and
length must match an approved database row. Run
`bun run tuf:export-targets` in `apps/exchange` with `DATABASE_URL` and S3
credentials to print a deterministic, **unsigned** `targets` map for the offline
signer. The command reads only approved database rows and verifies every
referenced private object before printing; it fails without output if any
object or identity is invalid. Review the proposed additions and removals
against the previous signed role before signing. This command neither creates
signatures nor publishes metadata, and a review decision or object can change
after export; the publication gate rechecks the signed result.
On first publication, configure
`EXCHANGE_TUF_BOOTSTRAP_ROOT_SHA256` from an independently verified root file.
Run `bun run tuf:publish /absolute/staged-directory` in `apps/exchange` with
`DATABASE_URL` set. The command verifies signatures, freshness, rollback,
exact approved targets, root transitions, and the bytes and SHA-256 of every
signed package object before committing all metadata
and its public-target index in one transaction. Schema migration rebuilds the
materialized search heads from that existing signed-target index. Heads prefer
the highest stable semantic version; prerelease-only extensions use their highest
prerelease. Run the schema migration when upgrading to apply this selection policy
to existing derived heads without changing installed package selection.
An older database without the index still needs a signed republish; approved
versions remain private until then. A local revocation immediately selects the highest
remaining signed, approved release as its search head, if one exists. It does
not authenticate the revocation for installed clients; publish updated signed
metadata promptly. No private key is read by this command or stored in the
API/worker. New targets and timestamps must be signed and published before
their current metadata expires; revocations also require a promptly updated
signed targets role.

No official root key or production signing ceremony has been provisioned yet.
Catalog JSON never authorizes installation or silent updates. Forks need their
own explicitly configured trust root and origin; see the manual desktop
configuration in [Extensions](extensions.md).

Before enabling a production release channel, drill root rotation against a
throwaway Exchange and an already-trusting desktop. Publish the next numbered
root signed to satisfy both the old and new root-role thresholds, retain every
intermediate `N.root.json`, then publish fresh timestamp, snapshot, and targets
metadata. Confirm that the desktop advances from its original pinned root,
rejects a root lacking the new-key threshold, and rejects older metadata after
the advance. Automated publication and desktop tests cover the dual-signature
gate and persisted client advance, but they are not a substitute for an
operational key ceremony and client drill. See the
[TUF root update rules](https://github.com/theupdateframework/specification/blob/master/tuf-spec.md#update-root).

## Local self-hosting

Copy `apps/exchange/.env.example` to `apps/exchange/.env` and replace every
placeholder with real values. Keep `.env` private. Use a URL-safe PostgreSQL
password because the Compose file embeds it in a connection URL. Register a
GitHub OAuth application with callback URL
`http://localhost:8787/auth/github/callback`. Then run:

```sh
cd apps/exchange
docker compose up --build
```

The single-node object store is pinned SeaweedFS 4.48, with a persistent volume,
mandatory initial S3 credentials, and a pre-created private bucket. S3 is exposed
only on loopback port 8333 (override `EXCHANGE_S3_PORT`); internal management and
filer ports are not published. The authenticated readiness service prevents API
and worker startup before the bucket is accessible. This replaces unavailable
MinIO container tags, not the registry's S3 protocol or production R2 topology.
See [SeaweedFS mini configuration](https://github.com/seaweedfs/seaweedfs/wiki/Quick-Start-with-weed-mini).
This single-node recipe is not high availability; configure replication and
tested backups before relying on it for production.

The API listens on port 8787; `/extensions` serves its same-origin marketplace
and `/publisher` serves the publisher/reviewer page. This testing branch built
the registry image and ran its migration, private API health/capabilities,
compiled marketplace transport, and worker heartbeat against isolated Docker
PostgreSQL/S3 services. That is local evidence, not a deployed Render/R2 service
or a real GitHub OAuth account acceptance test. Production credentials remain
unconfigured and submissions remain disabled.

### Cold backup and restore drill

Back up PostgreSQL **and** the private object bucket together. PostgreSQL
contains the exact reviewed digests, audit history, and published TUF metadata;
the bucket contains the archives. Keep the signing keys and independently
distributed client trust root in a separate secure backup. A database-only
restore cannot recover packages, and an object-only restore cannot recover
review decisions.

For the self-hosted Compose stack, schedule a maintenance window and stop the
API and worker before the database dump and object copy. Do not run the TUF
publication command until the copy is complete. Replace the example absolute
path below with a new private directory **outside the Git checkout** for each
backup, then run the object verifier before restarting writes:

Install the AWS CLI on the operator host. Supply `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY` through your secret mechanism, matching the private
Compose S3 account; never put secrets in command history. Substitute your
loopback S3 port if changed. The remote object-store equivalent uses its HTTPS
endpoint and appropriately scoped backup credentials.

```sh
set -e
exchange_backup_dir=/absolute/private/tabs-exchange-backup-2026-09-28
cd apps/exchange
docker compose stop api worker
mkdir -m 700 "$exchange_backup_dir"
docker compose exec -T postgres pg_dump -U tabs_exchange -d tabs_exchange -Fc > "$exchange_backup_dir/exchange.pgcustom"
AWS_DEFAULT_REGION=us-east-1 aws --endpoint-url http://127.0.0.1:8333 s3 sync s3://tabs-exchange "$exchange_backup_dir/objects/"
docker compose run --rm --no-deps api bun run --cwd apps/exchange verify:objects > "$exchange_backup_dir/object-verification.json"
```

The verifier reads every `exchange_versions` row, including private and
revoked submissions, and checks its expected object key, byte length, and
SHA-256. It reports at most the first 100 failures but counts all of them;
a nonzero failure count exits unsuccessfully. The pre-restart check verifies
the source bucket, not the copied backup; the restore drill verifies that copy.
Record the source `checked` count from `object-verification.json` and compare
it with the restored environment; zero failures with a smaller or empty
restored database is not a successful recovery.
Store and test the dump and object copy outside the machine running Exchange.
For a restore drill, create
**fresh empty** PostgreSQL and object storage. After supplying the new
environment's secrets and making the private backup directory available on
the restore host, restore with:

```sh
set -e
exchange_backup_dir=/absolute/private/tabs-exchange-backup-2026-09-28
cd apps/exchange
docker compose up -d postgres objects bucket
docker compose exec -T postgres pg_restore -U tabs_exchange -d tabs_exchange --no-owner < "$exchange_backup_dir/exchange.pgcustom"
AWS_DEFAULT_REGION=us-east-1 aws --endpoint-url http://127.0.0.1:8333 s3 sync "$exchange_backup_dir/objects/" s3://tabs-exchange
docker compose run --rm --no-deps api bun run --cwd apps/exchange verify:objects
```

Run `docker compose up -d api worker` only after verification succeeds. Confirm published TUF
metadata and a trusted desktop install/status check separately; the object
verifier does not validate signatures, database audit semantics, or signing-key
availability. Do not run a restore over a live Exchange database.
For the source environment, restart the API and worker only after its backup
verification succeeds.

For Render and R2, use the same write-freeze, database-snapshot, immutable
object-copy, restore-to-new-environment, and verification sequence with the
provider's backup tooling. Do not assume independently timed managed snapshots
are a consistent pair while submissions or signed publication continue.

For Render, `render.yaml` at the repository root declares the API, worker,
and managed PostgreSQL database. Configure all `sync: false` values in Render,
create a private Cloudflare R2 bucket, and set `S3_ENDPOINT` to the R2 S3 API
endpoint. The API's pre-deploy command creates the schema. Set the GitHub
OAuth callback to `<EXCHANGE_ORIGIN>/auth/github/callback`. Keep publishing
disabled until terms, operational controls, and security review are complete.

## Experimental API

The fork-facing public HTTP contract and client trust sequence are documented
in [Exchange registry API](exchange-registry-api.md). Publisher and reviewer
routes below are private implementation details.

Public GET routes:

| Route                                                        | Result                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| `/v1/extensions?q=term&limit=30`                             | Cursor-paginated highest-semver approved release per extension |
| `/v1/extensions/:namespace/:name`                            | Cursor-paginated approved versions and verification status     |
| `/v1/extensions/:namespace/:name/versions/:version`          | Exact approved version metadata and digest                     |
| `/v1/extensions/:namespace/:name/versions/:version/download` | Archive bytes, re-hashed against the approved digest           |

Only approved versions present in the currently published signed targets role
appear in these public routes. The catalog head is a discovery hint, not an installation authorization. When
its Tabs compatibility range excludes the current desktop version, the client
queries the approved version list and selects the highest compatible semantic
version. The package and digest must still be checked against signed metadata
before installation.

Publisher and reviewer routes use GitHub OAuth session cookies. Mutations
require a same-origin `Origin` header and the `X-CSRF-Token` value from the
`tabs_exchange_csrf` cookie. Publisher uploads are raw `application/octet-stream`
POST bodies, capped at 25 MiB. The `tabs_exchange_session` cookie is HttpOnly.
The API accepts at most two concurrent archive submissions per process, closes
excess upload connections with HTTP 429, and terminates uploads whose bodies
take longer than two minutes. Publishers can retry after an in-progress upload
finishes; invalid archives receive HTTP 400.
The Exchange validates the package format and a bounded, supported
`engines.tabs` range but does not require that range to include the server's
own Tabs build. Older supported desktop clients can therefore discover their
compatible release; each desktop still checks compatibility before install
and activation.
Quarantine objects use content-addressed keys and conditional `If-None-Match: *`
PUTs, so this API cannot overwrite an existing key. A retry may reuse an
existing object only after reading and verifying its exact size and SHA-256;
the database still rejects an already submitted version with HTTP 409. A
failed database insert can leave a private, unreferenced object for a later
retry or operator cleanup. Conditional PUT is not protection against an
administrator changing bucket objects outside this API; signed publication
and download recheck the bytes.

| Route                                                   | Access                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `GET /auth/github/start`, `GET /auth/github/callback`   | GitHub OAuth sign-in                                                     |
| `GET /v1/me`                                            | Current account and reviewer flag                                        |
| `POST /v1/namespaces`                                   | Signed-in publisher, exact terms version                                 |
| `GET /v1/publisher/namespaces`                          | Publisher namespace membership                                           |
| `GET /v1/publisher/submissions`                         | Publisher submission status                                              |
| `POST /v1/publisher/:namespace/:name/versions`          | Namespace owner/contributor upload                                       |
| `POST /v1/namespaces/:namespace/members`                | Owner invites a signed-in GitHub account for 14 days                     |
| `GET /v1/namespaces/:namespace/members`                 | Owner lists current namespace members                                    |
| `DELETE /v1/namespaces/:namespace/members/:userId`      | Owner removes access with an audited reason; last owner is protected     |
| `GET /v1/publisher/invitations`                         | Account's pending, unexpired namespace invitations                       |
| `POST /v1/publisher/invitations/:id/accept`             | Recipient accepts and becomes an owner or contributor                    |
| `POST /v1/publisher/invitations/:id/decline`            | Recipient declines a pending invitation                                  |
| `POST /v1/namespaces/:namespace/invitations/:id/cancel` | Owner cancels a pending invitation with an audited reason                |
| `GET /v1/review/queue`                                  | Admin reviewer                                                           |
| `GET /v1/review/operations`                             | Admin-only queue, worker heartbeat, and signed-publication backlog       |
| `GET /v1/review/:namespace/:name/history`               | Admin-only prior versions, uploader names, and review-action audit trail |
| `POST /v1/review/:namespace/:name/:version`             | Admin decision: `approve`, `reject`, or `revoke`, with digest and reason |
| `POST /v1/review/:namespace/:name/:version/rescan`      | Admin retry of an awaiting-review digest, with reason and audit event    |

Rescan is available only while an exact digest awaits review. It clears the old
scan result, returns the same immutable submission to the worker queue, and
records the reviewer and reason in history. It does not approve or publish the
version; the reviewer must inspect the new result and make a separate decision.

Namespace invitations are bound to the recipient's GitHub numeric account ID.
Sending an invitation does not grant publishing access; the recipient must
sign in and accept it within 14 days. Existing members cannot be re-invited,
and a second pending invitation for the same namespace and account is rejected.
Acceptance requires the current publisher terms version, recorded with the
invitation, before membership grants upload rights.
Recipients can decline, and owners can cancel a pending invitation; both
record who made the decision and release the pending-invitation slot so the
owner can invite again. Cancellation remains available when public publishing
is disabled.
Owners can remove a member with a recorded reason, but cannot remove the last
owner. A publisher upload rechecks membership at its database commit boundary,
so access removed while an archive is uploading cannot authorize its final
submission. Pending invitations issued by the removed member are revoked too.
The already uploaded private object may remain for operator cleanup.

The worker writes a database heartbeat every five seconds, including while a
scan is running. The reviewer operations view treats a heartbeat within fifteen
seconds as recent and shows the last completed scan separately. A missing or
stale heartbeat warrants investigation; a recent heartbeat does not prove that
all scans or external advisory services are healthy. Operators should alert on
this signal and queue age rather than relying on the API's database-only
`/healthz` check.
The operations view also displays each stored TUF role's expiry with a 48-hour
warning window. This is an advisory parse of the bytes already accepted by the
publication verifier, not a fresh signature check. Missing, malformed, or
expired metadata needs operator attention; monitor the timestamp role especially
closely because clients stop accepting expired metadata.
The same operations view flags revoked versions still present in the last
published signed targets role and lists the first 100 exact package digests
requiring a new signed publication. It also counts approved versions not yet
included in signed targets. Public routes suppress revoked packages immediately,
but installed clients cannot authenticate that revocation until fresh TUF
metadata removes those targets; reviewers must treat a nonzero revocation
backlog as urgent operator work.
Successful signed publication sends a PostgreSQL notification to API instances,
which broadcast a hint on `GET /v1/tuf/events` using server-sent events. The
stream carries no package identity or trust assertion. Desktop reconnects and
refreshes its pinned TUF metadata after a hint; its minute polling remains the
fallback. Revoke decisions alone do not emit an authenticated client signal:
publish fresh signed targets promptly so installed clients can verify removal.

The worker scans queued packages, verifies stored bytes, extracts with bounded
ZIP validation, and writes a scan result. It also re-downloads and verifies the
last approved archive before generating a version-to-version text diff. The
worker renews its token-bound scan claim once a minute; a claim older than ten
minutes can be reclaimed after a worker stops. A superseded worker cannot
commit its scan result. The worker reads a root npm lockfile (v2 or v3) when one
is submitted and checks up
to 200 exact public-registry package versions with the [OSV batch API](https://google.github.io/osv.dev/post-v1-querybatch/).
Only entries resolved from `https://registry.npmjs.org/` are sent to OSV;
private-registry and unresolvable entries are skipped to avoid disclosing
their names to a third party.
The reviewer sees advisory IDs and explicit `complete`, `partial`, `unsupported`,
`unavailable`, or `not-declared` coverage. Known advisories are warnings for
manual judgment, not automatic rejection: a lockfile does not prove which
dependencies are present in bundled code, and no lockfile does not prove the
absence of dependencies. Requests and responses are size-bounded and the
advisory service has a per-request timeout. The audit needs Exchange worker
egress to `api.osv.dev`; an outage is recorded as unavailable rather than
misreported as a clean result. The reviewer portal marks binary, large, or
computationally expensive diffs as
omitted, caps the preview to 40 files and 128 KiB overall, and offers the exact
archive for full inspection. If the prior approved archive fails verification,
the new submission cannot pass scanning. A blocking scan result prevents
approval. The scan records capabilities added or removed relative to the
closest approved semantic predecessor (the highest approved version below the
submission), even if approvals occurred out of order, and warns on increases.
The reviewer queue displays those changes alongside the requested capabilities
and file-change counts. Its on-demand history disclosure shows up to 100 prior
versions and 100 recorded review decisions for the extension, including
publisher and reviewer identity; raw package objects and credentials are not
exposed by that route. It also
shows declared profile-storage migrations and blocks schema downgrades that
desktop clients cannot install. This
summary does not replace inspecting the exact archive. Every decision writes
an audit event. Revoked versions disappear
from public metadata and downloads. The desktop client detects signed target
removal during periodic or activation checks and removes the revoked version's
tools from its toolbar.

Reviewers can add exact SHA-256 package or contained-file hashes to an
operator-maintained blocked-digest list in the reviewer portal. New scans fail
when they contain a blocked hash. Approval rechecks the current list under the
same transaction lock as list changes, so a previously passing scan cannot
authorize newly blocked material. Adding a hash automatically revokes matching
approved versions and records reviewer events. Removal requires a reason and
is audited; it does not restore revoked versions. After any revocation, an
operator must promptly publish updated signed TUF targets and timestamp
metadata so desktop clients receive authenticated revocation. This local feed
does not replace an external malware-intelligence or dependency-advisory feed.
Reviewers can also import 1-100 vetted entries atomically with
`POST /v1/review/blocked-digests/batch` and a JSON body of
`{"entries":[{"digest":"<lowercase SHA-256>","reason":"<reviewed reason>"}]}`.
The reviewer portal accepts the same entries as one digest and reason per line,
separated by whitespace, and validates duplicates and body size before upload.
The endpoint uses the same authenticated reviewer session, origin and CSRF
checks as individual blocks, and records each digest and matching revocation
under one database transaction. A duplicate or already blocked digest rejects
the entire batch. It does not fetch, verify, or automatically trust an external
feed; an operator must vet the source and record a reason for each hash.

## Local Service Integration Testing

To run the real local Exchange service integration suite against isolated PostgreSQL and S3-compatible storage without external dependencies or production credentials:

### Prerequisites

- Docker Engine and Docker Compose (e.g. `colima start` on macOS).

### Commands

- **Start test stack**:
  `docker compose -f apps/exchange/compose.test.yaml up -d`
- **Execute integration tests**:
  `bun run --cwd apps/exchange test:integration`
- **Stop test stack & clean up volumes**:
  `docker compose -f apps/exchange/compose.test.yaml down -v`

The opt-in integration command fails if either service is unavailable. Ordinary
`bun run test` skips this suite and does not count its cases as passes.

## Operations Hardening & Disaster Recovery Drills

Tabs Exchange includes operational helpers and tests in
`apps/exchange/src/exchangeHardening.integration.test.ts`. That suite uses
in-memory database and object-store stand-ins for backup/restore and worker
fault cases. Run the opt-in local service integration suite for PostgreSQL/S3
coverage; neither suite proves a production recovery drill.

### 1. TUF Root Rotation Drill

- **Intermediate Numbered Roots**: Intermediate root transitions (`1.root.json` -> `2.root.json` -> `3.root.json`) must be signed by both the old root key threshold and the new root key threshold.
- **Client Advancement**: Pinned desktop clients automatically advance across intermediate root versions upon fetching fresh metadata without manual re-pinning or service downtime.
- **Security Invariants**:
  - Roots signed only by the new key without old threshold signatures are rejected.
  - Roots signed with insufficient threshold signatures are rejected.
  - Rollback attacks attempting to present an earlier root version after advancing are rejected by `tuf-js`.

### 2. Key Expiry, Freshness & Mutable Catalog Drift

- **Strict Expiration**: Client rejects metadata where `expires` is in the past. Expired `timestamp.json` halts updates immediately; expired `snapshot.json` or `targets.json` prevents discovery of new targets.
- **TUF as Sole Authority**: Catalog JSON and search endpoints are treated strictly as discovery hints. If an unauthenticated catalog endpoint claims a version exists or is updated, but that version is omitted from signed TUF targets, the client refuses to download or activate it.

### 3. Signed Revocation & Fallback

- **Dual-Layer Revocation**:
  1. _Immediate Public Route Suppression_: Revoking a version immediately returns HTTP 404 on public download and search routes (`/v1/extensions/...`).
  2. _Authenticated Client Revocation_: Installed desktop clients do not accept unsigned hints or SSE events as revocation authority. An operator must publish updated signed TUF targets with the target omitted. Once published, desktop clients verify signature validity, promptly remove the target from active tools, and close open views.
- **Reconnect & Polling Fallback**: Desktop clients poll signed metadata every 60 seconds and on resume. If SSE disconnects or drops events, clients detect target omission on the next poll and apply revocation promptly.

### 4. Database & Storage Backup / Restore Procedures

- **Local test backup (`backupExchangeData`)**:
  - Version 3 captures 18 durable PostgreSQL tables, including delegated reviewer assignments and grant/revoke audit events, namespace-member audit events, publisher agreement records, and exact-digest first-publication history. Sessions, OAuth states, access tokens, and worker heartbeats are intentionally omitted; users must reconnect and reissue tokens. Operator identities remain explicit deployment configuration, not database-assigned privileges.
  - Captures S3 object bytes and their SHA-256 digests. This in-memory helper is for small local drills; it is not a scalable production backup command. Stop the API and worker before using it so database rows and objects cannot change during capture.
- **Restore (`restoreExchangeData`)**:
  - **CRITICAL SAFETY INVARIANT**: Restoration into any non-empty database or non-empty S3 bucket is **strictly rejected**. Never restore over a live database or active bucket.
  - Restores database rows in one transaction and advances serial sequences after restoring audit IDs.
  - Version 1 backups remain accepted. Missing agreement/history tables restore empty: publishers must accept current terms again, and historical publication dates remain unavailable. No consent or date is inferred from namespace membership. Run the schema migration afterward to rebuild derived heads and mark existing signed targets with unknown historical publication dates.
  - Version 1 and 2 backups have no delegated reviewer tables; those restore empty. Restore never invents reviewer access from publisher membership or historical decisions. Reprovision explicit operator configuration and deliberately reassign reviewers where necessary.
  - Uploads S3 objects and checks SHA-256 digests against the manifest.
  - Database and object storage are **not** one atomic transaction. A failed object upload can leave a partial restore; keep the target offline and retry into a fresh empty database and bucket. Use the cold `pg_dump`/object-copy procedure above for operational backups.

### 5. Worker Recovery & Operational Readiness

- **Worker Crash Recovery**: If a scan worker terminates unexpectedly mid-scan, its token-bound claim expires after 10 minutes (`claim_expires_at < now()`). The next worker iteration automatically reclaims the abandoned package and completes verification.
- **Quarantine Corruption Detection**: If quarantined object bytes in S3 are mutated or truncated before review, the scan worker detects the digest mismatch, aborts review advancement, and logs `quarantined-digest-changed`.
- **Operational Readiness beyond `/healthz`**:
  - Database ping `/healthz` verifies basic connectivity but is **insufficient** for production monitoring.
  - The reviewer-only `/v1/review/operations` response evaluates readiness and returns alerts; the reviewer page displays them. This is advisory visibility, not an external paging/monitoring service.
    - Worker heartbeat: alert if no worker heartbeat observed within 15 seconds (`worker_recently_seen === false`).
    - Queue backlog: alert if queue depth exceeds 20 packages or oldest queued package exceeds 10 minutes.
    - TUF metadata freshness: alert if any role (`root`, `timestamp`, `snapshot`, `targets`) is expired (`critical`) or expiring within 48 hours (`warning`).

### 6. Multi-Registry Origin Isolation

- Desktop trust configurations require an explicit `origin` and `trustId`.
- Verified TUF metadata, roots, and timestamps are stored in isolated disk paths partitioned by `trustId`.
- Extension credentials, profile storage, and Electron browser partitions are strictly isolated by registry origin and extension ID.
- Forked registries sharing namespace or package names cannot access or poison official registry trust state or local storage.

---

## Operator Production Go / No-Go Checklist

### Self-hosted presentation settings

Set `EXCHANGE_WEB_SITE_NAME` (up to 80 printable characters),
`EXCHANGE_WEB_DOCS_URL` (default `/docs/extensions`) and optional
`EXCHANGE_WEB_SUPPORT_URL` before building the Exchange frontend. Links accept
local paths or HTTPS URLs without embedded credentials. These are public,
build-time values, not authentication configuration; Docker Compose passes them
as image build arguments. Rebuild the image/frontend after changing them.
The bundled documentation remains available when the navigation points to an
operator's external documentation. Account and API calls stay same-origin.
`EXCHANGE_ORIGIN` remains the runtime canonical registry/OAuth origin; branding
does not change installed extension identity, trust roots, or API permissions.

| Area                | Item                                               |     Status     | Verification & Blocker Notes                                                                                                                              |
| :------------------ | :------------------------------------------------- | :------------: | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Publishing Gate** | `EXCHANGE_PUBLISHING_ENABLED = false`              |  **ENFORCED**  | Public submissions disabled by default in source and configuration.                                                                                       |
| **Trust Signing**   | Production TUF Root Signing Ceremony               |  **BLOCKED**   | External dependency: requires offline ceremony, air-gapped hardware/YubiKeys, and operator quorum.                                                        |
| **OAuth Auth**      | Production GitHub OAuth Application                |  **BLOCKED**   | External dependency: requires official Tabs organization OAuth Client ID & Secret; local fixture used for testing.                                        |
| **Infrastructure**  | Managed PostgreSQL & S3 Object Storage (R2/Render) | **UNVERIFIED** | Local container and test harnesses verified; production cloud deployment pending ops rollout.                                                             |
| **Malware Intel**   | External Threat & Malware Advisory Feed            |  **BLOCKED**   | External dependency: commercial/curated malware feed not configured; local blocked-digest DB active.                                                      |
| **AI Providers**    | Live Provider Production Credentials               |  **BLOCKED**   | Production API keys withheld per safety instructions; provider mocks active for test suites.                                                              |
| **Legal / Terms**   | Final Publisher Terms of Service                   |  **BLOCKED**   | Draft terms version `2026-09-24` active in schema; legal review required before public publishing.                                                        |
| **TUF Mechanics**   | Root Rotation & Threshold Verification             |    **PASS**    | Verified via `exchangeHardening.integration.test.ts` (1 -> 2 -> 3 chain, dual signatures, rollback rejected).                                             |
| **Data Recovery**   | Production backup and restore drill                | **UNVERIFIED** | Local helper and tests cover row/object copying, but cross-service atomicity is unavailable; perform a cold restore into a new environment before launch. |
| **Worker Faults**   | Expired Claim Reclamation & Tamper Detection       |    **PASS**    | Verified via worker unit and hardening integration suites.                                                                                                |
| **Origin Defense**  | Multi-Registry Origin Isolation & Anti-Collision   |    **PASS**    | Verified via client trust isolation and state root partitioning drills.                                                                                   |
