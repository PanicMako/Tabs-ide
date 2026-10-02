# Tabs Exchange public registry API (experimental)

This describes the current HTTP contract for a Tabs-native registry. It is
independent of GitHub OAuth, publisher submission, reviewer administration,
Render, PostgreSQL, and R2. A fork may implement these public routes with a
different backend and trust root. This is an experimental v1 shape; do not
claim compatibility with VS Code `.vsix` or Open VSX registry clients.
The draft [OpenAPI document](../apps/exchange/src/public-openapi.json) is also
served at `GET /v1/openapi.json` for client generation and contract checks.

All paths are relative to one configured HTTPS registry origin. Responses use
JSON unless noted. The official desktop client sends no cookies, rejects HTTP
redirects and changed response URLs, bounds search JSON to 4 MiB and version
JSON to 8 MiB, and validates manifest identity and compatibility. Public catalog data is a
**discovery hint**, never authority to install or update executable bytes.

| Route                                                              | Response                                                                                                                                                                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /v1/extensions?q=term&limit=30`                               | `{ "extensions": [release, ...], "nextCursor": string \| null, "hasMore": boolean }`; one highest stable published release per identity, with a highest-prerelease fallback when no stable exists. At most 100 per page. |
| `GET /v1/extensions/:namespace/:name/overview`                     | The same current signed release, without fetching version history. This presentation default does not resolve desktop compatibility.                                                                                     |
| `GET /v1/extensions/:namespace/:name`                              | `{ "versions": [release, ...], "nextCursor": string \| null }`; up to 100 published versions, newest submission first. Pass `?cursor=<opaque>` to get the next page. An unknown identity returns 404.                    |
| `GET /v1/extensions/:namespace/:name/versions/:version`            | One exact published release with `downloadUrl`.                                                                                                                                                                          |
| `GET /v1/extensions/:namespace/:name/versions/:version/download`   | Archive bytes with SHA-256 `Digest` and `ETag` headers. This URL is convenient for people but does not independently authorize desktop installation.                                                                     |
| `GET /v1/tuf/metadata/:file`                                       | Signed TUF JSON (`root.json`, `timestamp.json`, `snapshot.json`, `targets.json`, and supported numbered role files).                                                                                                     |
| `GET /v1/tuf/targets/extensions/:namespace/:name/:version.tabsext` | Exact approved archive bytes, only while the version remains approved and present in the published signed target index.                                                                                                  |
| `GET /v1/tuf/events`                                               | Optional `text/event-stream` with `signed-metadata` refresh hints. Reconnect or poll if unavailable; events are never installation or revocation authority.                                                              |

A `release` includes `namespace`, `name`, `version`, lowercase SHA-256
`digest`, `manifest`, `submitted_at`, and `verified`. The exact package route
also includes `bytes`; the exact-version JSON route includes `downloadUrl`.
`verified` means ownership proof was reviewed, not merely that a namespace
account exists. Only manually approved versions included in the most recently
published signed targets role appear in public results. A revoked version is
removed from public JSON and download routes immediately, even if operators
have not yet published the updated signed metadata. Operators must publish a
fresh signed removal promptly so already installed clients can authenticate
the revocation.

Search covers identifiers, display names, descriptions, and keywords, with
literal wildcard matching. The default sort is relevance for a nonblank query,
newest otherwise. Relevance prioritizes exact names, partial names, keywords,
then descriptions. Name sorts trimmed, case-folded display names with identity
tie-breakers using PostgreSQL C collation. Newest uses first signed-publication
time, with unknown historical dates last. `first_published_at` is null when that
date cannot be recovered; upload and migration dates are never substituted.

Search cursors are opaque keyset positions for the selected sorting;
keep the same `q`, `category`, `sort`, and `limit` while following them. Legacy
identity-only name cursors and upload-date newest cursors require restarting
without a cursor. `hasMore` is not a total match count. Version-list cursors are
opaque and must be passed back unchanged. They are
keyset positions over exact submission time and version, not an authorization
token. Clients should reject duplicate versions, repeated cursors, oversized
pages, and a registry that never terminates pagination. Tabs desktop and the
legacy marketing detail page currently accept at most ten pages (1,000 versions) per
identity. The dedicated Exchange overview loads independently of paginated
history and does not require collecting all releases. A response without `nextCursor` is treated as a one-page legacy
registry response. Search may still return a release incompatible with the
current Tabs build; clients should inspect the version pages for a compatible
release and then verify its signed target before installation.

For installation, bootstrap an independently verified self-signed TUF root and
pin its SHA-256 and stable trust lineage outside the catalog. Fetch signed
metadata from the same registry origin, verify TUF signatures, freshness,
rollback protection, and root rotation, then resolve the target at
`extensions/:namespace/:name/:version.tabsext`. Download the archive from the
TUF target route and verify the signed length and SHA-256 before validating the
`.tabsext` archive and asking for permission consent. The installed identity
must include registry origin, publisher namespace, and package name. Registry
JSON, an `ETag`, or the public download endpoint alone cannot replace those
checks. See [Extensions](extensions.md) for the package format and desktop
trust settings.

## Structured errors and recovery

API failures include `code`, `message`, `recovery`, and the backward-compatible
`error` alias. Known categories include `INVALID_REQUEST`,
`AUTHENTICATION_REQUIRED`, `ACCESS_DENIED`, `NOT_FOUND`, `STATE_CONFLICT`,
`PACKAGE_TOO_LARGE`, `UNSUPPORTED_MEDIA`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE`,
and `INTERNAL_ERROR`. Publishing additionally distinguishes
`TERMS_ACCEPTANCE_REQUIRED`, `VERSION_ALREADY_SUBMITTED`, and
`PUBLISHING_DISABLED`. Clients should use known local guidance and HTTP-status
fallbacks, not echo arbitrary diagnostics from an untrusted registry.

Authentication expiry calls for sign-in or token reconnection; it does not mean
an installed package was cryptographically revoked. A failed or timed-out
mutation may already have been accepted. Check its recorded state before
retrying; recovery text never instructs the client to retry automatically.
