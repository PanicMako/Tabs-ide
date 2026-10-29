# Relay

A quiet place to pick up where you left off. Leave a quick note, keep the context behind your work, and return when you are ready.

## Your notebook, your way

- Write straight away. Titles, templates and extra details are optional.
- Keep projects as simple notes, or organize them with nested folders.
- Browse notes as a list, cards or a board. Customize the board columns.
- Pin a note for easy access, archive finished work, and search your notebook.
- Create, edit, duplicate and delete reusable templates. Add short answers, paragraphs, checkboxes, checklists, multiple choice, dropdowns, ratings, numbers, dates, times, email, links or code snippets.
- Rearrange template fields using drag handles or keyboard controls and try the interactive preview.
- Add project logos, attachments, labels, branch details and file references when useful.
- Move folder trees and their notes to Trash and restore them together.
- Relay follows the light or dark theme chosen in Tabs.

## Getting started

After installing and enabling Relay for your project, open **Relay** from the Tabs tools toolbar. The short welcome helps you choose a starting view; you can skip it. Choose **New note** to start writing.

Open **Settings → Templates** to manage your layouts, or **Settings → Board** to customize columns. All template fields are optional. Deleting a template keeps existing notes and saved answers.

## Local storage and backups

Relay requests no Tabs capabilities and uses no remote service or telemetry. Notes and attachments stay in the extension's assigned Tabs profile. Shared profiles share a notebook across Tabs projects; project-isolated profiles keep them separate. Relay's own projects are notebook collections, separate from Tabs workspace projects.

Use **Settings → Backup & data → Export backup** regularly. The installed extension offers export text to copy into a `.json` file. Restore it with **Restore backup**. Clearing profile data can remove local notes. See [data and privacy](PRIVACY.md) for details and attachment limits.

## Publication status

Package identity: **panicmako.relay**, version **0.1.0**. The archive is a Tabs-native `.tabsext` package, not a Chrome extension or VS Code VSIX.

On 18 October 2026, the live Exchange registry still reports publishing disabled. This archive is prepared for submission, but has not been uploaded, approved or signed. Public installation requires the Exchange review and signed publication pipeline. A local package or GitHub release does not make it installable through the marketplace.

For local testing, use a Tabs development build's **Settings → Extensions → Discover → Load local archive**, then select `panicmako-relay-0.1.0.tabsext`. Packaged desktop builds may reject development archives; use the normal Exchange installation flow once a signed release is available.

## Build from source

From the Tabs repository root:

```sh
bun extensions/relay/scripts/build.mjs
bun test extensions/relay/scripts/controls.test.mjs
bun tabs-app/packages/extension-package/src/cli.ts validate extensions/relay/package --tabs-version 2.0.0
bun tabs-app/packages/extension-package/src/cli.ts pack extensions/relay/package extensions/relay/releases/panicmako-relay-0.1.0.tabsext --tabs-version 2.0.0
bun tabs-app/packages/extension-package/src/cli.ts inspect extensions/relay/releases/panicmako-relay-0.1.0.tabsext --tabs-version 2.0.0
```

The build bundles the Relay source and licensed local fonts with a restrictive content security policy. It starts with an empty notebook on a new profile and preserves existing notebook storage. Standalone review preview: `http://127.0.0.1:4185/`.
