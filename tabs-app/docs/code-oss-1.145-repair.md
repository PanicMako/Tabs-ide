# Code-OSS 1.145.0 repair

This worktree carries the reviewed Tabs fork of VS Code 1.145.0, pinned to
`a717861c07586a53d83b80d742cd3f59b20a6273`. It starts from Tabs commit
`d737a8047dc936f51010f0294ea7ffac83958552`. See the
[independent review](code-oss-1.145-independent-review.md) for the original
comparison with installed Tabs 2.2.2 and the Antigravity worktree.

- **Markdown and other extension webviews.** The installed 2.2.2 payload was
  missing separately compiled extension media. The editor picker could select
  an editor, but the webview could not render. CI now builds the media after
  the production extension bundles. The build validates entrypoints and their
  relative chunks, styles and fonts; the extracted AppImage, NSIS installer
  and mounted DMG have the same payload check.
- **Project routing.** The main process assigns each extension utility process
  its registered workbench project ID. The broker rejects blank IDs and routes
  only to the matching project, including when another project reconnects.
- **Diagnostics.** The Electron console adapter recognizes named severities
  from current Electron and numeric levels from its older event signature.
- **Integrated Browser.** The expanded runtime test exposed an inherited
  startup error: Code-OSS expected a workbench load event the Tabs window
  adapter did not supply. After restoring that event, a live window check
  showed the native page covering Agents after leaving Code. The browser now
  uses its owning workbench as its native container. Workspace browser storage
  uses the same workspace ID as the editor.
- **Standalone presentation.** The full upstream suite exposed global Tabs
  styling and a replacement empty-editor shortcut in standalone workbenches.
  The Tabs stylesheet now applies only to embedded workbenches. The shared
  watermark keeps the upstream logo and Open Chat shortcut in standalone
  Code-OSS and retains the Tabs identity in Tabs-owned windows. Shared list
  row decoration is limited to Tabs-owned Code and native Agents windows.
- **Build environment.** The build uses the developer's selected Xcode or
  Command Line Tools. Turbo forwards an explicitly set `DEVELOPER_DIR`.
  The local build used the Command Line Tools without changing the system
  selection or accepting the full Xcode license.

The five-step Code-OSS build (client, NLS, production extensions, Copilot, and
extension media) passed. The media verifier checked 363 files in both the
source and production extension trees. The focused Code-OSS Electron run
passed 49 tests, and the Copilot and hygiene build tests passed 33. The Tabs
package runner passed 18 tasks, with 13,197 tests passed and 59 skipped.
The repository-wide runner repeated the same count from the workspace root.
The final unfiltered Code-OSS Electron suite, run with `TZ=UTC`, reported
69,695 passing, 539 pending, and zero failures. Its first unfiltered run
reported 116 failures, including the standalone presentation conflicts
reproduced against the untouched Antigravity candidate.
The native adapter smoke exercised the real agent coordinator and ZIP
implementation, including cancellation and skipped-file results.
The Exchange release-wizard test fixture is resolved relative to its test
module so it can run from the package or monorepo root.
The standalone chat test waits for progressive Markdown text before checking
its existing refresh count, so a settled layout alone cannot race that check.

The native Markdown dropdown was tested directly on macOS. The rich editor
saved a change to the test file, Preview rendered it, and Text Editor showed
the same saved source. The automated gate requires the Markdown and notebook
markers to be present inside a visible webview, so an editor label or a
breadcrumb alone cannot satisfy it.

The final source workbench passed the terminal, Markdown, notebook, local
browser page and two-project tests. A live native window check confirmed that
the browser page disappeared on switching to Agents and returned with the
same address and contents on switching back to Code. The broader Electron
acceptance test also passed its restart and cleanup checks.
The source app opened its separate native Agents window and confirmed that
Tabs list rows retain their 4px corners there.

The installed 2.2.2 app remains on Code-OSS 1.143.0 and fails the new media
check. The repaired 1.145.0 source and production trees both pass it. The
desktop build workflow passed `actionlint`.

The Apple Silicon DMG passed disk image integrity and strict app signature
verification. The app ran directly from the mounted image and passed the
workbench smoke with the bundled Code-OSS 1.145.0 runtime. All six probed
native modules loaded under Electron 44.1.0, ABI 149. The app archive,
runtime metadata, browser code, presentation files and sampled extension
media matched the updater ZIP byte for byte.
The native dropdown in the mounted app switched from Text Editor to Markdown
Editor, saved an edit, rendered it in Preview, and returned to Text Editor.
The live browser page disappeared in Agents and returned on switching back
to Code.

macOS spent 62 seconds scanning the first launch of the locally signed
bundle. A separate launch then encountered a login Keychain prompt. The
isolated smoke uses Electron's mock Keychain on macOS, and the mounted
app passed with that test-only setting.

The fresh profile did not sign into a provider. One secondary workbench
logged that no default chat agent had been contributed; the editor,
terminal, browser and project checks still passed. The Vite dev runner
logged Electron IPC sends to disposed frames during Ctrl+C shutdown.
The isolated desktop acceptance test verified shutdown, restart and the
absence of orphaned processes.

Local evidence is in `_analysis/repair-1.145/`, including
`vp-root-confirmed.log`, `runtime-full-unit-final.log`,
`source-workbench-final-validated/result.json`, and the native picker
save-to-disk verification in `source-native-picker.log`. Packaged evidence
is in `packaged-workbench-verified/result.json`,
`verify-mounted-artifact-isolated.log`, `verified-native-abi.json` and
`verified-artifact-checksums.txt`. The mounted native dropdown's save check
is in `packaged-native-picker.log`. The tested DMG and matching ZIP are under
`final-validated-artifacts/`.

The local application version is still 2.2.2; Code-OSS reports 1.145.0
separately. Nothing was installed, merged, pushed, or published. This macOS
work does not establish Windows, Linux, Intel macOS, signed-update, or live
provider-account acceptance.
