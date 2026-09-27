# Tabs Exchange (in development)

Tabs Exchange is a separate service from the static marketing website. The
implementation lives in `apps/exchange` and has an HTTP API, PostgreSQL state,
an S3-compatible quarantine bucket, and a polling scan worker. It uses GitHub
OAuth for publisher and reviewer sessions. Uploaded bytes never enter the
public catalog until an admin approves the exact SHA-256 digest after scanning
and the corresponding signed TUF target is published. The publisher portal
distinguishes approval from signed publication.

**Do not enable public publishing yet.** `EXCHANGE_PUBLISHING_ENABLED` defaults
to `false`. The publisher terms are a draft. The scanner does not include a
malware intelligence feed, and its npm advisory checks cannot identify every
dependency embedded in bundled assets. The reviewer view shows bounded text
diffs but cannot display large or binary files, so reviewers must inspect the
exact archive separately. A production root
signing ceremony and continuous revocation checks are not implemented.
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
revocations. Continuous active-view checks and automatic updates are not
implemented. Exchange serves signed metadata from
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
exact approved targets, and root transitions before committing all metadata
and its public-target index in one transaction. After upgrading an existing
Exchange database, republish the current signed bundle to populate that index;
approved versions remain private until then. No private key is read by this command or stored in the
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

For Render, `render.yaml` at the repository root declares the API, worker,
and managed PostgreSQL database. Configure all `sync: false` values in Render,
create a private Cloudflare R2 bucket, and set `S3_ENDPOINT` to the R2 S3 API
endpoint. The API's pre-deploy command creates the schema. Set the GitHub
OAuth callback to `<EXCHANGE_ORIGIN>/auth/github/callback`. Keep publishing
disabled until terms, operational controls, and security review are complete.

## Experimental API

Public GET routes:

| Route                                                        | Result                                               |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| `/v1/extensions?q=term&limit=30`                             | Highest semver approved version per extension        |
| `/v1/extensions/:namespace/:name`                            | Approved versions and verification status            |
| `/v1/extensions/:namespace/:name/versions/:version`          | Exact approved version metadata and digest           |
| `/v1/extensions/:namespace/:name/versions/:version/download` | Archive bytes, re-hashed against the approved digest |

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

| Route                                                 | Access                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------- |
| `GET /auth/github/start`, `GET /auth/github/callback` | GitHub OAuth sign-in                                                       |
| `GET /v1/me`                                          | Current account and reviewer flag                                          |
| `POST /v1/namespaces`                                 | Signed-in publisher, exact terms version                                   |
| `GET /v1/publisher/namespaces`                        | Publisher namespace membership                                             |
| `GET /v1/publisher/submissions`                       | Publisher submission status                                                |
| `POST /v1/publisher/:namespace/:name/versions`        | Namespace owner/contributor upload                                         |
| `GET /v1/review/queue`                                | Admin reviewer                                                             |
| `GET /v1/review/:namespace/:name/history`             | Admin-only prior versions, uploader names, and review-decision audit trail |
| `POST /v1/review/:namespace/:name/:version`           | Admin decision: `approve`, `reject`, or `revoke`, with digest and reason   |

The worker scans queued packages, verifies stored bytes, extracts with bounded
ZIP validation, and writes a scan result. It also re-downloads and verifies the
last approved archive before generating a version-to-version text diff. The
worker reads a root npm lockfile (v2 or v3) when one is submitted and checks up
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
