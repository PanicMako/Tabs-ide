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

The populated preview was checked in the browser, including catalog and version details.
The settings browser tests cover install/uninstall focus, cancellation, and switching
between extension profile forms. Verification is not complete until the outstanding
final visual review has finished. The server rerun passed 228 files and 1,848 tests
(27 skipped). The repository-wide formatting
gate currently reports 23 pre-existing unrelated files; changed-file formatting passes.
