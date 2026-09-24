# Tabs development extensions (experimental)

The current implementation is a desktop-only, unpacked, UI-only development
format. It is not the Tabs Exchange, and it is not compatible with VS Code
`.vsix` packages. Packaged builds reject development-folder installation and
do not load previously registered development folders.

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
root. Unsupported fields, including runtime or permissions declarations, are
rejected rather than silently ignored.

The development package has no host API. It has no Node integration, direct
network access, navigation, popups, or privileged bridge. Its files are served
from a dedicated `tabs-extension:` origin through a dedicated Electron session.
The host passes the current project and profile IDs as URL query parameters;
these are display context only, not authorization tokens.

## Enabling and profiles

In Tabs desktop development mode, open Settings > Extensions > Discover and
load the folder. The package is registered once locally. Installed settings
can show it in every project or in selected projects. A global extension can
be hidden for individual projects. Named profiles isolate the extension's
browser storage, with a default profile and optional per-project override.
The same named profile may deliberately be shared between projects. No account
credential API is available in this experimental stage.

## Not yet supported

Do not distribute this development format to users. The public `.tabsext`
installer, Exchange publishing/review service, publisher identities, downloads,
updates, revocation, permission broker, network broker, background runtime,
AI-callable tools, and account-credential storage are not implemented. Those
features require additional security and lifecycle work before a public
extension ecosystem can be enabled.
