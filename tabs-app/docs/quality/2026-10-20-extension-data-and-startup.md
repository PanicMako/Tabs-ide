# Extension data deletion and startup reliability pass

## Reproduced data deletion failure

The real Electron 44.1.0 acceptance test reproduced the reported failure: after selecting the manager's delete-data uninstall and reinstalling the same package, `localStorage` still contained its old value. The test uses a disposable user-data directory, an actual packaged extension, and `tabs-extension://` URLs. Mocked session cleanup promises did not detect this.

`Session.clearData()` alone did not remove the custom-origin storage in that test. Uninstall now additionally awaits `Session.clearStorageData()` on each inventoried, extension-isolated partition. Existing identity checks, inventory requirements, failure propagation and retain-data behavior remain in force. No default-session or unrelated browser-profile cleanup was added.

The extended acceptance test proves retain-data reinstall preserves browser storage; delete-data reinstall clears localStorage, IndexedDB, SDK storage and named profiles; another installed extension's data survives. Unit tests cover either cleanup method rejecting while the installation remains available for retry.

## Startup changes

The startup splash previously enforced a 1,800 ms minimum hold and a 1,000 ms exit. The minimum hold is now zero and the exit takes 200 ms. The ready workspace no longer has its pointer input intercepted during the exit. This removes up to 2,600 ms of decorative waiting, not a measured 2,600 ms reduction in every application's cold start. Actual backend hydration and authentication requirements remain unchanged.

The diagnostics-only popout screen is dynamically imported instead of eagerly imported by the root route. Normal workspace startup no longer needs that screen's module. A new `workspace-interactive` startup marker distinguishes actual usable-workspace readiness from initial rendering and backend connection.

## Boundaries

These desktop/source changes require a new Tabs app build. No installed extension, user note, credential, real profile or production registry record was deleted while investigating. Existing unrelated desktop UI changes were preserved. This is a focused reliability pass, not a claim that every application path has been exhaustively audited.

## Validation

- Real Electron acceptance failed before the storage-partition fix and passed afterward, including reinstall and cross-extension isolation assertions.
- Desktop unit suite: 625 tests passed; web unit suite: 1,664 tests passed; relevant browser tests: 3 passed.
- Workspace type checks and production web/desktop builds passed.
- An unmodified AppImage rollback test failed once during a concurrent full-suite run, then passed in isolation and on the subsequent full desktop run. No AppImage updater behavior was changed; native Linux behavior was not measured on this Mac.

## Follow-up: measured five-to-six-second launch

The user's follow-up correctly distinguished decorative splash timing from real startup. An isolated Electron 44.1.0 launch of the built app reproduced 6.08, 6.26 and 6.32 seconds from process launch to `workspace-interactive`. In one run the window painted at 2.61 seconds but was not interactive until 6.26 seconds.

### Findings and changes

- Main-process initialization synchronously launched the user's interactive login shell. Measured calls took 1.02-1.23 seconds and blocked Electron initialization. The lookup now runs asynchronously while the window initializes. Backend creation still waits for the resolved environment, preserving provider PATH and SSH agent behavior.
- The backend repeated the same login-shell lookup, adding another measured 1.20 seconds. A desktop-only child environment marker now skips that repeat only after successful parent hydration. Direct CLI startup and failed parent lookups retain their fallback.
- Backend startup also eagerly loaded document readers (Mammoth, ExcelJS and PDF.js/native canvas) and Playwright browser tooling. Module timing observed roughly 60-185 ms per heavy entry, with nested loads overlapping. These now load only for document import, browser testing or PDF reporting. New tests parse actual Word and PDF fixtures; workbook and Testing feature tests pass.
- Backend module loading remains substantial. Enable Node's disk compile cache for the backend under Tabs' state directory, respecting an explicitly configured cache and Node's disable switch. This principally helps subsequent launches; it does not make a first launch free.
- Initial loopback connections previously used the remote-outage exponential retry schedule. For the first five seconds only, desktop loopback connections now retry at 100 ms; after the first successful connection or that window, normal backoff applies. Remote connections retain their existing schedule.
- Failed HTTP authentication no longer triggers a direct-token WebSocket attempt on every connection failure. The compatibility fallback is restricted to HTTP 404/405 from older backends. Authentication failures and temporarily unavailable servers retry without opening another socket.
- Faster retries exposed a separate server startup race: the Node listener starts before Effect attaches its request handlers. A request accepted during this interval had no handler to answer it, causing a ten-second client timeout even after startup completed. The existing low-level response guard now returns an empty, non-cacheable 503 with `Retry-After` while it is the only request listener. Once the application handler attaches, requests follow normal authentication and startup command gating. Actual Electron traces observed these 503 responses followed by successful token exchange, ticket issuance and socket connection.

### Follow-up measurements and limits

Measurements used disposable Tabs and Electron profile directories, the actual built desktop entry and backend, a parent monotonic clock, Electron window events, the renderer startup marker, and request path/status events. No credentials, request bodies, or token-bearing URLs were recorded. Measurement runs were separate from builds and type checks. Test processes and their backend children were terminated as a group after observation; production/user profiles were not used.

| Build/profile sample                                          | Process launch to interactive | Electron entry to interactive |
| ------------------------------------------------------------- | ----------------------------: | ----------------------------: |
| Before, three reproduced launches                             |                   6.08-6.32 s |     approximately 5.94-6.19 s |
| After, existing isolated profile / warm cache                 |                        3.39 s |                        3.24 s |
| After shell/retry fixes, fresh isolated profile / empty cache |                   5.31-5.57 s |                   5.16-5.41 s |
| After shell/retry fixes, slower native Electron entry samples |                   6.92-8.10 s |                   4.86-5.98 s |
| Final, deferred optional libraries / warm profile             |                        3.66 s |                        3.50 s |
| Final, deferred optional libraries / fresh profile            |                        6.29 s |                        4.21 s |

These are local diagnostic samples, not a release benchmark or a universal speed guarantee. Some launches spent about two seconds before the JavaScript entry ran, versus about 140 ms in the other samples. The final fresh-profile sample includes 2.08 seconds before JavaScript entry. Native-entry variation and remaining backend loading still warrant further profiling; this change does not claim that every cold start is below four seconds. Baseline and final server bundles were rebuilt at different points in the investigation, so the totals should not be used to attribute a precise saving to any single change.

Regression coverage includes asynchronous shell completion/failure, reuse of the hydrated environment, requests before/after handler registration, bounded initial retries, normal outage behavior, and 401 versus legacy-backend authentication responses. Existing startup command readiness and package trust checks are unchanged.

Follow-up final validation: 627 desktop tests, 1,670 web tests, 1,185 shared tests and 7,536 backend tests passed after the optional-library follow-up (11,018 total; backend suite also has 35 existing skipped tests). All 16 workspace type checks passed. Production web and desktop builds and the backend bundle passed; `vp check` reported zero errors and 662 existing warnings. No startup measurement was taken while these checks ran.

## Review of the existing fixes

The subsequent review found both fixes already committed on `codex/extension-data-startup-fixes` and published in PR #36. Real Electron acceptance passed again, including delete-data reinstall and cross-extension isolation. The extension settings and tool surface browser suites passed (five tests). Existing uncommitted settings and toolbar changes were preserved.

Additional browser checks reproduced five stale failures in the compact composer and provider model picker suites. Composer fixtures supplied legacy capability fields without the option descriptors consumed by the current traits UI. They now use `createModelCapabilities` with explicit descriptors. The disabled Ultrathink test now uses a mention inside the prompt body and asserts all five effort choices are disabled; a removable prefix has different behavior. The locked-provider test now checks actual menu choices rather than rejecting explanatory text that mentions other providers.

All 16 browser tests across these four suites pass together. The complete workspace `vp run test` command passes (18 successful tasks), including all 7,536 backend tests with 35 existing skips. All 16 workspace type checks pass, and `vp check` still reports zero errors and 662 existing warnings. This is scoped browser coverage, not a completed full browser-suite audit. Earlier startup measurements above were not repeated during this review.
