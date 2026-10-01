# Code-OSS parity contract

Tabs embeds Code-OSS as its IDE workbench. The integration follows one rule:

> If behavior does not conflict with Tabs' application shell, preserve the
> upstream Code-OSS implementation and user preference.

## Intentional differences

Only the following behavior is intentionally owned by Tabs:

- application window and project-tab lifecycle, including New Window and Quit;
- the outer title bar, activity rail, application menu, and Tabs branding;
- project selection and restoration across Tabs project tabs;
- application updates, release notes, telemetry policy, and workspace trust;
- visibility of the outer Tabs/Copilot provider surfaces; and
- safe routing between the outer shell and the active embedded workbench.

These differences must stay explicit and covered by integration tests.

## Behavior that remains native

Code-OSS continues to own editor tabs, Explorer, Search, Source Control, Run and
Debug, extensions, terminal, command palette, context menus, clipboard and file
commands, editor preferences, notifications, authentication prompts,
extension-contributed views, keybindings, and accessibility behavior.

The integration must not duplicate those features or rewrite their ordinary
settings. A deviation in these areas is a compatibility defect, not product
customization.

## Updating the Code-OSS fork

`tabs-code-main/` is the tracked embedded Code-OSS runtime in the monorepo; `vscode-main/` is an untracked/ignored local upstream comparison snapshot. Neither directory is an independent Git repository. Do not run `git merge` or merge Microsoft's commit history directly into Tabs.

Updates are performed in an isolated clean worktree on a dedicated branch (`chore/sync-vscode-<version>`):

1. **Pin exact upstream revision:** Verify the tag, full commit SHA, and release notes from `https://github.com/microsoft/vscode` (e.g. `1.140.0` at `07f806f999227108933c2e30515b26eecc1fda74`).
2. **Export reviewed fork delta:** Re-derive all Tabs additions, modifications, file modes, and binary assets against the baseline upstream release (`1.138.0`), excluding generated outputs, build caches, and dependencies.
3. **Refresh comparison snapshot:** Extract the pristine upstream source into `vscode-main/` for clean diffing.
4. **Refresh patched runtime:** Unpack the pristine upstream source into `tabs-code-main/`, purge files removed upstream (`git diff --no-renames --diff-filter=D`), and semantically replay the reviewed Tabs fork patches.
5. **Toolchain boundary:** Use Node/npm (Node v24) strictly inside `tabs-code-main/` and Bun/Vite+ strictly inside `tabs-main/`. Never run `npm` or `yarn` inside `tabs-main/`.
6. **Compile and validate Code-OSS:**
   ```bash
   cd tabs-code-main
   npm ci --ignore-scripts
   VSCODE_FORCE_INSTALL=true npm_command=install node --experimental-strip-types build/npm/postinstall.ts
   npm run compile-client
   node build/next/index.ts bundle --nls
   npm run typecheck-client
   npm run hygiene
   ```
7. **Production extension packaging:**
   ```bash
   npm run compile-extensions-build
   npm run gulp compile-copilot-extension-build
   ```

Resolve conflicts only in the documented Tabs integration surface. Treat new conflicts elsewhere as a signal that the patch boundary has expanded and needs review.

For production packaging, build the production extension bundles before the
Tabs artifact:

```bash
cd ../tabs-code-main
npm run compile-extensions-build
npm run gulp compile-copilot-extension-build

cd ../tabs-main
bun install
bun typecheck
bun test
bun run test:desktop-smoke
bun run dist:desktop:dmg:arm64
```

Use the platform-specific artifact command for Intel macOS, Windows, or Linux.
An installed Tabs application never updates merely because source was pulled;
it must be rebuilt and replaced or distributed through a new release.

## Required regression coverage

Before merging an upstream update, verify:

- application launch and first Code tab time;
- project switching, restoration, and session eviction;
- Explorer file operations, Copy Path, save, and clipboard operations;
- command palette, context menus, keyboard navigation, and native editor tabs;
- Git, terminal, search, debug, and extension installation/activation;
- notification dismissal, global Do Not Disturb, and per-source filters across projects;
- GitHub, Copilot, Claude, and Codex authentication and callback routing;
- stable Chat, Claude Code, and Codex view registration; and
- Tabs-owned New Window, Quit, outer navigation, and update behavior.

## Runtime identification and Windows window controls

Settings > About > Code-OSS version reports the version from the selected embedded runtime's package.json, separately from the Tabs application version. A missing runtime is reported as Unavailable; missing or unreadable metadata is reported as Unknown. This row is available in builds containing the independent Codex review changes; previously generated installers do not acquire it automatically.

Windows caption controls use the renderer background, update symbol contrast when the desktop theme changes, and reserve the native control-area width via Electron Window Controls Overlay geometry and visibility events; hidden fullscreen controls release the reserved space. The Windows project tab header is 52 logical pixels high to match its native controls. macOS traffic-light configuration is preserved. Verify light/dark/system/custom themes, windowed/maximized/fullscreen states, and 100/125/150/200 percent display scaling on Windows; macOS unit tests and web builds do not prove native Windows rendering.
