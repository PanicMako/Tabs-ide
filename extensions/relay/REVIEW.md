# Relay review build

Open http://127.0.0.1:4185/ while the local preview server is running. This serves the rebuilt extension UI, including its restrictive content security policy, rather than a separate mockup.

Approved review changes:

- Three-step, skippable welcome: notes or optional folders, a starting view, and a short explanation of local storage and backups. Replay with **A quick tour** at the bottom of the notebook.
- Custom keyboard-operable menus for projects, note layouts, board stages, folders, and template settings.
- Custom color palette with hex entry and a custom calendar for date prompts.
- Styled checkboxes. Existing folders, notes, templates, logos, Trash, attachments, and backups remain available.

The welcome applies choices only when completed. Skipping does not change preferences. Neither path creates, removes, or migrates notes. The preview starts empty on a fresh browser origin; existing notebook storage is preserved.

Relay 0.1.0 (`panicmako.relay`) was submitted through the live publisher portal on 18 October 2026 at 17:17 IST. Its immutable digest is `fe2064d9b5bc8bd6d615fd6d66aa40ccf4c23cd712b3d6204644e7b3ec792db2`. The deployed scanner completed with `passed: true`, zero issues, and no declared dependencies. Current status: **Awaiting manual review**. It is not yet signed or installable from the marketplace.

Submission: https://exchange.buildwithtabs.com/account/submissions/fe2064d9b5bc8bd6d615fd6d66aa40ccf4c23cd712b3d6204644e7b3ec792db2

The approved archive was moved to `/Users/rushil.dev/Desktop/panicmako-relay-0.1.0.tabsext`. Do not replace or rebuild the submitted version under the same identity; future changes require a new version. The older `releases/relay-0.1.0.tabsext` is superseded. The owner's account has pilot submission access; public uploads remain closed. Signed publication and independently distributed desktop trust are still pending.

Build and focused checks:

```
bun extensions/relay/scripts/build.mjs
bun test extensions/relay/scripts/controls.test.mjs
bun tabs-app/packages/extension-package/src/cli.ts validate extensions/relay/package --tabs-version 2.0.0
```

## Simplified workspace and theme review

- Project switching is searchable; new project and folder forms begin with a name.
- Optional colors, logos, descriptions and folder preferences are behind disclosures.
- Settings uses General, Templates, Board, and Backup & data categories.
- Installed Relay always follows Tabs light/dark appearance, including live changes.
  It consumes `prefers-color-scheme`, which Tabs desktop sets through Electron
  `nativeTheme.themeSource` when its theme changes. An older Relay appearance
  preference cannot override the host. There is no new permission or SDK method.
- Standalone browser previews have a preview theme setting, since they are outside
  Tabs' extension host. Host behavior has a simulated light/dark change regression
  test; changing themes in an installed Tabs build still needs a desktop smoke check.
- The SDK expansion and marketplace upload remain deferred until design approval.

## Small branding and search refinements

- Settings uses a gear icon everywhere, including General and board controls.
- Relay has a matching vector monogram in the sidebar, search header and tool icon;
  the listing icon is rendered from the same geometry.
- The top search control opens a full-screen local search, also available with
  Cmd/Ctrl K or /. Results include note text, optional context, paths and filenames.
- All notes, This project and Archive scopes are separate. Arrow keys navigate
  results; Enter opens a note; Escape returns to the notebook.

## Settings, folders and deliberate board edits

- Search is centered in the header; Settings and the preview theme control sit together.
- Every Settings category uses the revised panel, card and typography treatment.
- Folder cards use small theme-aware vector illustrations.
- Board names are read-only. A gear opens a form with explicit Save and Cancel.
- Column deletion requires a custom confirmation and explains the destination of
  its notes. Removing a template or template field also asks for confirmation.
- The column form never mutates saved state while typing; tested cancellation,
  explicit save, confirmed deletion, and preservation of notes when a column goes.

## Rich templates and nested folders

- Thirteen field types: short text, paragraph, checkbox, checklist, multiple choice,
  dropdown, rating, number, date, time, email, link and code snippet.
- The preview uses real controls with temporary answers; trying it never creates a note.
- Drag the dotted handles in the builder or preview to reorder fields. The same
  handles support touch and Alt+Up/Down. Existing arrow buttons remain available.
- Field IDs stay stable while reordering, so saved answers stay attached correctly.
- Checklist answers store multiple selections and restore when reopening notes;
  the backup validator accepts all new types.
- Open any folder and choose New subfolder; the parent is preselected. Multiple
  siblings and further nested folders use the existing folder hierarchy.
- Browser verification covered direct dragging in both views, independent checklist
  selections, rating selection, a saved note after reload, and two sibling subfolders.

### Template management
- Settings → Templates opens a library with labeled Edit, Duplicate and Delete actions for every template, including the starter layouts.
- New template asks for a name before creating anything. Cancel leaves the library unchanged; duplicate asks for the copy's name.
- The editor has an All templates return action, a visible Delete template action, and a default-template control.
- Delete confirmation names the template and its replacement. Notes and saved answers are preserved; deleting the final template creates a blank writing layout.
- Verified the library, editing, naming validation, creation and canceled deletion in the browser. Automated checks cover copy field identities, preservation of answers, default fallback and failed-save rollback.
