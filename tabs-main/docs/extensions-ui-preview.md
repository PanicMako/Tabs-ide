# Extensions UI preview

The redesign lives on `codex/tabs-extensions-testing`. It has not been merged or deployed.

## Website

The ordinary marketing preview is at `http://127.0.0.1:4321/extensions`.
Without an Exchange origin, it intentionally shows the unavailable catalog state.

For a populated, read-only design preview, run these commands in separate terminals
from `tabs-main/apps/marketing`:

```sh
bun scripts/preview-exchange.ts
```

```sh
PUBLIC_TABS_EXCHANGE_URL=http://localhost:4332 \
PUBLIC_TABS_EXCHANGE_PREVIEW=true \
bun run dev --host localhost --port 4322
```

Open `http://localhost:4322/extensions`. The fixture API reads the six repository
sample manifests. The preview banner distinguishes them from real approved listings.
Publishing and package downloads are unavailable. The fixture server accepts only GET,
binds to loopback, and does not access credentials, databases, or package storage.
The preview banner/behavior is development-only, never part of a production build.

## Desktop

From `tabs-main`, use isolated test data:

```sh
TABS_HOME="$PWD/.test-data/server" \
TABS_DESKTOP_USER_DATA_DIR="$PWD/.test-data/desktop" \
TABS_DEV_INSTANCE=extensions-testing \
bun run dev:desktop
```

Settings > Extensions contains Discover, Installed, and Profiles & Permissions.
The latter selects one extension at a time to avoid stacking account forms.
Existing grants, credential storage, package checks, and install consent are unchanged.

## Review scope

- Website: shared Exchange navigation, responsive catalog cards, publisher guidance,
  extension version details, search empty/error states, and puzzle identity.
- Publisher service: light cards and controls matching the website, without changing
  authentication, submission, or review behavior.
- Desktop settings: theme-token styling, spacing, status badges, project grouping,
  empty states, and extension selection for account/access management.
- Unrelated application screens and the Tabs product logo remain unchanged.

The populated preview was checked in the browser, including catalog, search filtering,
no-result state, and version details. At the mobile breakpoint the document had no
horizontal overflow; the package-integrity disclosure opened with Enter.
The settings browser tests cover install/uninstall focus, cancellation, and switching
between extension profile forms. The final full workspace suite passed all 17 tasks
with `bunx turbo run test --concurrency=2 --force` (5m 6s). Default-concurrency runs
hit short timeouts in unrelated server/ACP tests; test timeouts were not changed.
The server task passed 228 files and 1,848 tests (27 skipped). All 15 workspace
typechecks passed, and all three targeted browser tests passed. The 23 pre-existing formatting failures were
mechanically formatted and their diff reviewed without changing behavior. `vp check`
now passes with existing lint warnings, using `NODE_OPTIONS=--max-old-space-size=8192`
because the default lint process exhausted its heap.

The vendored Code-OSS commit hook cannot start because its `event-stream` dependency
is missing. The hook was attempted; scoped commits bypass it without changing the
hook configuration or any Code-OSS files. This limitation is separate from the Tabs
workspace checks above.
