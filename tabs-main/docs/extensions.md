# Tabs development extensions (experimental)

The desktop implementation is an experimental format for full-workspace UI
and optional pure-computation commands. It is not
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
bun packages/extension-package/src/cli.ts validate examples/hello-extension --tabs-version 1.3.17
```

The packer refuses links and special files, path collisions, missing assets,
and oversized packages. The extractor requires an expected SHA-256 digest and
only writes to a new directory. Neither command runs extension code.

## Manifest

Place `tabs-extension.json` at the root of a local folder. The dependency-free
[`@tabs/extension-api`](../packages/extension-api/README.md) package exports
the public manifest and bridge types plus the current API version. New manifests
should declare `engines.api: "^1.2.0"` when using commands, `"^1.3.0"` for AI-callable commands, `"^1.4.0"` for storage migrations, or `"^1.5.0"` for read-only Git status; older v1 manifests without it remain
compatible. Tabs validates declared API compatibility at load time. See
[`examples/hello-extension`](../examples/hello-extension/README.md) for a
working example. Version 1 requires a lowercase publisher and package name,
a URL-safe semantic version of at most 128 characters, a Tabs version range,
and 1-12 full-workspace tools. Each
tool names a packaged HTML entry. Paths must be relative to the extension
root. Supported optional capabilities are `profile-storage`, `workspace-read`,
`git-status`, `network`, `credentials`, and `ai-tools`. A `network` manifest must list 1-8 exact DNS names
in `networkHosts`; wildcards are not allowed. `credentials` requires `network`
and uses only those declared hosts. Optional `logic.entry` points to packaged
JavaScript and requires 1-8 `contributes.commands`, each with a unique ID,
label, and description. A command marked `aiCallable: true` requires the
`ai-tools` capability and an explicit grant for each project. It appears in
that project's MCP tool list and accepts one JSON object named `input`; the
host binds calls to the provider thread's current project and the desktop
rechecks enablement, grant, profile assignment, and package identity after
execution. The active extension UI may call its own command with JSON input.
Logic has no privileged host APIs; unsupported runtime and capability
declarations are rejected rather than silently ignored.
Optional `releaseNotes` is plain text (maximum 10,000 characters). Optional
`sourceUrl`, `supportUrl`, and `privacyUrl` must be HTTPS links without embedded
credentials (maximum 2,048 characters each). The Exchange displays these
publisher-supplied details alongside the supported Tabs version range and
requested capabilities. Links and release notes are informational, not a
security endorsement or installation authorization; the desktop opens links
in the system browser and renders notes as text.

The [Workspace Reader example](../examples/workspace-reader-extension/README.md)
shows storage and workspace-read capabilities with separate project grants. The
[GitHub Profile example](../examples/github-profile-extension/README.md) shows
two named account profiles using the credential broker. The
[Git Status example](../examples/git-status-extension/README.md) exercises the
project-scoped read-only Git status broker. The
[Calculator example](../examples/calculator-extension/README.md) exercises two
isolated commands from a full-workspace UI. The
[Project Companion example](../examples/project-companion-extension/README.md)
combines named profiles, project-scoped workspace reads, and a pure AI-callable
text command in one package. Its AI command receives only caller-supplied text,
not workspace or credential broker access. The
network capability also requires separate per-project consent. Its initial
bridge is `tabsExtension.network.getText(url)`: HTTPS GET only, exact declared
host, no caller headers/cookies, redirect following, or private-address DNS
answers; DNS has a five-second deadline, the whole request has a 15-second
deadline, and text responses are limited to 1 MiB. With both `network` and `credentials`
capabilities and separate project grants, an extension may call
`tabsExtension.network.getText(url, { useProfileCredential: true })` to attach a
saved Bearer token for the active account profile and exact destination host.
The extension cannot read the saved token directly. A server may still return
or reflect it in its response, so only save credentials for a service you trust.
Changing the project, grant, profile, or active view cancels in-flight requests
where possible; it cannot undo a request already delivered to the service.

The development package has no Node integration, direct network access outside the host broker,
navigation, or popups. Its files are served
from a dedicated `tabs-extension:` origin through a dedicated Electron session.
The host passes the current project and profile IDs as URL query parameters;
these are display context only, not authorization tokens.
Tabs renders a separate identity strip above the extension view with its
package ID, tool label, and registry origin or local-development source. The
extension cannot draw over that strip through its bounded native view. The
strip does not claim that a publisher is verified or that its content is safe.
Unsupported browser clients show an unavailable message instead of a blank tool.

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

Packages using `profile-storage` may declare `storage.version` (1 through 16)
and a complete chain of `storage.migrations` from version 1. Each step renames
bounded top-level keys in every Tabs profile-storage document, including
project-isolated profiles. This declarative format works for UI-only tools;
extension code never receives filesystem access. A destination key that already
exists aborts the update rather than overwriting data. On first activation of
an updated Exchange or local package, Tabs saves a bounded, exact profile-storage
snapshot, runs the migrations, and restores that snapshot with the previous
package if the new view fails to load. A crash before activation completes is
recovered from the same snapshot on the next attempt. Storage-schema updates
require manual review for Exchange installs; experimental silent updates skip them.
Changed local packages must increase their package version. This mechanism
does not migrate or roll back Chromium localStorage/IndexedDB, credentials, or
extension data changed after the new view has loaded successfully.

`window.tabsExtension.workspace.readText(relativePath)` is available only when
the manifest requests `workspace-read` and the user grants it for the current
project in Profiles & Permissions. It returns a UTF-8 text file (maximum 1 MiB)
or rejects. Paths are relative to the active project's root; the extension
cannot supply a root or project ID. The server resolves the active project's
root from its own project record and rejects traversal and links outside that
root. Grants are checked before and after the broker call, so disabling the
extension, switching projects, or revoking permission invalidates an in-flight
response. With `git-status` and a separate project grant, the UI can call
`tabsExtension.git.status()` to receive only `{ branch, dirty }` for the active
project. The extension cannot choose a repository path or Git command. A
workspace without a Git repository reports an error. Workspace write and
Git mutation brokers are not yet available.
All bridges remain bound to the active extension main frame.

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

Account credentials are configured in Profiles & Permissions, stored encrypted
by Electron's OS-backed safe storage, and never persisted in ordinary profile
storage. On Linux, Tabs refuses credential storage if Electron selects the
insecure `basic_text` backend. Shared profiles use one credential per declared
host; project-isolated profiles use a separate credential per project and host.
Normal updates retain credentials. Uninstall removes packaged code and project
assignments. For installations with a complete storage inventory, the user can
separately choose to retain named profiles, credentials, and data or delete
Tabs-managed local profile data. Deletion clears each recorded Electron partition
and scoped bridge storage, then removes retained profile names and saved
credentials. It is not secure erasure of backups or disk history. If clearing fails,
the extension stays installed so the user can retry. Older installations with
uninventoried flat-hash data may only retain data; Tabs does not claim it can
completely delete what it cannot enumerate. Retained data restores profiles
when the same source identity is reinstalled. Exchange browser partitions and bridge
storage include the registry origin in their identity, so a same-named package
from another registry cannot inherit the retained data. Local archives are also
separate from unpacked development folders. New installs write non-secret
storage under an extension-scoped directory and record browser partitions
before creating a view. Older flat-hash storage can still be read by older
installations, but cannot be completely inventoried. Their data-deletion choice
remains unavailable pending an explicit migration.

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
hours. By default it shows an update hint in Installed settings and never
downloads or activates an update in the background. Operators with an
independently provisioned TUF trust root may opt into experimental silent
updates with `TABS_EXCHANGE_AUTOMATIC_UPDATES=true`. This applies only an
approved, compatible update with no new capability or network host, while its
view is inactive and no manual review is open. A pinned, disabled, revoked,
or not-yet-enabled extension is skipped. Tabs rechecks signed metadata and the
installed package identity immediately before activation, keeps the prior
verified package for rollback, and never silently grants new access. The
setting does not make the experimental Exchange a production release channel.
Failed metadata refreshes clear stale update hints; opening a review always
repeats signed verification.
An Exchange extension can be pinned in Installed settings. Pinning persists
across restarts and reviewed updates, suppresses background update checks and
hints for that extension, but keeps manual Check for updates and Review update
available. It does not bypass registry revocation checks.

This is an experimental flow, not a production-ready release channel. Desktop checks
installed Exchange versions against fresh signed metadata at startup, every
minute, after system resume, and before activation. A version missing from signed targets, or
whose signed digest changed, is persistently marked revoked: its active view
closes, toolbar contributions disappear, and Settings explains the status.
On HTTPS registries with a configured trust root, signed-publication events
also prompt a fresh status and update check. These unsigned events only wake
the client; pinned TUF metadata still determines trust, and minute polling
continues when the event connection is unavailable.
Transport outages retain the last known status; invalid or expired metadata
does not qualify as offline. Revocation is checked every minute, including
while a view is active, rather than continuously. A newly installed Exchange or
local-package update retains the previous package and assignment until its first view loads,
including across an app restart. A failed first load restores that package
and the pre-update Tabs profile-storage snapshot. Browser storage and failures
after first load are not covered by this rollback.

## Not yet supported

Do not distribute this development format to users. Local archives do not have
publisher identity verification, approval, revocation, or authenticated
updates. An experimental Exchange API, scan worker, and publisher portal now
exist; see [Exchange development status](exchange.md). Publishing is disabled
by default. Set `TABS_EXCHANGE_ORIGIN` in a development desktop process to
display compatible approved catalog listings; HTTPS is required except for
`http://localhost` in development. Catalog entries are not trusted installation
metadata and cannot authorize an install alone. The
production update/revocation lifecycle, workspace write broker,
persistent background runtime, privileged AI tools, and full account OAuth flows
are not implemented. Those features require additional security and lifecycle
work before a public extension ecosystem can be enabled.

## Optional logic runtime spike

The desktop tree contains an `extensionLogicSpike` runtime used by optional
pure-computation commands. Explicitly granted pure commands can also be
advertised through the desktop MCP session. The Codex provider path is wired
through the authenticated MCP endpoint. Claude's SDK receives the same
thread-scoped configuration. ACP providers receive it only when they advertise
HTTP MCP support; native ACP diagnostics omit the session credential and raw
protocol traffic for that session. Mock-agent tests cover this wiring, while
live Claude and ACP-provider verification remain pending. Start a new provider
session after granting AI tools so it refreshes its MCP tool list. Each call runs one synchronous
`run(input)` invocation in a fresh Node worker hosting QuickJS-in-WASM. Its
QuickJS runtime has an 8 MiB heap limit, a 512 KiB stack limit, and an inner
deadline interrupt; the trusted caller also has an outer deadline that
terminates a stuck worker. Input and output are JSON-only and bounded, and the
guest receives no Node, network, Tabs bridge, or filesystem API. Tests cover
infinite loops, memory exhaustion, explicit cancellation, a worker blocked
outside QuickJS, worker crash/recovery, and oversized data. The desktop build
emits the worker as a separate runtime asset.

This path does not establish that arbitrary packages are safe or provide a
persistent extension background API. Privileged broker calls require separate
identity and project-grant binding, async execution semantics, packaged runtime
verification across platforms, resource measurements under sustained load, and
a dynamic AI-tool integration test with each supported provider.
