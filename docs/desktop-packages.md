# Additional desktop packages

Existing outputs are unchanged: Windows x64 NSIS installer, Linux x64 AppImage, macOS DMG/ZIP.

## Debian/Ubuntu x64 `.deb` (release asset)
- Built in the Linux release job by the same electron-builder pass as the AppImage (`--target AppImage,deb`), so the expensive app build runs once. Output: `Tabs-<version>-amd64.deb`.
- Verified with `scripts/verify-deb-package.ts` (control fields, architecture, payload paths) and the release asset-set check (exactly one `.deb`).
- Updates are **manual** for now: a `.deb` install has no `$APPIMAGE`, so the in-app updater stays disabled (message says to install the newer `.deb`). `latest-linux.yml` still resolves to the AppImage. No apt repository exists, so none is claimed.
- Maintainer field: `TABS_DEB_MAINTAINER`, default is the public contact address on the privacy page.

## Microsoft Store x64 package (not a release asset)
- Tool: electron-builder **26.15.3 (unchanged)** `appx` target, which writes a `.appx`. v26 has no `msix` target (MSIX is beta in v27); Partner Center accepts `.appx` for MSIX/PWA products and the Store re-signs it.
- **Product Display Name**: Declared in package manifest (`Package/Properties/DisplayName` and `uap:VisualElements/@DisplayName`) as **`Tabs IDE`**, matching the reserved product name in Microsoft Partner Center. Can be customized via the `TABS_APPX_DISPLAY_NAME` variable (defaults to `Tabs IDE`).
- **Product Identity**: Never defaulted. Copy verbatim from Partner Center → Product identity into repository **variables**:
  - `TABS_APPX_IDENTITY_NAME` (`Package/Identity/Name`, e.g. `<PublisherId>.<AppName>`)
  - `TABS_APPX_PUBLISHER` (`Package/Identity/Publisher`, e.g. `CN=<GUID>`)
  - `TABS_APPX_PUBLISHER_DISPLAY_NAME` (`Package/Properties/PublisherDisplayName`)
  - `TABS_APPX_DISPLAY_NAME` (optional, defaults to `Tabs IDE`)
  The build and CI manifest verification fail loudly if any required field is missing, malformed, or has an unexpected display name or application ID.
- **Outputs produced**:
  - `Tabs-<version>-x64.appx`: The raw Windows Store package.
  - `Tabs-<version>-x64.appxupload`: The Store submission upload bundle (zip container containing the `.appx`).
  Both are collected into the `desktop-win-x64-appx` artifact.
- **Build**: run **Build Desktop Installers** manually with `platforms = win-x64-appx`. It is opt-in and never part of `release.yml` or the public GitHub release. No signing secrets are used because Microsoft Partner Center re-signs the package upon submission.
- The app disables its NSIS updater when `process.windowsStore` is true; the Store handles updates. NSIS self-updates are untouched.
- **Partner Center Submission Steps**:
  1. Ensure the repository variables (`TABS_APPX_*`) are set in GitHub repository settings.
  2. Run the **Build Desktop Installers** workflow with `platforms = win-x64-appx`.
  3. Download the `desktop-win-x64-appx` artifact zip containing `Tabs-<version>-x64.appx` and `Tabs-<version>-x64.appxupload`.
  4. In Microsoft Partner Center, navigate to your submission → **Packages**.
  5. Drag and drop either `Tabs-<version>-x64.appxupload` or `Tabs-<version>-x64.appx` into the package uploader.
  6. Partner Center validation verifies that `Package/Properties/DisplayName` matches the reserved name `Tabs IDE` and that the Publisher matches your account.

## ARM64 (Windows and Linux)
Not enabled for production release. `validateBuildTarget` refuses arm64 for Windows/Linux unless built on a native arm64 host and `TABS_ALLOW_UNVERIFIED_ARCH=1` is set, so x64 binaries cannot be packed into an arm64 artifact.

**Why Windows ARM64 is not currently produced**:
1. **Runner Architecture**: GitHub-hosted Windows runners (`windows-2022`) are x64 Intel/AMD VMs. Native compilation and smoke testing of the embedded Code-OSS editor, native C++ addons (`@vscode/sqlite3`, `@parcel/watcher`, `@vscode/spdlog`, `native-keymap`), and Electron binaries require a native ARM64 Windows host.
2. **Untested Cross-Compilation**: Building an ARM64 package on an x64 host without executing native launch smoke tests risks packaging mismatched x64 binaries or crashing on actual Windows on Arm devices.
3. **Microsoft Store Viability**: Windows on Arm supports running Windows x64 applications through built-in x64 emulation (Prism emulation engine on Windows 11 24H2+ / ARM64). Microsoft Partner Center accepts x64 packages for publication, allowing the application to reach both x64 and Windows on Arm users safely while genuine native ARM64 compilation and verification remain in development.
