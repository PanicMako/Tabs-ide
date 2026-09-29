# Tabs Exchange (in development)

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
manual installation. The public API is therefore an experimental shape, not a
stable protocol for forks yet.

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
length must match an approved database row. On first publication, configure
`EXCHANGE_TUF_BOOTSTRAP_ROOT_SHA256` from an independently verified root file.
Run `bun run tuf:publish /absolute/staged-directory` in `apps/exchange` with
`DATABASE_URL` set. The command verifies signatures, freshness, rollback,
exact approved targets, root transitions, and the bytes and SHA-256 of each
newly published package object before committing all metadata
and its public-target index in one transaction. Schema migration rebuilds the
materialized highest-semver search heads from that existing signed-target index.
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

The API listens on port 8787 and `/publisher` serves the publisher/reviewer
page. This checkout could not execute the stack because the Docker daemon was
not running; only `docker compose config` was validated.

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

```sh
set -e
exchange_backup_dir=/absolute/private/tabs-exchange-backup-2026-09-28
cd apps/exchange
docker compose stop api worker
mkdir -m 700 "$exchange_backup_dir"
docker compose exec -T postgres pg_dump -U tabs_exchange -d tabs_exchange -Fc > "$exchange_backup_dir/exchange.pgcustom"
docker compose run --rm --no-deps -v "$exchange_backup_dir:/backup" --entrypoint sh bucket -c 'mc alias set exchange http://minio:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" && mc mirror exchange/tabs-exchange /backup/objects'
docker compose run --rm --no-deps api bun --cwd apps/exchange run verify:objects > "$exchange_backup_dir/object-verification.json"
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
docker compose up -d postgres minio bucket
docker compose exec -T postgres pg_restore -U tabs_exchange -d tabs_exchange --no-owner < "$exchange_backup_dir/exchange.pgcustom"
docker compose run --rm --no-deps -v "$exchange_backup_dir:/backup:ro" --entrypoint sh bucket -c 'mc alias set exchange http://minio:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" && mc mirror /backup/objects exchange/tabs-exchange'
docker compose run --rm --no-deps api bun --cwd apps/exchange run verify:objects
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
