# Automatic Exchange metadata renewal

Extension approval belongs to a particular immutable version and package digest.
It does not expire every day. Public users can browse and download without signing
in. Each new version still needs review and an explicitly signed publication.

The short-lived TUF metadata surrounding those approvals needs automatic renewal.
The renewal signer refreshes only versions already in the signed publication and
still approved. It does not add newly uploaded or newly approved unpublished
versions. Explicitly revoked versions are removed on the next renewal, even if
the existing timestamp is fresh. Installed versions open using their saved
approval while background signed checks continue to apply revocations.

## One-time operator setup

Use the existing encrypted signing backup on the operator's own trusted device.
Do not upload that backup, its password, or the root private key to the registry,
GitHub, or a chat. The exporter validates the backup and writes only the three
separate non-root role keys to a new private file. It never prints keys, echoes
the password, or overwrites an existing output file.

From `tabs-app/apps/exchange`, run:

```sh
bun run tuf:export-online-keys /absolute/signing-backup.json /absolute/exchange-online-signing.json https://exchange.buildwithtabs.com
```

The output is a secret, not a public connection file. It includes the exact
registry origin and existing public root fingerprint. Keep it out of the
repository. Separate root/online keys are required; a legacy root reusing the
same key across roles must be rotated before enabling renewal.

## Registry renewal on demand

Provision the output as a protected secret file on the registry host and set
`EXCHANGE_ONLINE_SIGNING_KEY_FILE` to its absolute path. On Render, use a secret
file named `/etc/secrets/exchange-online-signing.json`. The provided Docker startup
script copies that read-only mount into a private runtime directory with mode
0600; it does not change the platform-managed source. The documented filename is
excluded from Docker build contexts and Git so the key is not baked into an image.
If you rename the hosting secret, add that filename to both ignore files first.
Deploy the registry code containing this feature. Existing database
and storage configuration continues to apply; there is no database migration.

Before serving `timestamp.json`, the registry checks freshness. If renewal is due,
it signs and verifies the next metadata versions under the existing publication
lock before returning the timestamp. Concurrent readers share that operation.
Successful checks are cached for 30 seconds. A sleeping registry therefore
recovers on the first installation request without an operator login or an
external scheduler. A failed renewal is not cached as successful and does not
serve stale timestamp bytes as a substitute.

Verify anonymously by requesting `/v1/tuf/metadata/timestamp.json` and confirming
its expiry is in the future. Repeat the request and check that an already-fresh
publication does not keep increasing version numbers. Check the operator freshness
dashboard and install a previously published version from a fresh desktop profile.

## Optional scheduled renewal

The `Renew Exchange metadata` GitHub Actions workflow runs every six hours when
the repository variable `EXCHANGE_AUTO_RENEWAL_ENABLED` is `true`. Provision these
Actions secrets first:

| Secret                          | Contents                            |
| ------------------------------- | ----------------------------------- |
| `EXCHANGE_ONLINE_SIGNING_KEYS`  | The exported non-root signing JSON  |
| `EXCHANGE_DATABASE_URL`         | Registry database connection string |
| `EXCHANGE_S3_ENDPOINT`          | Private package storage endpoint    |
| `EXCHANGE_S3_ACCESS_KEY_ID`     | Storage access key                  |
| `EXCHANGE_S3_SECRET_ACCESS_KEY` | Storage secret key                  |

The workflow uses the official origin and `tabs-exchange` bucket. Custom operators
must adapt those public settings. It checks out trusted default-branch source,
never pull-request artifacts, and exposes signing material only in the renewal
step. The key file is private, temporary and removed afterward. To load the
signing secret without printing it, use GitHub's settings or:

```sh
gh secret set EXCHANGE_ONLINE_SIGNING_KEYS < /absolute/exchange-online-signing.json
```

Merge the workflow onto the default branch before enabling or dispatching it.
[GitHub schedules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) can be delayed or disabled for inactive repositories; the
registry's on-demand signer is the availability path, not a promise that a hosted
cron job always runs on time. Enable failure notifications and retain freshness
monitoring. The renewal command can also run on a dedicated scheduled host:

```sh
EXCHANGE_ONLINE_SIGNING_KEY_FILE=/absolute/exchange-online-signing.json bun run tuf:renew
```

## Trust and operational boundaries

Renewal validates the pinned root, all current role signatures and hash/version
links, exact reviewed identities, and package objects. It reuses the normal TUF
publication verifier and transaction, preserving rollback and atomic-publication
checks. Only the signed wrappers receive new versions and expiries. No unsigned
catalog response can authorize an install or update.

The automatic role keys are sensitive: isolate the signer, restrict host/repository
administration and store secrets using the hosting platform's protected facilities.
The browser publication API continues to reject private signing material. A
compromised online signing environment requires role-key rotation with the offline
root; automatic renewal is not a replacement for key custody or incident response.

The root remains offline and is never renewed by this service. Its annual expiry
and key rotation still require planned operator maintenance. Provision the updated
root pin and role keys after rotation. Missing keys, an expired or changed root,
bad signatures, changed object bytes, and database/storage outages remain real
errors; they must not be concealed by disabling signature or expiry checks.

This separates routine metadata renewal from human version approval, following
the [TUF role model](https://theupdateframework.org/docs/metadata/).
