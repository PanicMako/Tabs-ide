# Tabs Exchange (in development)

Tabs Exchange is a separate service from the static marketing website. The
implementation lives in `apps/exchange` and has an HTTP API, PostgreSQL state,
an S3-compatible quarantine bucket, and a polling scan worker. It uses GitHub
OAuth for publisher and reviewer sessions. Uploaded bytes never enter the
public catalog until an admin approves the exact SHA-256 digest after scanning.

**Do not enable public publishing yet.** `EXCHANGE_PUBLISHING_ENABLED` defaults
to `false`. The publisher terms are a draft, the scanner does not include a
malware intelligence feed or external dependency advisory checks, and the
reviewer view does not yet present a full package diff. Production registry
metadata signing, revocation freshness, and the desktop Exchange installer are
not implemented. Desktop development builds can display compatible approved
listings from `TABS_EXCHANGE_ORIGIN`, but these listings are informational and
cannot authorize an install. The public API is therefore an experimental shape, not a
stable protocol for forks yet.

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
| `/v1/extensions?q=term&limit=30`                             | Latest approved version per extension                |
| `/v1/extensions/:namespace/:name`                            | Approved versions and verification status            |
| `/v1/extensions/:namespace/:name/versions/:version`          | Exact approved version metadata and digest           |
| `/v1/extensions/:namespace/:name/versions/:version/download` | Archive bytes, re-hashed against the approved digest |

Publisher and reviewer routes use GitHub OAuth session cookies. Mutations
require a same-origin `Origin` header and the `X-CSRF-Token` value from the
`tabs_exchange_csrf` cookie. Publisher uploads are raw `application/octet-stream`
POST bodies, capped at 25 MiB. The `tabs_exchange_session` cookie is HttpOnly.

| Route                                                 | Access                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `GET /auth/github/start`, `GET /auth/github/callback` | GitHub OAuth sign-in                                                     |
| `GET /v1/me`                                          | Current account and reviewer flag                                        |
| `POST /v1/namespaces`                                 | Signed-in publisher, exact terms version                                 |
| `GET /v1/publisher/namespaces`                        | Publisher namespace membership                                           |
| `GET /v1/publisher/submissions`                       | Publisher submission status                                              |
| `POST /v1/publisher/:namespace/:name/versions`        | Namespace owner/contributor upload                                       |
| `GET /v1/review/queue`                                | Admin reviewer                                                           |
| `POST /v1/review/:namespace/:name/:version`           | Admin decision: `approve`, `reject`, or `revoke`, with digest and reason |

The worker scans queued packages, verifies stored bytes, extracts with bounded
ZIP validation, and writes a scan result. A blocking scan result prevents
approval. Every decision writes an audit event. Revoked versions disappear
from public metadata and downloads. This is not yet a client-side revocation
notification system.
