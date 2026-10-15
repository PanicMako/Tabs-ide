# Generic worker loses nullish payloads

At reviewed HEAD bb89383e8516d6ee6c730579be3e353a8e43a0e9, KeyedCoalescingWorker permits unrestricted V but uses undefined to mean absent and null to mean completed. An undefined queued value is never processed and remains in latestByKey. A null value enqueued while the same key is active is removed from latestByKey, skipped, and leaves activeKeys set. Consequently drainKey cannot complete normally for either state.

Independent fixture KeyedWorkerNullableAudit.test.ts: 2 failed / 2, 300ms, terminal exit 1. The pending-null case uses Deferred barriers; observed only first processed and drain race timed out at 30ms. Undefined case observed no processing after 20ms; source explains permanent pending state. Restore fixture to packages/shared/src to run. Existing 7 tests pass and restrict payloads to strings.

Current server search finds only terminal Manager production use, with non-null PersistHistoryRequest objects (selected lines 1718–1775). Thus this is a confirmed generic-helper contract defect, without demonstrated current terminal impact. Use Map.has and tagged/Option results instead of payload sentinels. No production changes made.
