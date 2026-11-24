# Additional desktop packages

Existing outputs are unchanged: Windows x64 NSIS installer, Linux x64 AppImage, macOS DMG/ZIP.

## Debian/Ubuntu x64 `.deb` (release asset)
- Built in the Linux release job by the same electron-builder pass as the AppImage (`--target AppImage,deb`), so the expensive app build runs once. Output: `Tabs-<version>-amd64.deb`.
- Verified with `scripts/verify-deb-package.ts` (control fields, architecture, payload paths) and the release asset-set check (exactly one `.deb`).
- Updates are **manual** for now: a `.deb` install has no `$APPIMAGE`, so the in-app updater stays disabled (message says to install the newer `.deb`). `latest-linux.yml` still resolves to the AppImage. No apt repository exists, so none is claimed.
- Maintainer field: `TABS_DEB_MAINTAINER`, default is the public contact address on the privacy page.

## Microsoft Store x64 package (not a release asset)
- Tool: electron-builder **26.15.3 (unchanged)** `appx` target, which writes a `.appx`. v26 has no `msix` target (MSIX is beta in v27); Partner Center accepts `.appx` for MSIX/PWA products and the Store re-signs it. Output: `Tabs-<version>-x64.appx`.
- Identity is never defaulted. Copy from Partner Center → Product identity into repository **variables**: `TABS_APPX_IDENTITY_NAME`, `TABS_APPX_PUBLISHER` (`CN=…`), `TABS_APPX_PUBLISHER_DISPLAY_NAME`. The build fails if any is missing or malformed.
- Build: run **Build Desktop Installers** manually with `platforms = win-x64-appx`. It is opt-in and never part of `release.yml` or the GitHub release. No signing secrets are used.
- The app disables its NSIS updater when `process.windowsStore` is true; the Store handles updates. NSIS self-updates are untouched.
- Manual steps: set the three variables, run the workflow, install-test the artifact on Windows (sideloading needs a test-signed copy), upload to Partner Center, submit. Final Store tile art should be reviewed (generated from the brand logo).

## ARM64 (Windows and Linux)
Not enabled. `validateBuildTarget` refuses arm64 for Windows/Linux unless built on a native arm64 host and `TABS_ALLOW_UNVERIFIED_ARCH=1` is set, so x64 binaries cannot be packed into an arm64 artifact. No arm64 runner smoke has been run; do not mark it production-ready.
