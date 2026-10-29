# Relay: a personal space for unfinished thinking

Design review: 17 October 2026. These are browser prototypes, not an implemented extension.

## The core product decision

Relay helps a person return to unfinished development work with enough context to begin again. Its defining action should be as easy as leaving a thought. A useful note might contain intent, an attempt, an observation, a next action, or code references. Requiring every item every time would turn a personal tool into a reporting system.

The user's Blackframe Studio reference changed the design direction: put the free-writing surface first; make organization and prompts adjustable. The revised five concepts explore different spaces for that same behavior, rather than prescribing different kinds of work.

## Evidence and its limits

### The original VS Code conversation

[Source](https://www.reddit.com/r/vscode/comments/1pp05qq/anyone_else_lose_their_entire_mental_context/)

Participants describe project scratchpads, TODO lists, and associating notes with code. The original post emphasizes losing reasoning even when files remain available. This motivates preserving both narrative and references. It does not establish that a structured handoff card is everyone's preferred solution.

### Per-project logs, search, and resistance to structure

[Hacker News conversation](https://news.ycombinator.com/item?id=9895713)

The discussion includes per-project text logs and searching old notes. Other participants describe the burden of imposing too much structure on fast-moving thoughts. The product inference is to support both unstructured writing and optional reusable prompts, with search for retrieval. The comments also concern preventing interruptions; Relay addresses returning after them, not the whole interruption problem.

### Keeping reminders close to the code

[Webdev conversation](https://www.reddit.com/r/webdev/comments/1e59w2a/just_me_how_do_you_remind_yourself_where_you_left/)

Examples include inline TODOs, project tasks, and comment anchors. These support making relevant code easy to locate. Branch and file:line references are present in the prototype; actual editor navigation depends on a future host integration.

### Remembering investigations

[ExperiencedDevs debugging conversation](https://www.reddit.com/r/ExperiencedDevs/comments/1jzo7d3/)

Developers discuss taking notes on call paths, observations, and approaches they have tried. The design inference is to preserve earlier reasoning when a note changes. A checkpoint history makes the sequence available without requiring a separate report.

### Research on returning to interrupted work

[Parnin and DeLine, CHI 2010](https://www.microsoft.com/en-us/research/publication/evaluating-cues-for-resuming-interrupted-programming-tasks/)

Their work includes a survey of 371 programmers and a controlled study of resumption aids. It reports reliance on note-taking and a preference for chronological code snippets among the cues studied. This motivates coupling personal notes with contextual references and a history. It does not validate Relay, its interface, its reminder timing, or a predicted time saving.

[Parnin and Rugaber, ICPC 2009](https://chrisparnin.me/pdf/parnin-icpc09.pdf)

Their analysis of programming sessions describes the activity involved in recovering context before editing. It supports treating retrieval as a product problem. It does not dictate whether the best surface is a sidebar, notebook, board, or focused editor.

Community discussions are qualitative examples, not a representative survey. The product choices below remain hypotheses for the user to compare.

## What a first useful version needs

| Need | Prototype behavior | Reason for the choice |
| --- | --- | --- |
| Capture without overhead | Title and free writing; neither a type nor a next-step answer is mandatory | Avoid a form-completion ritual |
| Keep organization personal | Named projects, nested folders, descriptions, and optional free-form labels | Let language reflect the person's work |
| Adjust the note format | Editable reusable page layouts; six answer formats; blank page available | Different moments need different amounts of structure |
| Find the way back | Latest-note return point, scoped search, global search, pinned notes | Support both immediate resumption and later recall |
| Avoid repeating approaches | Checkpoints retain earlier writing and answers | Preserve the path as well as the current conclusion |
| Make work spatial | Board spaces can be renamed, recolored, reordered, added, and removed | Avoid imposing a mandatory issue-tracker workflow |
| Save relevant evidence | Local screenshots/files and code/link references | Keep explanations beside supporting material |
| Keep things tidy | Put a note aside and bring it back | Move finished or dormant thinking out of the daily view |
| Keep ownership | Browser persistence, JSON backups, and readable Markdown | Let notes leave the prototype without an account |

## Organization model

Project → optional nested folders → notes. A note has one location and one board space. These are separate dimensions: moving a card on the board changes its stage; changing its folder changes its location. Neither action duplicates it.

Folder options can choose a default view (list, cards, board) and a starting page layout. Otherwise the project-wide writing preference and the selected prototype's defaults apply. A parent-folder view can include descendants. Global search covers all projects and can retrieve notes that were put aside.

The sample names—“The little details,” “From the notebook,” and “Worth coming back to”—illustrate personal organization, not fixed categories. Users can replace them. “To come back to,” “Taking shape,” “A little pause,” and “Tucked away” are editable example board spaces.

Folders remain explicitly identified as folders in navigation and menus. Friendly copy should not hide the underlying action behind unfamiliar terminology.

## Writing model

A fresh note starts with “Just a thought”: a title and a free-writing area. Saving can derive a title from the first line when the title is empty. “Pick up later” adds optional prompts for where the person got to, a place to start, and something still on their mind. “Working something out” offers an alternate exploration layout. These names and questions can all be changed.

Custom answers can be short text, longer text, checkbox, dropdown, date, or link. Removing a question from a layout retains its existing answers. Reading views expose answers from earlier layouts separately, and backups retain them. Removing a layout keeps its notes. Removing a board space moves notes to the first remaining space.

The note editor saves a recoverable draft while writing. Explicitly keeping a note or checkpoint updates the saved record. Closing a draft preserves it; “Let this draft go” discards the draft only. Every active treatment now uses the same explicit-save Studio editor. Its draft is retained as the user writes; a saved checkpoint preserves the earlier note.

Lightweight Markdown display supports paragraphs, emphasis, inline code, code blocks, headings, and lists. It is a small prototype formatter, not a full Markdown editor. No rich-text toolbar or collaborative editing is implied.

## Five visual treatments of the first Studio

The latest user review selected the first Studio structure and rejected the other four interaction models and the earthy green palette. The active preview now renders the same Studio component for every number. Only typography, palettes, surfaces, details, and the small illustration change. Notes, folders, boards, templates, and settings remain shared. Switching treatments preserves the selected collection view.

| Number | Treatment | Visual language |
| --- | --- | --- |
| 1 | Tabs Blue | The active marketing site's cobalt #3259ed, white, navy, DM Sans, Instrument Serif accents, and small workspace illustrations |
| 2 | Graphite | Near-black and electric iris; Space Grotesk; precise corners and a small code-window sketch |
| 3 | Apricot | Bright peach and white; rounded Outfit; softer cards and a pencil-and-page illustration |
| 4 | Lilac | Lavender and violet; Plus Jakarta Sans; rounded surfaces and a thought-bubble illustration |
| 5 | After Hours | Midnight blue and cyan; Sora; crisp surfaces and an evening-note illustration |

The marketing inspiration was read directly from `tabs-app/apps/marketing/src/components/Concepts.astro`, which renders `ConceptTwoRefined.astro`, and its `concept-one.css` and `concept-two-refined.css` styles. `ResourceIllustration.astro` demonstrates the site's small outlined windows, sheets, and workspace diagrams. These are reference sources; the marketing site was not edited.

The former alternate layouts are removed from the active selector and kept in a recovery copy under `archive-studio-directions/`. The 1–5 bar remains a design-review control and would not be part of the extension.

## Current technical scope

- Buildless local HTML, CSS, and JavaScript. No application, extension, or deployment was created.
- One shared workspace across five layouts, with browser-local settings and text in localStorage.
- Attachments in IndexedDB, limited to 5 MB each and 12 per note for this prototype. Raster images can be previewed; other files download when opened.
- JSON backup includes current state and available attachment payloads. Restore is reviewed before replacing the workspace. It accepts this exploration's Studio backup format, not every prior Relay or Blackframe format.
- Markdown export includes note content, active and retained answers, references, and earlier thoughts. Binary attachments remain in the JSON backup rather than being embedded in Markdown.
- Root project selection controls browsing. The global find dialog searches across projects; the visible search field searches the current view.
- Bundled Google Fonts with their licenses and system fallbacks; the active prototype makes no external font requests. No AI service, account, remote storage, live editor bridge, or automatic code inspection.

## After a design is chosen

Inspect the actual Tabs extension SDK and examples before selecting any integration contract. A VS Code-compatible host could offer workspace-specific storage, but that must not be assumed to describe Tabs' own API. [VS Code storage documentation](https://code.visualstudio.com/api/extension-capabilities/common-capabilities) is a possible reference, not a confirmation of host support.

Later work would include stable workspace identity, branch association, opening a referenced file and line, moved-file handling, storage selection, and optional reminders. Automatic summaries, shared repository files, sync, sub-notes, and collaboration should each earn their complexity through actual use. No private note should be written into a repository automatically merely because a project is open.

## What to learn from the next review

Ask which version the user would naturally reopen, not just which screenshot they prefer. The layout is held constant in this revision to make palette and typography preferences easier to compare. Observe whether they can leave a thought without choosing a category, find it after switching projects, understand folders versus board spaces, customize a prompt, and return to earlier reasoning. Check whether friendly labels remain clear and whether the sidebar feels like personal organization rather than administration.

No automated or extension tests were run, following the original instruction to focus on the prototype. The five visual directions were reviewed in the local browser. This is not a claim of exhaustive functional, browser-compatibility, or accessibility validation.

## October 17 — optional organization and a simpler builder

The active prototype now keeps Studio's first visual direction only. Folders are an opt-in organization style for each project, with a reversible switch to a flat notes view. Existing folder locations remain intact when hidden. A folder can hold both notes and other folders; users can move folders through a parent selector, reorder siblings, and move notes to the project root. Removing a folder promotes its direct notes and subfolders to its parent, preserving their contents. The last folder removal can be undone and survives reloads.

Google Forms' [official editing guide](https://support.google.com/docs/answer/2839737?hl=en) describes editing question text in place, selecting an answer type, duplicating questions, and moving questions. The prototype adapts those interactions to optional note prompts: question cards, inline wording, answer-format selector, individual dropdown options, duplicate/reorder/remove controls, and an interactive page preview. A title and free writing remain available in every template. Existing answers to retired prompts remain available with the note.

Boards are another view of the same filtered notes, not a second source of content. Scope text now explains which project/folder is shown, and a visible configuration action edits the shared board columns. The seeded Tabs project is labeled as an example workspace; users can start an empty project without deleting existing writing.
