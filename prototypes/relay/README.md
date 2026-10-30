# Relay — five visual treatments of Studio

Start the local preview from this directory:

```sh
python3 -m http.server 4178 --bind 127.0.0.1
```

Open http://127.0.0.1:4178/?v=1. No installation, build, or extension setup is needed. The fixed 1–5 bar switches between **Tabs Blue, Graphite, Apricot, Lilac, and After Hours**.

All five share the same browser workspace. Try **Make it yours** to edit page templates, optional questions, board columns, colors, density, previews, and default note layout. Use a folder's options to choose its parent, description, view, and starting page. Projects can be added from the project picker and renamed from Make it yours → Your feel.

Notes support free writing, lightweight Markdown display, custom labels, saved drafts, pinned notes, checkpoints, branch/file/link references, and local file attachments. Templates support short text, long text, checkbox, dropdown, date, and link fields. Every treatment uses the first Studio layout and the same writing editor. Notes can be put aside and restored; board cards can be dragged or moved using their menu.

Keyboard: `/` searches the current view, `Cmd/Ctrl+K` searches all projects, `N` starts a note, and `1`–`5` change prototypes when focus is outside a text field. Native dialogs close with Escape and keep unfinished note drafts.

Text and settings use localStorage. Attachments use IndexedDB (5 MB each, up to 12 per note). Full JSON backups include available attachments; Markdown exports keep writing and references. Both are available under Make it yours → Your notes. Restoring asks you to review the replacement. This browser-only prototype has no live editor connection, Git detection, account, cloud synchronization, or automated summaries.

Your original reference HTML remains untouched at its supplied path. A review copy is in `reference/`. The rejected Studio/Folio/Pinboard/Almanac/Pocket directions are retained for recovery under `archive-studio-directions/` and removed from the active preview. The earlier five directions are under `previous-five/`; the first initial concept is under `original/`. Previous browser data is retained under its original storage keys. New user-created notes from the earlier exploration are carried into a fresh Studio workspace; the old sample cards are replaced with the new examples.

`RESEARCH.md` describes evidence, scope, design decisions, and limitations. No automated or extension tests were run, as originally requested; the five layouts were visually reviewed in the local preview.

Folder creation now requires only a name. Use the dedicated New folder card to create your own folder; use Edit folder on an existing card to rename it or change its icon, color, parent, view, or starting layout. Optional settings are tucked under More ways to make it yours. The revised font pairings and hierarchy are documented in `APPEARANCES.md`.

### Current prototype

Only the first Studio design is active at http://127.0.0.1:4178/. Older `?v=` links also open it. Use **Organize** to choose notes only or notes with folders per project, reorder folders, move them, or remove a folder while retaining its contents. The latest folder deletion can be undone from Organize. Open a note and choose **Move note** to change its folder or return it to the project root.

**Templates & settings → Templates** provides inline question cards with six answer formats, duplication, reordering, editable dropdown choices, and a page preview. **Board columns** edits the global stage names/colors/order. Each board explains the notes it includes. Example content is labeled; **Start your own project** opens a blank project setup.

`organization.js` and `organization.css` extend the earlier prototype; older visual-direction code/assets are retained as source history, but their selector and shortcuts are removed from the active UI. This remains browser-local, without an editor extension or sync. No automated tests were run for this revision, following the prototype-only request; the main page and settings were visually reviewed in the browser.
