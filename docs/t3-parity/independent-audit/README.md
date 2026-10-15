# Historical audit archive

These files preserve investigation snapshots and diagnostics from earlier worktrees. They are historical evidence, not the current application test suite or a release-readiness certificate. Some source snapshots retain imports relative to their original locations and cannot run from this directory.

The root Vitest configuration excludes this archive. Runnable regressions belong beside their owning application modules with valid dependencies and imports. Current tests and live runtime checks take precedence over archived results.
