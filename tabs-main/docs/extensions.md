# Tabs development extensions (experimental)

The desktop implementation is a UI-only development format. It is not
compatible with VS Code `.vsix` packages. Development builds can load either
an unpacked folder or a local `.tabsext` archive. Packaged builds reject both
local import paths and do not load previously registered development extensions.
An experimental manually initiated Exchange install path is available only
when a registry and out-of-band trust root are configured.

The repository also contains a deterministic `.tabsext` ZIP packer and bounded
archive inspector/extractor in `packages/extension-package`. This is a package
format foundation, **not** a production installer or approval system. Use:

```sh
bun packages/extension-package/src/cli.ts pack examples/hello-extension /tmp/hello.tabsext --tabs-version 1.3.17
bun packages/extension-package/src/cli.ts inspect /tmp/hello.tabsext --tabs-version 1.3.17
```

The packer refuses links and special files, path collisions, missing assets,
and oversized packages. The extractor requires an expected SHA-256 digest and
only writes to a new directory. Neither command runs extension code.

## Manifest

Place `tabs-extension.json` at the root of a local folder. See
[`examples/hello-extension`](../examples/hello-extension/README.md) for a
working example. Version 1 requires a lowercase publisher and package name,
a semantic version, a Tabs version range, and 1-12 full-workspace tools. Each
tool names a packaged HTML entry. Paths must be relative to the extension
root. The only supported optional capability is `profile-storage`. Unsupported
runtime and capability declarations are rejected rather than silently ignored.
Optional `releaseNotes` is plain text (maximum 10,000 characters). Optional
`sourceUrl`, `supportUrl`, and `privacyUrl` must be HTTPS links without embedded
credentials (maximum 2,048 characters each). The Exchange displays these
publisher-supplied details alongside the supported Tabs version range and
requested capabilities. Links and release notes are informational, not a
security endorsement or installation authorization; the desktop opens links
in the system browser and renders notes as text.

The development package has no Node integration, direct network access,
navigation, or popups. Its files are served
from a dedicated `tabs-extension:` origin through a dedicated Electron session.
The host passes the current project and profile IDs as URL query parameters;
these are display context only, not authorization tokens.

A narrow `window.tabsExtension.storage` bridge offers `get(key)`,
`set(key, JSONValue)`, and `delete(key)` only when the manifest requests
`profile-storage` and the user grants it for that project in Settings. Tabs
binds each call to the active view's installed identity and assigned profile,
checks the project grant on every call, and limits each JSON value to 64 KiB.
This store is for non-secret data, not credentials. A shared profile
deliberately sees the same values across separately granted projects. A
project-isolated profile uses a distinct browser partition and bridge storage
namespace for each project. Choose the scope when creating a named profile;
it cannot be changed later without creating a new profile.

## Enabling and profiles

In Tabs desktop development mode, open Settings > Extensions > Discover and
load the folder or a local archive. Archives are validated and extracted into
Tabs-owned versioned storage; importing a newer archive for the same ID keeps
the previous extracted version on disk and retains assignments and profiles.
The package is registered once locally. Installed settings
can show it in every project or in selected projects. A global extension can
be hidden for individual projects. Named profiles isolate the extension's
browser storage, with a default profile and optional per-project override.
The same named shared profile may deliberately be shared between projects,
while a project-isolated profile keeps data separate even if assigned to both.
Installed settings can disable an extension independently of those project
choices. Disabling closes its active view and removes its toolbar tools, but
keeps assignments, profiles, permissions, and data for re-enabling. A revoked
version cannot be re-enabled.
No account credential API is available in this experimental stage. Uninstall
removes packaged code and project assignments, but deliberately retains named
profiles and non-secret extension data. Reinstalling the same source identity
restores the profile names and scopes. Exchange browser partitions and bridge
storage include the registry origin in their identity, so a same-named package
from another registry cannot inherit the retained data. Local archives are also
separate from unpacked development folders. New installs write non-secret
storage under an extension-scoped directory and record browser partitions
before creating a view. Older flat-hash storage can still be read by older
installations, but cannot be completely inventoried. Full profile-data deletion
is not offered until the deletion and retry workflow is complete; older
installations will require an explicit migration or a conservative unavailable
state.

## Manually installing from a trusted Exchange

Set `TABS_EXCHANGE_ORIGIN` to the HTTPS origin of an Exchange deployment and
provision these desktop environment variables independently of its catalog:

- `TABS_EXCHANGE_TRUST_ROOT_PATH`: absolute path to an independently verified
  TUF `root.json` file.
- `TABS_EXCHANGE_TRUST_ROOT_SHA256`: lowercase SHA-256 digest of that exact file.
- `TABS_EXCHANGE_TRUST_ID`: stable lowercase identifier for this registry's
  trust lineage, such as `official` for a future official root. Do not change
  it on routine root rotation because the client stores rollback-protected
  metadata under this identity.

There is no official production root yet. Desktop discovery remains read-only
without these settings. With them, **Review & install** refreshes signed TUF
metadata, downloads and validates the exact signed package, and presents its
manifest and requested capabilities for a separate confirmation. Installation
does not run or enable a new extension automatically. The installed identity
includes the registry origin; a same-named package from another registry
cannot silently replace it. Packaged builds can load these verified packages
after restart, while development-only imports remain unavailable there.
Installed settings can check one Exchange extension for a newer compatible,
approved release. The version list is informational: Tabs matches the candidate
to fresh signed metadata before offering Review update, then uses the same
package download and consent flow. The installer rejects downgrades and a
changed digest for an already installed version, including if the installed
version changes while an update review is open.
Desktop also checks for signed, compatible updates after startup and every six
hours. It shows an update hint in Installed settings and never downloads or
activates an update in the background. Failed metadata refreshes clear stale
update hints; opening a review always repeats signed verification.

This is a manual flow, not a production-ready release channel. Desktop checks
installed Exchange versions against fresh signed metadata at startup, every
minute, after system resume, and before activation. A version missing from signed targets, or
whose signed digest changed, is persistently marked revoked: its active view
closes, toolbar contributions disappear, and Settings explains the status.
Transport outages retain the last known status; invalid or expired metadata
does not qualify as offline. The flow does not yet check revocation continuously
while a view is active, automatically install updates, or provide package
rollback, pinning, or profile-data deletion controls.

## Not yet supported

Do not distribute this development format to users. Local archives do not have
publisher identity verification, approval, revocation, or authenticated
updates. An experimental Exchange API, scan worker, and publisher portal now
exist; see [Exchange development status](exchange.md). Publishing is disabled
by default. Set `TABS_EXCHANGE_ORIGIN` in a development desktop process to
display compatible approved catalog listings; HTTPS is required except for
`http://localhost` in development. Catalog entries are not trusted installation
metadata and cannot authorize an install alone. The
production update/revocation lifecycle, workspace/network/credential
brokers, background runtime, AI-callable tools, and account-credential storage
are not implemented. Those features require additional security and lifecycle
work before a public extension ecosystem can be enabled.
