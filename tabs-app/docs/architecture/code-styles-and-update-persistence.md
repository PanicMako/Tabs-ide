# Code styles and update persistence

Reviewed 29 October 2026 against the current local source. The findings below distinguish code behavior from a real upgrade/downgrade rehearsal: no older build was run against the user's live data.

## Why several stylesheets are loaded

Tabs combines a React shell with a native embedded Code workbench. Installed Code extensions can also render their own webviews. These are separate documents; CSS in one document cannot automatically style another.

| Layer                          | Active source                                                                     | Responsibility                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Tabs shell                     | `apps/web/src/index.css`, `radii.css`, and component styles                       | Project toolbar, outer Code toolbar, agent UI, Dock and Tabs settings                       |
| Upstream Code                  | `tabs-code-oss/src/vs/...` component styles                                       | Editor rendering, virtualized lists, menus, keyboard focus, widgets and layout              |
| Shared Tabs treatment for Code | `tabs-code-oss/src/vs/workbench/contrib/tabs/browser/media/tabs.css`              | Shared shape tokens, control and popup rounding, selection geometry and common Tabs styling |
| Embedded integration           | `tabs-code-oss/src/vs/workbench/contrib/tabs/browser/media/embeddedWorkbench.css` | Embedded layout, connected-tab painting, visibility and integration behavior                |
| Extension webviews             | Each extension's own assets                                                       | Extension-owned documents, such as an assistant's login screen                              |

Both Tabs-owned Code stylesheets are imported by `tabs.contribution.ts`. Their presence was verified in the running embedded workbench. Neither file is an unused legacy theme. Deleting either entire file would remove active behavior; deleting upstream component CSS would also break editor functionality.

The defect was overlapping ownership: the shared stylesheet defined rounded controls, while embedded rules later reset the same controls and surfaces. The earlier standalone Code check did not exercise that embedded override.

### Cleanup completed

- Shared shape declarations now live in `tabs.css`. Thirty-nine shape declarations were moved out of the embedded file and merged with matching shared rules where possible.
- Removed the embedded file's three duplicate corner-token declarations. It inherits the shared shape policy.
- All remaining radius declarations and corner tokens, including connected-tab caps and frame seams, now live in `tabs.css`. The embedded stylesheet only consumes these tokens. Removed an obsolete square-sidebar rule that was already overridden by a rounded-sidebar rule. Connected tabs keep their existing appearance.
- Synced both source stylesheets to the existing local `out/` runtime. Generated runtime CSS is a build output, not a separate design source.
- Browser regression coverage loads both files in either order, with and without `html.tabs-embedded-workbench`, and rejects radius declarations in the embedded layout stylesheet.
- Replaced the oversized outer "Search files" control with a compact "Go to file" action. It still opens native Quick Open and retains Command-P; text entry stays in the native picker.

This CSS-only work does not require a full TypeScript recompile. A previously loaded view needs its stylesheet refreshed or the Code view reopened. The earlier rounding fix was applied to the running embedded stylesheets directly; the persistent source/runtime files are also updated.

## What survives closing or updating Tabs

The installed app bundle and user data are separate. The default production state root is `~/.tabs/userdata`; paths can be changed with the existing configuration/environment options. Electron also has a persistent application profile, normally under `~/Library/Application Support/tabs` on macOS. The resolver supports populated historical profile names rather than discarding them.

| Data                                                            | Current mechanism                                                                                                                          | Expected behavior                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Projects, chat history and saved application data               | Server database, normally `statev2.sqlite` under the state root                                                                            | Retained on normal updates using the same data root                                                                          |
| Outer project tabs, active tool, browser tabs and Code UI state | Persisted workspace-shell state in the Electron renderer profile                                                                           | Restored when the same profile/storage origin is used                                                                        |
| Native Code extensions                                          | Shared `code-oss-desktop/extensions` directory under the Code state root                                                                   | Not inside the app bundle and not recreated per app version                                                                  |
| Code settings and extension registrations                       | `code-oss-desktop/shared-profile/default`                                                                                                  | Shared across project workspaces; legacy per-project registrations are reconciled                                            |
| Open Code editors                                               | Persisted per-project tab list, native Code storage and shutdown flush                                                                     | Restores supported editors for the same project identity; not a guarantee for every extension-owned editor or unsaved buffer |
| Tabs Exchange extensions                                        | `development-extensions.json`, `extension-packages`, `extension-storage`, and encrypted extension credentials under the desktop state root | Files persist, subject to compatibility, enablement and permission checks                                                    |
| Browser/extension login sessions                                | Persistent Chromium partitions and encrypted credentials                                                                                   | Usually retained in the same profile; token expiration and provider authentication policies can still require login          |
| Incognito browser sessions                                      | Non-persistent partitions                                                                                                                  | Intentionally discarded on exit                                                                                              |
| Live terminals and in-flight agent work                         | Runtime processes plus saved session metadata                                                                                              | Saved configuration/history is distinct from a running process; do not assume every live process resumes after quitting      |

Development and production identities, custom `TABS_HOME` / desktop profile paths, different browser profiles, and a new project identity can select different stores. A different store may look empty without deleting the original data. The native Code state root is separately configurable and should be checked rather than inferred from the window title.

## Downgrades and existing gaps

**Ordinary update:** the design retains data and compatible extensions. This is not the same as promising every extension runs on every future version: both native Code and Tabs extension manifests have compatibility requirements.

**Downgrade:** builds with the recovery system now preserve the newer state and restore a verified snapshot for the exact target app version before starting persistent services. If no matching snapshot exists, startup pauses without opening the workspace database. This provides a recovery path rather than making old binaries understand new schemas. The current SQLite startup layer checks the recorded migration ledger before running migrations and refuses a database that a newer/incompatible build upgraded. Its error explicitly says the saved data has been preserved and directs the user to a compatible build or verified backup. An older release that predates this guard may behave differently.

A restart also cannot restore an expired authentication token or guarantee recovery of every unsaved extension-owned document.

### Tabs-extension registry gap: fixed

Previously, `ExtensionViewManager.load()` validated manifests against the running app version and skipped incompatible entries. A later `save()` could omit those entries from the registry even though their package and profile files remained on disk.

Inventory loading now validates package structure without requiring the current app or extension API version. It still checks manifest identity, the matching on-disk manifest, package paths, directory safety, profiles, assignments and rollback metadata. Invalid packages remain excluded. Install/import operations still require runtime compatibility.

Valid but incompatible extensions remain in the installed list, marked **Incompatible**, with the required-version reason in their management view. Their enable switch is unavailable. Runtime activation, bridge authorization and agent tool discovery also check compatibility; retaining an entry does not authorize it to execute.

Compatibility blocking is derived at runtime rather than persisted as the user's disabled choice. Unrelated saves preserve the original registration, profile/permission choices and manual pause state. Reopening with a compatible app/API version removes the temporary block while respecting a user's manual pause. Update/rollback metadata is retained when otherwise valid.

Regression tests cover older/newer app versions, save/restart/return-to-compatible cycles, future API requirements, blocked activation, manual pause preservation and invalid-manifest rejection. The settings browser test covers the explanation and disabled enable switch. These tests use temporary fixtures, not the user's live data.

### Automatic desktop backups and recovery: implemented

`apps/desktop/src/dataRecovery.ts` now owns complete, immutable local snapshots of the configured desktop state root, backend `userdata` root, Electron profile, and shared native Code state root. Nested or repeated roots are deduplicated. Snapshot storage must be outside those roots. By default it lives in `~/.tabs/backups/desktop` (development uses its own bucket under `.tabs-dev/backups/desktop-dev`); `TABS_DESKTOP_BACKUP_DIR` can select a different directory outside the data stores.

Production startup claims the desktop single-instance lock and OS-released SQLite leases for the data roots before loading persistent managers. On a version transition it snapshots the existing state **before the new app opens the workspace SQLite database, native Code, extension managers, or persistent Chromium sessions**. This also covers manually replaced application bundles. The installer may already have replaced the application binary; no application-data migration has run yet. At most one additional daily snapshot is taken on subsequent startups. A manual backup uses a graceful restart so existing session flushes and backend shutdown complete before copying. Development automatic backups are opt-in with `TABS_ENABLE_DEV_BACKUPS=1`; manual backup/recovery is available there too.

Each snapshot records the source paths, producing/data version, time, reason, relative file inventory, modes, byte sizes and SHA-256 hashes. File contents and metadata are verified before the snapshot is published atomically. Files are flushed, and containing directory metadata is flushed where supported by Node. Backups have private directory permissions. Regenerable Chromium/Code caches, diagnostic logs and volatile singleton files are excluded; extension-owned files with the same names deeper in their storage remain included. Symbolic links are preserved as links without traversing their targets. Files and empty directories, including encrypted credential blobs, SQLite databases and WAL sidecars, are retained. Neither local snapshots nor encrypted credentials constitute a cross-machine authentication export.

The backup engine refuses a store whose recorded workspace-server process is still alive, rejects overlapping backup/data paths and foreign snapshot roots, and checks available disk space. Incomplete snapshot folders are not listed and are cleaned up at the next successful startup. Backup failure pauses startup before database migrations rather than opening a newer schema without a recovery point.

### Restore and downgrade behavior

When a supported desktop build detects a downgrade, it searches for the newest snapshot recorded for that exact app version. It verifies the snapshot, preserves the newer current data in a separate **before-recovery** snapshot, stages and verifies every restored root, and only then replaces live directories. An on-disk restore journal distinguishes an interrupted replacement from a committed restore awaiting cleanup. Interrupted replacements roll back to the intact original roots; committed restores finish cleanup on the next start. A fresh process then loads the restored profile and managers. Invalid journals fail closed before touching data.

If no matching snapshot exists, startup pauses and tells the user which newer version last opened the data. It preserves the current data and creates a verified before-downgrade snapshot. Retrying an unchanged blocked downgrade reuses that preservation point instead of producing duplicate copies. A recovery-only window uses an ephemeral Chromium partition and a separate renderer entry that does not import the workspace router or authentication shell. The saved auth store and default persistent Chromium session are not initialized in this mode, keeping the blocked version away from the original profile.

An initial snapshot of pre-feature data is labelled `unknown`, because the last app version cannot reliably be inferred. It is retained for manual inspection, not silently treated as proof that an older schema is compatible. A normal manual backup after the application opens records the current app version. Previously shipped binaries do not contain this recovery implementation. A supporting build can use **Prepare & quit** to verify and restore a known-version snapshot offline, preserve the current state first, and exit before any persistent services open. Then install/open the exact target release. The older binary does not need to understand the backup format. Reopening the current newer build instead will migrate the selected older data forward; the preservation snapshot remains available. The existing database compatibility guard remains enabled after restoration.

### User controls

Open **Settings → General → Troubleshooting & Recovery → Backups & recovery** to list snapshots by date, app version and size. **Restart & back up** creates a verified snapshot after shutdown. **Restore** is available for the exact running app version and has a custom confirmation explaining that running work stops and current data is preserved first. Other known-version snapshots offer **Prepare & quit**, with explicit instructions to open that matching release next. An unversioned initial snapshot remains available in the backup folder for manual review. Individual snapshots can be deleted with confirmation; current data is not deleted. **Open backup folder** provides access to the complete snapshot files and manifests.

The same controls appear on the startup error screen, so recovery does not depend on a working backend. Recovery receipts explain when older data was restored and where the newer data remains. Returning to a newer app migrates the currently selected data; to return to a previously preserved newer history, explicitly restore its matching-version snapshot. Histories from divergent snapshots are not silently merged.

Snapshots are local and retained until explicitly deleted; their count and sizes are visible in the settings list. A reset of live Tabs data keeps recovery snapshots separately, and the reset description now states this. Delete the snapshots too when intentionally removing those historical copies. Local snapshots do not protect against failure of the entire disk, and source repositories outside Tabs-owned data roots are not copied. Runtime processes cannot be resumed merely by restoring their saved files.

### Recovery verification

Temporary-directory tests cover older/newer version transitions, unsupported downgrade refusal, preservation of the newer state, content corruption, foreign paths and traversal, read-only directories, symbolic links, excluded caches versus durable extension files, missing roots, interrupted and committed restore journals, concurrent store leases, live-backend refusal, disk exhaustion, and files changing mid-copy. Real SQLite tests restore a migrated database and committed WAL data from an abruptly killed child process, then run `PRAGMA integrity_check`.

Browser tests cover restoration confirmation/cancellation, version mismatch, deletion confirmation and errors, keyboard focus restoration, a startup overlay, and a 390px-wide layout. The user's live profile was not restored or downgraded during validation.

## Verification

Backup/recovery completion checks:

- Full workspace pipeline: 18 tasks passed, including 7,594 server tests (35 intentionally skipped).
- Final desktop suite: 80 files, 692 tests passed, including 27 backup/recovery tests.
- Recovery browser journeys: 5 passed, including offline version preparation, the standalone recovery screen, focus restoration, confirmation, errors and narrow layout.
- Workspace typecheck and lint passed; the desktop bundle was rebuilt. The web production build includes the separate recovery entry, and the server build copied the updated web assets into the desktop-served `dist/client` bundle.
- The bundled Electron runtime was checked directly for the SQLite exclusive-lease support used by the desktop.

Registry-fix regression checks:

- Full workspace test pipeline: 18 tasks passed, including 7,594 server tests (35 intentionally skipped).
- Workspace typecheck and lint passed; desktop bundle rebuilt successfully.

- Desktop extension manager tests: 69 passed; desktop lifecycle integration tests: 8 passed.
- Shared manifest tests: 18 passed, including separate structural and runtime validation.
- Extension settings browser journeys: 3 passed, including compatibility explanation and the unavailable enable switch.
- Settings unit tests: 4 passed, including retained incompatible registrations.

Earlier styling/storage investigation checks:

- Code shape and toolbar browser suites: 24 checks passed, including compact-width and native-picker alignment assertions.
- Desktop storage/profile/Code extension registry tests: 83 passed.
- SQLite compatibility tests: 5 passed, including refusal of a newer migration without changing the recorded data.
- Web unit suite: 233 files, 1,764 tests passed.
- Workspace typecheck and lint passed; Code stylesheet hygiene passed.

These checks validate the relevant implementation paths, not a real release installation followed by a downgrade.

## Primary references

- Source: `apps/desktop/src/dataRecovery.ts`, `dataRecovery.test.ts`, `userDataPath.ts`, `codeHostManager.ts`, `nativeCodeHostStorage.ts`, `extensionStorage.ts`, `extensionViewManager.ts`, and `main.ts`.
- Source: `apps/web/src/workspaceShellStore.ts` and `apps/server/src/persistence/Sqlite.ts`.
- [VS Code extension storage locations and management](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace)
- [VS Code command-line profile and extension-directory options](https://code.visualstudio.com/docs/configure/command-line)
- [Electron application data paths](https://www.electronjs.org/docs/latest/api/app/)
