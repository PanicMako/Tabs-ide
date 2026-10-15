# Service launcher review

Batch325: Complete637-line source and362-line test reviewed.9 tests passed9.19s/exit0, /tmp/tabs-audit-service-launcher.log. Real OS child processes, executable Node shebangs, IPC and temp filesystem exercise commit, wrong prepared ID rollback, trial exit/database restore and stop/restart markers. Database is text; sidecars are text and absent before backup. Not actual SQLite migration or packaged single executable.

State writes flush temp file/rename/directory. Backup staged once after active child exit, includes WAL/SHM; restore marker makes interrupted rollback detectable. Commit persisted before backup deletion and child notification; recovery thereafter selects committed version.120-second prepare timeout and SIGKILL after5 seconds statically present but not covered. Wrong ID/exit rollback verified; crash recovery, sidecar preservation, rejection rules and prepare timeout remain untested.

Launcher reads state once, owns in-memory state and serial transition queue; CLI bootService start=false writes same file without common lock. Concurrent handoff remains unverified, including overwrite of CLI-selected version by an old launcher transition. stop marker is synchronously written but recovery removes stale marker; tests assert immediate marker existence, not all interleavings. No new confirmed severity assigned.
