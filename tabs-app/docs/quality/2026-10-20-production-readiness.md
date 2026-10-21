# Production readiness and startup follow-up

## Scope

This pass prioritizes time to a usable workspace and fixes reproduced workflow regressions. It preserves the original airport split-flap loading screen. It does not certify every application path or publish a release. The source changes are isolated from the user's ongoing settings and extension UI work.

## Startup findings

The subsequent [cold-start follow-up](./2026-10-20-cold-start.md) records newer startup/build changes, cache persistence behavior and matched measurements.

A disposable-profile Electron CPU trace showed backend module loading taking most of backend startup, while runtime initialization after imports took roughly 100 ms. Optional TypeScript parsing and the Cursor SDK were imported before any feature needed them. Both now load on their first operation and cache the loaded module. Type-only imports remain available to the compiler. Existing parser, credential, authentication, catalog and agent lifecycle tests cover their behavior; fresh-process tests prove the optional modules stay unloaded until requested.

The trace also showed approximately 264 ms in a synchronous compile-cache flush after backend readiness. This is retained: Windows forcibly terminates the backend on shutdown, so removing the flush could discard the cache and slow future launches. Deferring it safely needs a separate lifecycle change and measurement.

Earlier changes in this branch overlap backend loading with asynchronous login-shell lookup and show the existing airport animation before importing the workspace. The native window waits for its first splash paint. A launcher cache identity fix prevents development and normal app bundles from sharing incompatible Electron metadata. No artificial animation hold was added.

Early HTTP requests now wait in a bounded queue for the actual server handler instead of receiving a response without the normal authentication/CORS headers. Timeout, disconnect and queue-overflow behavior are covered by real HTTP tests. A fresh development launch reproduced eight console errors before this fix and zero JavaScript exceptions or console errors afterward. Electron's development CSP warning and a native sandbox diagnostic were recorded separately; they were not hidden.

## Local startup measurements

The same harness and machine were used immediately before and after the optional-module changes, with builds and tests stopped during measurement. Each fresh sample uses separate disposable application, Electron and compile-cache directories. The repeat-launch run primes one disposable profile, then launches it three more times. Timing runs from process spawn to the renderer's actual `workspace-interactive` marker; this is not animation duration. Each process group is terminated and its disposable data removed afterward.

| Profile                                      | Before                | After                 | Median before / after |
| -------------------------------------------- | --------------------- | --------------------- | --------------------- |
| Fresh profiles, three samples                | 4.285, 3.044, 2.976 s | 4.074, 2.920, 2.883 s | 3.044 / 2.920 s       |
| Repeat launches, three samples after priming | 2.444, 2.418, 2.400 s | 2.395, 2.204, 2.237 s | 2.418 / 2.237 s       |

These small local samples indicate a modest improvement, not a universal performance guarantee. First native-entry time varies substantially. Signed installer, slower hardware, existing large workspaces, Windows and Linux measurements remain release gates. No precise saving is attributed to either optional module alone.

## Workflow fixes included in this branch

- Companion chooser B/F and other advertised letter shortcuts receive focus and open the expected panels without intercepting text input.
- Queued messages remain available for retry when local migration or upload fails; the UI reports success only after a successful send.
- Existing conversations do not incorrectly enter the first-message flow while their messages are still loading. Empty projections clear stale conversation contents.
- Draft and legacy thread routes preserve environment identity and avoid selecting an ambiguous thread from another server.
- Keybinding reload errors and recovery notifications remain visible without mutating cached settings.
- Configured project script actions are restored in the chat header; configured New Thread shortcuts display correctly.
- Streamed timeline updates do not undo manual scrolling. Fresh companion panels stay closed until requested.
- Browser fixtures use current RPC envelopes and capabilities. Browser files run serially because they share origin storage and the service worker.

Long-text companion geometry tests pass at 280 px and 360 px. No speculative redesign or extra feature was added.

## Validation

Final checks ran on frozen source in an isolated checkout, excluding unrelated user changes:

- `vp run test --concurrency=2`: all 18 tasks passed, including 7,544 backend, 1,681 web, 632 desktop and 1,185 shared tests. Existing skips remain. The initial default-concurrency run hit a five-second timeout in an existing ACP child-process test; that suite and the full run passed with reduced package concurrency.
- `vp run test:browser`: all 51 Chromium browser files and 167 tests passed. Standalone router fixtures emit router-context warnings; no test failed.
- `vp run typecheck --concurrency=2`: all 16 tasks passed.
- `vp check`: zero errors and 662 existing warnings. The VS Code pre-commit hook also ran; it reported no applicable staged files for that checkout. Tabs app formatting/linting is covered by `vp check`.
- `vp run build:desktop`: all four desktop/server/web build tasks passed.
- The 45 focused parser, compiler-load, Cursor authentication/catalog/driver and agent lifecycle tests passed.
- Final fresh development launch against the new development server: zero JavaScript exceptions and zero console errors through readiness and three seconds afterward. The original airport tiles were visible while workspace imports were deliberately held. This controlled hold is a visual-order check, not a startup timing benchmark. Development CSP/native sandbox diagnostics remain visible.

Earlier runs interrupted by source copying or a Chromium process exit are not counted as passing final runs. The user's working tree contains separate ongoing UI edits; these validation results describe the isolated release source, not a production certification of those uncommitted edits.

## Exchange metadata freshness incident (21 October IST)

The live official registry still served timestamp version 1 with expiry
`2026-10-20T08:52:25.938Z` (20 October, 14:22 IST), approximately 12 hours before
inspection. HTTP response time agreed with the machine clock and metadata was
served with `Cache-Control: no-store`. The snapshot, targets and root were still
within their expiry periods. This is expired server metadata, not a startup or
Relay package regression.

The release wizard has issued one-day timestamps since its 19 October addition.
Extension activation has required the signed status check since 15 October.
The current manual workflow requires the operator to unlock the existing signing
backup at `/admin/releases`, load a fresh plan and sign/publish it. Normal users
should not need signing keys. Reliable production operation requires a metadata
renewal process and freshness monitoring; changing the error message alone does
not restore the registry or solve that operational gap.

The desktop now explains expiry and links to the registry's release workflow,
while preserving verification failure and the original diagnostic cause. Tests
cover fresh and cached expired timestamps, exclusion from offline fallback, and
successful retry after a higher-version signed renewal. All 635 desktop tests
passed. Production metadata has not been renewed by this code change.

The subsequent availability change separates saved installed approvals from
registry freshness: activation no longer waits for a network check, while known
revocations remain blocked and successful background checks close revoked tools.
Public reads also try anonymously before using a saved private-registry token.
Automatic renewal of previously published approvals is implemented behind one-time
non-root signer provisioning, including renewal before serving a timestamp and an
optional scheduled job. New versions still require manual approval and publication.
See [the operator setup](../exchange-automatic-renewal.md). Production signer
provisioning and deployment remain pending; local tests do not enable them.

Availability validation: the full workspace run passed all 18 tasks, including
7,561 server, 644 desktop and 1,681 web tests. After the final hosting-wrapper and
health-warning changes, the complete Exchange suite passed 540 tests with 24
existing skips. All 16 workspace type checks and the final Exchange type check
passed; `vp check` reported zero errors and 661 existing warnings. The desktop
and Exchange portal builds passed, as did actionlint, shell syntax validation,
and a real Bun/TTY exporter run using a synthetic encrypted backup with hidden
password input. Docker image execution was not verified because the configured
Docker daemon was unavailable. The hosting secret wrapper was tested as an actual
shell process with a read-only synthetic mount.

## Release limits

The actual Electron extension acceptance test passed, including retain-data reinstall, delete-data removal of localStorage/IndexedDB/SDK storage/named profiles, and cross-extension isolation. Native browser workflow acceptance passed on retry, including profile isolation, viewports, screenshots and a real recorded click. The first recorder run failed to observe that click; no product change was made for that transient result. Release packaging smoke fixtures passed.

Before a fresh release, run signed macOS/Windows/Linux installer and upgrade acceptance against the chosen version and validate existing large-workspace startup. Full browser coverage and local tests cannot establish that every workflow is perfect. No production deployment or GitHub release was performed in this pass.
