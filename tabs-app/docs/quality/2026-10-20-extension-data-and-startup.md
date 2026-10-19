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
