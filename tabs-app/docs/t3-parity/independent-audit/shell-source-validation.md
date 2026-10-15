Batch192 — shell current-source review

HEAD unchanged. Complete840line current shell.ts read in ranges1–260,261–560,561–840. Initial combined diff output truncated; full modified diff and776line tests are not yet fully reviewed. No complete audit credit. Reused batch180 shared-suite pass.

Source migrates executable availability and environment resolution to Effect services, adds 30-second bounded512-entry positive/negative resolution cache, per-resolver spawn cache identity, optional PATH directory listing cache and Windows argument escaping. Spawn misses are deliberately uncached, explicit paths bypass cache, POSIX spawn passes through arguments. Windows baseline preserves shell PATH order and appends known CLI dirs. Production caller inventory includes processRunner, externalLauncher, installation probes and multiple provider runtimes.

Potential discrepancy: comment claims monotonicTimeNanos, but both resolution cache paths use Clock.currentTimeNanos. Installed Effect Clock implementation needs inspection; root node_modules/effect/src/Clock.ts was absent. No confirmed backward-clock failure yet. Test search found expiry cases but no backward/monotonic assertions; full assertions pending.

No production edits. Full audit incomplete.

Batch193 continuation

Completed776line test source and recovered all implementation diff ranges. Tests cover native temp-file discovery with simulated Windows platform, duplicate/case-sensitive PATH probes,30-second negative expiry, explicit paths, directory relisting, injected spawn resolvers and Windows profile fallback. Windows quoting assertions inspect strings, not cmd.exe execution. Test removed hunks still require review.

Clock suspicion resolved: installed packages/shared/node_modules/effect/src/internal/effect.ts5775–5838 implements currentTimeNanos via process.hrtime.bigint or performance.now plus fixed origin. Native Node wall-clock rollback does not affect it; comment API name is stale but no cache rollback defect established. Custom injected clocks can behave differently. processRunner304–325 yields resolveSpawnCommand and forwards args/shell to Effect spawner, confirming source wiring. Existing shared suite reused. No production edits.

Batch194: all test removed lines and hunk headers inspected. Three deleted PATH-marker helper assertions covered valid/noisy/missing markers; helper itself removed. Additions already fully read193. Source/test diff review closed; native Windows execution still unverified.
