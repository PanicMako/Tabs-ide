# Antigravity and desktop-runtime implementation handoff

Date: September 14, 2026

This document records the implementation that is actually present in the working tree. It replaces an earlier generated handoff that overstated test results, described unused files as production integrations, and called OpenCode/Kilo ACP migrations complete when those providers still use their HTTP SDK runtimes.

## Implemented behavior

### Antigravity native ACP

- Tabs continues to use Google's managed `agy_acp_server` binary for native ACP sessions. The legacy interactive `agy` adapter remains a separate compatibility path.
- Native health discovery uses the ACP adapter's model negotiation instead of invoking interactive CLI commands against the ACP binary.
- Tool updates are normalized before retention. Deep payloads, long strings, large arrays, and embedded image data are bounded.
- Native question requests are projected as user-input questions rather than permission requests.
- Permission options retain their native values and security-warning metadata through the runtime, contracts, and web UI.
- Text, image, audio, and PDF attachment projection validates MIME type and real on-disk size before reading or sending data.
- Subagent launch updates are represented as progress. A successful `start_subagent` tool completion does not falsely mean the child task finished; active children complete when the enclosing turn completes.
- Interactive session databases are preserved for resume. No production stop path deletes Antigravity conversation files.

### Provider discovery and resilience

- Provider cache files use a versioned envelope with instance and driver identity, atomic writes, and legacy decoding.
- Cache hydration preserves a last-known model catalog, but does not persist a time-sensitive or fabricated `fresh` flag.
- Enabled provider probes run with concurrency 2 and a 15-second boundary. One failed source cannot prevent the others from refreshing.
- Disabled providers bypass expensive startup probes.
- Provider update bursts are debounced at the WebSocket boundary, so clients receive the latest complete catalog rather than every intermediate full catalog. The periodic refresh no longer broadcasts the same catalog twice.
- OpenCode's existing HTTP SDK runtime is retained. Its pooled local server drains output for its full lifetime, has a 30-second idle TTL, exposes liveness, and terminates its owned process group with TERM/KILL fallback.
- Kilo also remains on its existing HTTP SDK architecture. No unused ACP migration scaffold is retained.
- OpenCode resume cursors accept the existing HTTP format and reject an unimplemented ACP protocol marker.

### Desktop startup and shutdown

- `dev:desktop` runs only the desktop and web dev tasks. It does not replay the contracts production build on the critical path.
- The desktop dev supervisor owns the server bundler, desktop bundler, and Electron launcher and terminates their process groups on shutdown.
- The top-level runner performs a final worktree-scoped sweep after Turbo exits. It includes orphaned local OpenCode/Kilo servers that were created by this worktree, without targeting unrelated repositories.
- The 1.5-second resource-reclamation delay is paid only if stale processes were actually terminated.
- Code-OSS warm sessions are capped at two. Hidden/detached web contents keep background throttling enabled.
- Code-host diagnostic writes are asynchronous, queue-bounded, and detail-bounded. Server log lines are capped, and WebSocket logs report payload shape instead of full provider/model catalogs.
- Failed telemetry delivery uses exponential retry backoff from 5 seconds to a 5-minute ceiling instead of retrying and logging every second.
- The static HTML contains an immediate Solari-style first paint. React keeps startup readiness stages factual and progressive.

## Verification completed during review

- Server focused suite: 7 files, 158 tests passed.
- Desktop Code-host suite: 42 tests passed.
- Web approval/session suite: 55 tests passed.
- Contracts suite: 34 files, 467 tests passed; contracts typecheck passed.
- Server typecheck passed.
- A real `dev:desktop` shutdown test left zero matching Tabs watchers, Electron helpers, backend processes, OpenCode servers, or Kilo servers.
- A real startup trace showed two Turbo tasks and no contracts build. Vite became ready in under one second after its task began; the previous contracts build alone took approximately 15 seconds.

Repository-wide checks must still be rerun after any later edit. This file should only be updated with observed results.

## Explicit non-claims

- OpenCode and Kilo have not been migrated to ACP stdio.
- No account integration can guarantee that an external provider will never suspend an account. Tabs uses the official Antigravity ACP distribution and isolates its profile/environment to minimize avoidable risk.
- Provider warnings caused by missing credentials are not transport failures. In the captured local state, Gemini and OpenRouter are installed but unauthenticated; Claude, Droid, and Kilo are disabled by settings.
- Local version observations are point-in-time diagnostics, not permanent compatibility guarantees.
