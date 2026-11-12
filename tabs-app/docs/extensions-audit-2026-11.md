# Extensions production audit (November 2026)

Scope: the `.tabsext` extension platform end to end: the desktop host
(`apps/desktop/src/extension*.ts`), the renderer surfaces
(`ExtensionToolSurface`, Settings → Extensions, Quick Actions, Command Palette,
Themes), the manifest contract and validator (`packages/contracts`,
`packages/shared/src/extensions.ts`), the public API (`packages/extension-api`),
the packager and CLI, the examples, and the docs.

Verified at commit `6a14c2ef8` (after release `v2.4.0`, `8091574f6`): real
Electron extension smoke test PASS (19 assertions), desktop extension host
119 tests, manifest validator 21, extension API 8, packager 24, CLI 19, web
extension surfaces 13 unit + 8 browser, Exchange 544.

## Issues found and fixed

| # | Issue | Impact | Fix | Evidence | Status |
|---|---|---|---|---|---|
| 1 | Extension view bounds ignored the window zoom factor | At any Tabs zoom other than 100% the view was offset and mis-sized | `ExtensionViewManager.setBounds` scales by the window zoom and zooms extension content with Tabs | `extensionViewManager.test.ts` "places the native view in window pixels when Tabs is zoomed" | Fixed in 2.4.0 |
| 2 | Packaged files served with deprecated `registerFileProtocol` in a non-default partition | Known Electron failure mode: navigation can stay pending, so tools hang while loading | Migrated to `protocol.handle` reading exact bytes (`protocolFile.ts`, shared with the code host) | Unit test "serves packaged files with the extension policy…"; smoke test "Real WebContentsView UI load … via tabs-extension://" | Fixed in 2.4.0 |
| 3 | Content-Security-Policy applied only through a `webRequest` hook | Policy depended on one hook firing for every response | CSP, `nosniff`, COOP and `no-store` set on every packaged response; unknown types served as octet-stream; traversal and missing files are 404 | Same unit test asserts headers and 404s | Fixed in 2.4.0 |
| 4 | Extension views hidden under menus/dialogs with no snapshot | Tool area went blank whenever a menu or dialog opened | `captureExtensionView` IPC (active activation only, main renderer only) feeds the shared snapshot backdrop | `extensionViewManager.test.ts` capture assertions; `ExtensionToolSurface.browser.tsx` | Fixed in 2.4.0 |
| 5 | Installed-extensions registry written without flush, with a fixed temp name and default mode | A truncated file (crash or power loss) loaded as empty and the next save erased every extension and grant | Unique `0600` temp file, `fsync`, last-good `.bak`; unreadable file restored from backup and quarantined | `extensionViewManager.test.ts` "recovers installed extensions from the last good registry…" | Fixed in 2.4.0 |
| 6 | Install review did not list launcher, palette or theme contributions | Users approved packages without seeing everything they add | Install review and installed card list quick actions, palette commands and themes | `ExtensionsSettings` tests | Fixed in 2.4.0 |
| 7 | Extensions could only add toolbar tools | Not a platform: no way to add to the launcher, palette or look of Tabs | API 1.8 `contributes.quickActions`; API 1.9 `contributes.themes` (hex-only, run through the theme engine) and `contributes.paletteCommands`; themes-only packages allowed | `packages/shared/src/extensions.test.ts`, `extensionQuickActions.test.ts`, `extensionThemes.test.ts`, `extensionPaletteCommands.test.tsx` | Fixed in 2.4.0 |
| 8 | Browser "Clear cookies and cache" used a native OS confirm | Breaks the no-native-UI rule | In-app confirm dialog | Code review; typecheck | Fixed in 2.4.0 |
| 9 | No sample used the new contribution points, and samples were never validated | Authors had nothing to copy, and samples could silently stop installing | `examples/workbench-extras-extension`; `examples.test.ts` validates every sample against the shipping desktop version | `packages/extension-package` 24 tests (all 7 samples) | Fixed on main after 2.4.0 |

## Checked and left as is

| Area | What was checked | Finding |
|---|---|---|
| Logic runtime (`extensionLogicWorker.js`) | `null`/`undefined` results, promise-like returns, infinite loops, per-call latency | Correct: `null` round-trips, `undefined` is rejected, loops hit the deadline. About 37 ms per call because each runs in a fresh QuickJS isolate; kept for isolation. |
| Network broker (`extensionNetwork.ts`) | Host allowlist, IP literals, DNS pinning, private ranges, redirects, size and time limits | Only declared HTTPS hosts, unicast addresses only, one pinned connection, no redirects, 1 MiB and 15 s limits. |
| AI tool broker (`extensionAiBrokerServer.ts`) | Binding, authentication, body limits | Loopback only, per-launch random token compared in constant time, 128 KiB body cap. |
| Package extractor (`packages/extension-package`) | Archive limits, paths, links | Size, file-count and depth limits; symlinks and non-normalized or colliding paths rejected; bounded reads. |
| Storage and credentials | Write safety, quotas | Unique temp files with `0600` and rename; per-value, document and namespace quotas. |
| View sandbox | Preload, permissions, navigation, cross-extension access | Sandboxed, context-isolated, deny-all permissions, popups and navigation blocked, foreign packages unreachable (smoke test). |

## Known limits, by design

- The logic runtime is per call with no persistent background process (see
  [extensions.md](extensions.md#not-yet-supported)).
- Palette commands open a tool; running a logic command from the palette and
  showing its result is on the [roadmap](extensions-platform-roadmap.md).
- Workspace writes, Git mutations and terminal runs are not exposed to
  extensions; each needs its own capability and review before it ships.
