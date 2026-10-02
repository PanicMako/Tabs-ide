# Tabs extension CLI (unpublished)

Node 22.12+ command-line tooling for native `.tabsext` packages, not VS Code VSIX.
Build with `bun run build`, then `npm pack` to create a standalone release tarball.
Install that tarball with npm. The bundle has no private workspace dependencies.
`@tabs/extension-api` is packaged separately with `npm pack` in its directory.

Until npm publication, download the developer bundle and use `tabsext init my-tool --sdk /absolute/tabs-extension-api-1.6.0.tgz --tabs-version 1.3.17`. Use the desktop testing version from the bundle's release.json if different. The project records this target in `.tabsext.json`; there is no hidden version default. Use `--json` for automation and `--help` for command usage.
Then `cd my-tool`, `npm install`, `npm run build`, `tabsext validate`, `tabsext pack`.
`init --template html` creates a zero-build static UI alternative.
`dev` watches local packaged builds; reload the tool in Tabs development mode.
Load `.tabs-extension` from Settings > Extensions > Discover > Load development folder.

Commands: `init`, `validate`, `pack`, `inspect`, `dev`, `publish`, `status`, `registry`, `search`.
Use `--tabs-version` to override the default local test target (1.3.17).
Use `--registry https://your-registry.example` or `TABS_EXCHANGE_ORIGIN` for registry commands.
`publish package.tabsext` and `status publisher name version` use `TABS_EXCHANGE_TOKEN`.
Never put a token in a URL or commit it. CLI tokens cannot bypass manual review/signing.
`registry` fetches the registry's declared protocol, limits, and visibility.
`search [query]` browses approved listings; private instances require a read token.
Search results never authorize installation without independently trusted TUF metadata.
Publishing requires a deployed registry with submissions enabled and a scoped token.
See the website `/docs/extensions` for SDK, publishing, and self-hosting documentation.
