# Additional desktop packages

Existing outputs are unchanged: Windows x64 NSIS installer, Linux x64 AppImage, macOS DMG/ZIP.

## Debian/Ubuntu x64 `.deb` (release asset)
- Built in the Linux release job by the same electron-builder pass as the AppImage (`--target AppImage,deb`), so the expensive app build runs once. Output: `Tabs-<version>-amd64.deb`.
- Verified with `scripts/verify-deb-package.ts` (control fields, architecture, payload paths) and the release asset-set check (exactly one `.deb`).
- Updates are **manual** for now: a `.deb` install has no `$APPIMAGE`, so the in-app updater stays disabled (message says to install the newer `.deb`). `latest-linux.yml` still resolves to the AppImage. No apt repository exists, so none is claimed.
- Maintainer field: `TABS_DEB_MAINTAINER`, default is the public contact address on the privacy page.

## Microsoft Store x64 package (not a release asset)
- **Live listing**: product **Tabs IDE**, Store ID `9P8P9XTGZQM9` — <https://apps.microsoft.com/detail/9P8P9XTGZQM9> (deep link `ms-windows-store://pdp/?productid=9P8P9XTGZQM9`). The downloads page links it from the Windows ticket (`microsoftStoreUrl` in `apps/marketing/src/data/downloads.ts`).
- Tool: electron-builder **26.15.3 (unchanged)** `appx` target, which writes a `.appx`. v26 has no `msix` target (MSIX is beta in v27); `.appx` and `.msix` share one container format and the Store re-signs it.
- **Product Display Name**: `Package/Properties/DisplayName` and `uap:VisualElements/@DisplayName` are **`Tabs IDE`**, the reserved Partner Center name. Override with the `TABS_APPX_DISPLAY_NAME` variable.
- **Product Identity** (repository **variables**, copied verbatim from Partner Center → Product identity, never defaulted): `TABS_APPX_IDENTITY_NAME`, `TABS_APPX_PUBLISHER`, `TABS_APPX_PUBLISHER_DISPLAY_NAME`. The build and manifest verification fail loudly if any is missing or malformed.
- The app disables its NSIS updater when `process.windowsStore` is true; the Store handles updates. NSIS self-updates are untouched.

### Automatic submission on every release
`release.yml` does it end to end:
1. The `build` matrix has a **Windows x64 Store AppX** leg (`target: appx`). It verifies the manifest and payload and uploads `Tabs-<version>-x64.appx` as the `store-win-x64-appx` artifact. It is `continue-on-error`, so a Store packaging failure never blocks the GitHub release, and its artifact name is outside the `desktop-*` pattern, so it is never attached to the release.
2. After **Publish GitHub Release** succeeds, the `microsoft_store` job installs the Microsoft Store Developer CLI (`microsoft/microsoft-store-apppublisher`), signs in to Partner Center and runs `msstore publish <package>.msix -id 9P8P9XTGZQM9`. That creates a new submission from the last published one (listing, pricing, availability kept; any pending draft is discarded), swaps the package and commits it for certification.
3. Skipped with a notice for prerelease versions (`x.y.z-…`): the Store version is `x.y.z.0`, so a prerelease would collide with its final release. Skipped with a warning when the credentials below are missing. Not run for the v2.0.0 replacement path.
4. With `artifact_run_id`, the package comes from that Build Desktop Installers run's `desktop-win-x64-appx` artifact, so include `win-x64-appx` in its `platforms`.

Override the product with the `TABS_MSSTORE_PRODUCT_ID` variable (defaults to `9P8P9XTGZQM9`).

### One-time Partner Center API setup
1. Partner Center → **Account settings → User management → Microsoft Entra applications** → **Create Microsoft Entra application** (or add an existing one), role **Manager**.
2. Note the **Tenant ID** and **Client ID**, then **Add new key** and copy the key value (shown once; it expires, so rotate it before then).
3. Partner Center → **Account settings → Legal info → Developer** → copy the **Seller ID**.
4. Add the repository **secrets**:
   ```bash
   gh secret set MSSTORE_TENANT_ID -R PanicMako/Tabs-ide
   gh secret set MSSTORE_CLIENT_ID -R PanicMako/Tabs-ide
   gh secret set MSSTORE_CLIENT_SECRET -R PanicMako/Tabs-ide
   gh secret set MSSTORE_SELLER_ID -R PanicMako/Tabs-ide
   ```

### Caveats
- Microsoft documents CLI updates as supported for free products only (Tabs is free).
- If a previous submission is still **in certification**, the CLI's behaviour is undocumented; if the job fails for that reason, wait for certification to finish (or cancel it in Partner Center) and re-run the `microsoft_store` job.
- Certification is on Microsoft's side; the job finishing means the submission was committed, not that it is live.

### Minimum Windows version
The package declares `TargetDeviceFamily MinVersion="10.0.17763.0"` (Windows 10 1809) and `MaxVersionTested="10.0.22621.0"` (`createAppxBuildConfig` in `scripts/lib/windows-appx.ts`). The CLI uploads the package under a `.msix` name, and Partner Center rejects any MSIX whose MinVersion is `10.0.17134.0` or lower, which is what failed the first v2.11.0 submission (electron-builder's default is `10.0.14316.0`). `verify-appx-package.ts` fails the build if the manifest drifts below that.

### Resubmitting a version
If a release's automatic submission fails, rebuild the package and submit it without touching the GitHub release:
1. Run **Build Desktop Installers** on `main` with `platforms = win-x64-appx` and `version = <x.y.z>`.
2. Run **Submit to Microsoft Store** (`.github/workflows/microsoft-store.yml`) with that `version` and the build's run ID as `build_run_id`. It checks the package's version and MinVersion before uploading.

### Manual upload (fallback)
Download the `desktop-win-x64-appx` artifact from step 1 and drag `Tabs-<version>-x64.appx` into the submission's **Packages** page in Partner Center.

## ARM64 (Windows and Linux)
Not enabled for production release. `validateBuildTarget` refuses arm64 for Windows/Linux unless built on a native arm64 host and `TABS_ALLOW_UNVERIFIED_ARCH=1` is set, so x64 binaries cannot be packed into an arm64 artifact.

**Why Windows ARM64 is not currently produced**:
1. **Runner Architecture**: GitHub-hosted Windows runners (`windows-2022`) are x64 Intel/AMD VMs. Native compilation and smoke testing of the embedded Code-OSS editor, native C++ addons (`@vscode/sqlite3`, `@parcel/watcher`, `@vscode/spdlog`, `native-keymap`), and Electron binaries require a native ARM64 Windows host.
2. **Untested Cross-Compilation**: Building an ARM64 package on an x64 host without executing native launch smoke tests risks packaging mismatched x64 binaries or crashing on actual Windows on Arm devices.
3. **Microsoft Store Viability**: Windows on Arm supports running Windows x64 applications through built-in x64 emulation (Prism emulation engine on Windows 11 24H2+ / ARM64). Microsoft Partner Center accepts x64 packages for publication, allowing the application to reach both x64 and Windows on Arm users safely while genuine native ARM64 compilation and verification remain in development.
