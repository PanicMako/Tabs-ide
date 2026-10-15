# Installed Tabs stuck during startup: investigation

Investigated October 13, 2026. The initial diagnostic investigation was read-only. The subsequent authorized recovery and source changes are recorded at the end of this report.

## Confirmed cause

The installed backend crashes while replaying persisted orchestration events. The desktop shell restarts it repeatedly, while the renderer waits for `server.getConfig`. This explains both the permanent loading animation and the temporary “Some requests are slow” notification.

The installed application reports version **1.3.31** in `/Applications/Tabs.app/Contents/Info.plist`. GitHub's latest release is **1.3.34**, published October 5. The event reader in the locally available `v1.3.34` tag has the same unversioned replay query, so a simple update is not an established recovery for this database.

Primary evidence: `/Users/rushil.dev/.tabs/userdata/logs/server-child.log` and `desktop-main.log`. The backend reports:

```text
PersistenceDecodeError
OrchestrationEventStore.readFromSequence:decodeRows
Expected [legacy event types], got "message.updated"
at [12]["type"]
```

The first replay after the project projector's saved sequence 23 contains event sequences 24–40. The thirteenth row is sequence 36 (`message.updated`), exactly matching the reported index 12. The backend exits with code 1, and the shell schedules another attempt after 500 ms. There is no listening backend available to answer the renderer's requests during the failing startup.

## Database findings

Release data lives in `/Users/rushil.dev/.tabs/userdata/state.sqlite`. Read-only SQLite inspection found:

- `PRAGMA quick_check` returned `ok`: no structural corruption was detected.
- 40 orchestration events: 23 legacy events and 17 events marked `application_event_version = 2`.
- V2 entries include two `message.updated`, two `turn-item.updated`, and one `thread.metadata-updated` event.
- The actual Tabs `OrchestrationEventType` schema rejects all three of those event types. This was verified by executing `Schema.is` against the source contract.
- Existing projections contain 11 projects and one thread; all nine projector cursors are at sequence 23.
- The migration ledger records migrations 48–57 at `2026-10-07 18:42:41`, including `OrchestrationV2` at migration 54. If interpreted as UTC, that is October 8 at 00:12:41 IST.
- A separate `statev2.sqlite` also exists in the release data directory. It is a different inode from `state.sqlite`.

The incompatible rows contain valid JSON. Their event timestamps include October 6, but those timestamps do not prove when they were inserted: migration code can import old events and retain their original timestamps.

The packaged backend last appears healthy in the available log on October 6. Its first recorded failure of this kind begins October 9 at approximately 01:34 IST, and the same failure recurs October 12 and 13.

## Does development overlap with the installed app?

Normal Tabs desktop development is separated:

| Data                             | Installed Tabs                       | Tabs Dev                                 |
| -------------------------------- | ------------------------------------ | ---------------------------------------- |
| Backend database                 | `~/.tabs/userdata/state.sqlite`      | `~/.tabs/dev/state.sqlite`               |
| Electron browser/profile storage | `~/Library/Application Support/tabs` | `~/Library/Application Support/tabs-dev` |
| Desktop backend port             | Dynamically reserved                 | Independently reserved                   |

The desktop determines development mode from `VITE_DEV_SERVER_URL` or an unpackaged Electron app. Its backend bootstrap passes `devUrl` when the renderer dev URL is present. The server chooses `dev` versus `userdata` based on that URL.

A separate Git checkout or worktree alone does **not** isolate runtime data. A backend launched without the expected development configuration, a custom home directory pointing at live data, a newer harness, or a migration/testing command can still access the installed app's database.

The untracked `t3code-main` reference checkout contains V2 events and an `ApplicationEventSource` migration that introduces `application_event_version` and imports V2 events into `orchestration_events`. That matches the format found in the release database and strongly indicates a newer orchestration implementation touched it. The current reference checkout now uses `statev2.sqlite` and copies the legacy database read-only on first initialization. Its current code therefore does not establish which earlier command or revision modified `state.sqlite`.

**Confidence:** the immediate crash cause is confirmed; the identity and launch command of the writer are not established. Ordinary current Tabs development does not explain this migration by itself. Editing source files alone cannot modify an installed application's bundled code.

## Why startup never reports the real problem

1. Backend startup runs database migrations and bootstraps projectors before exposing the usable server.
2. `OrchestrationEventStore` selects every row after the projector cursor without filtering or checking `application_event_version`.
3. The legacy schema fails on V2 events.
4. The backend terminates.
5. The desktop retries; the renderer remains in the connection/loading state.

The notification describes the downstream symptom, rather than the startup exception. Unlimited retrying cannot repair a deterministic database incompatibility.

## Recovery and prevention

Recovery should first preserve consistent snapshots of both release databases and the surrounding settings/attachments. Do not reset the profile or delete the incompatible events as a shortcut: that can discard newer conversation history, and merely skipping V2 rows can hide newer state.

The safest recovery candidates are restoring a verified pre-migration backup or building an explicit compatibility conversion into a separate database copy, validating project/thread/message preservation, and only then replacing the live database while Tabs is closed. An empty isolated profile can be used as a control to verify the binary boots, but would not recover existing projects.

For a permanent product fix:

- Give experimental harnesses and separate worktrees their own explicit home directories, rather than relying only on the launch URL to isolate them.
- Reject incompatible database formats before replay with an actionable error that names the data path and preserves the database.
- Show a backend startup failure in the renderer, including a route to diagnostic logs, instead of an indefinite loading animation.
- Limit restart loops for deterministic startup failures.
- Test migrations and downgrade behavior using copies of real legacy and V2 fixtures; verify history preservation before considering conversion safe.

Relevant source locations: `apps/server/src/config.ts`, `apps/server/src/persistence/Layers/OrchestrationEventStore.ts`, `packages/contracts/src/orchestration.ts`, `apps/desktop/src/main.ts`, and `apps/desktop/src/userDataPath.ts`.

GitHub release reference: https://github.com/PanicMako/Tabs-ide/releases/tag/v1.3.34

## Recovery and implementation completed October 13

The original release databases were backed up under `~/.tabs/backups/startup-recovery-2026-10-13/`. The original live V1 file is also retained as `~/.tabs/userdata/state.pre-recovery-20261013.sqlite`. The V2 file remains untouched in the live data directory.

Recovery rebuilt a clean legacy schema, copied the legacy tables and events, and converted the imported assistant response into a supported `thread.message-sent` event. This was necessary because the original assistant event had empty text while the imported V2 message contained 1,800 characters. All 11 projects, the existing conversation, and both stored messages were retained. The recovered database passed integrity and foreign-key checks. The exact installed 1.3.31 backend booted against the copy and successfully answered `server.getConfig`. The recovered database was then installed, and the Tabs UI was visually verified past its splash screen.

Permanent source changes separate the development home (`~/.tabs-dev`) from the release home (`~/.tabs`), including direct unpackaged desktop launches. Explicit home overrides remain supported. Existing development history under `~/.tabs/dev` is retained there; the new default uses a separate development profile. Do not point experimental harnesses at `~/.tabs`.

Before running migrations, the backend now checks the migration ledger for unknown IDs or mismatched names. It emits a structured startup diagnostic and refuses incompatible data. Desktop captures that diagnostic, stops automatic retries for it, and exposes it to an accessible alert on the startup screen. Other short-lived failures receive a bounded retry budget instead of resetting the budget each time a subprocess spawns.

These prevention changes are local source changes and require a new packaged release to reach installed users. Recovery does not patch the installed binary. The full workspace test suite and typecheck passed; targeted format/lint checks passed. The whole-tree format/lint check also passed with existing lint warnings. Pre-existing formatting issues in `WorkspaceShell.tsx` and `T3_COMPARISON_2026-10-06.md` were corrected with the formatter, preserving their pending content changes.
