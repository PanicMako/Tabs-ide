> Historical exploration. The active prototype now uses direction 1 only; the five-way selector has been removed. See README.md for current controls.

# Same Studio, five visual treatments

This revision follows the user's preference for the first Studio prototype. The sidebar, folder hierarchy, return-to-note strip, note collection, list/cards/board switch, custom templates, writing editor, attachments, history, and local storage remain the same in all five versions.

The number selector now chooses an appearance, not a different product layout. Changing appearance retains the selected collection view. The old alternatives are not rendered or selectable in the active page.

1. **Tabs Blue** — inspired by the active local marketing site. Cobalt `#3259ed`, navy `#202b44`, white surfaces, DM Sans with Instrument Serif for the project title, and a small browser/note sketch.
2. **Graphite** — near-black `#17171f`, iris `#b1a0ff`, Space Grotesk, fine geometric edges, and a line drawing of code windows.
3. **Apricot** — bright white-peach `#fffaf8`, coral `#df7959`, Outfit, rounded cards, and a pencil/page drawing.
4. **Lilac** — pale lavender `#fcfaff`, violet `#8b66cb`, Plus Jakarta Sans, soft curves, and a thought bubble containing a note.
5. **After Hours** — midnight `#0d1e2d`, clear cyan `#6fcceb`, Sora, restrained edges, and an evening-note sketch.

Marketing references inspected:

- `tabs-app/apps/marketing/src/components/Concepts.astro`
- `tabs-app/apps/marketing/src/components/ConceptTwoRefined.astro`
- `tabs-app/apps/marketing/src/components/ResourceIllustration.astro`
- `tabs-app/apps/marketing/src/styles/concept-one.css`
- `tabs-app/apps/marketing/src/styles/concept-two-refined.css`

No marketing code was changed. Illustrations are small native SVGs in `appearances.js`, so they remain crisp at different sizes and inherit the chosen palette. They add no bitmap downloads, third-party illustration service, animation, or new interaction burden.

All colors and fonts are presentation choices for review. This revision does not integrate the extension or change the data model. Existing user notes and customization settings remain in browser storage. Default sample project/stage colors are mapped to the current appearance for display, without rewriting their saved data.

## Feasibility check against the local Tabs SDK

`tabs-app/packages/extension-api/README.md` and the Project Companion sample confirm that Tabs-native extensions can package an HTML UI, use granted non-secret JSON storage, read scoped workspace text, and request read-only Git status. The sample's manifest contributes `dist/index.html` as its tool surface. Those capabilities are a plausible basis for the core Relay workspace, subject to the appropriate grants and packaging.

The SDK explicitly distinguishes itself from the VS Code extension API. It documents no persistent background service or workspace write API. Automatic reminders that run after the extension surface closes, repository writes, and opening editor files at a line must not be assumed to work from this prototype. This revision has not implemented or tested an extension.

## Typography and folder UX refinement

The next review asked for substantially more character and stronger hierarchy while retaining the current palettes. The five treatments now pair:

| Treatment | Display / titles | Reading / controls |
| --- | --- | --- |
| Tabs Blue | Bricolage Grotesque | DM Sans |
| Graphite | Unbounded, with Space Grotesk for smaller titles | IBM Plex Sans |
| Apricot | Fraunces | Figtree |
| Lilac | Syne | Manrope |
| After Hours | Archivo Black, with Space Grotesk for smaller titles | IBM Plex Sans |

Display headings use stronger weights; folder titles and section headings have a clearer hierarchy. Reading text remains restrained. Font assets and their licenses are bundled under `fonts/` for the local preview.

The folder collection now always exposes a dedicated New folder tile, including in an empty folder. Existing cards expose a visible Edit folder action. New folders can have any user-entered name; the sample folders are examples rather than fixed categories. Creating a folder requires only its name. Optional icon and color choices show in a live preview, while description, parent folder, default view, and starting note template are collapsed under More ways to make it yours. Saving an edit preserves the notes in that folder.
