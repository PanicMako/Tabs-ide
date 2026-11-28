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

## Agent notebook

- **Ask** (top bar): type an `@relay` command such as `@relay remind me to call Sam tomorrow at 4`, or a free-form request. Quick things (a to-do, a reminder, context, ticking something off) are saved instantly with Undo. Anything bigger is handed to a Tabs agent in this project, using the model you pick.
- **From agents** (sidebar): the to-dos, reminders and context your agents and Ask keep for this project. Tick, edit, pin, snooze or delete them. Reminders that come due appear as a toast with Done and Snooze 1 h.
- **Share with agents** (on a note): keeps a copy of the note as agent context, updates it when you save the note, and can be stopped any time.

It is on by default for every project. Things you save with `@relay` appear in All notes and Pinned, marked “via @relay”. To turn it off for a project: **Settings → Extensions → Relay → Agent notebook**. When it is off, Relay works as before, and Ask and From agents explain how to enable it. Standalone preview: add `?agents=demo` to the address for labelled demo data.

## Getting started

After installing and enabling Relay for your project, open **Relay** from the Tabs tools toolbar. The short welcome helps you choose a starting view; you can skip it. Choose **New note** to start writing.

Open **Settings → Templates** to manage your layouts, or **Settings → Board** to customize columns. All template fields are optional. Deleting a template keeps existing notes and saved answers.

## Local storage and backups

Relay's only Tabs capability is the optional, per-project **Agent notebook**, and it uses no remote service or telemetry. Your notes and attachments stay local in the extension's assigned Tabs profile. Only items you share with agents, or create through Ask or `@relay`, are stored in Tabs on this computer. Shared profiles share a notebook across Tabs projects; project-isolated profiles keep them separate. Relay's own projects are notebook collections, separate from Tabs workspace projects.

Use **Settings → Backup & data → Export backup** regularly. The installed extension offers export text to copy into a `.json` file. Restore it with **Restore backup**. Clearing profile data can remove local notes. See [data and privacy](PRIVACY.md) for details and attachment limits.

## Releases

Relay is a Tabs-native extension with the package identity **panicmako.relay**.

The [Relay 0.2.1 GitHub release](https://github.com/PanicMako/Tabs-ide/releases/tag/relay-v0.2.1) provides a package for Tabs development builds with extension API 1.11 and Agent notebook support. In a compatible build, choose **Settings → Extensions → Discover → Load local package**, select the archive, and enable Relay for your project.

Installed Exchange copies receive signed versions through Tabs. Check the public Exchange listing from the terminal by downloading `relay-version.mjs` from the GitHub release and running:

```sh
node relay-version.mjs
```

The command reports the published Exchange version and its extension API requirement. If you want to compare it with your installation, add `--installed 0.1.0` using your installed version.

### Submit an Exchange update from the CLI

Use a `tabsext` build with extension API 1.11 support. Configure a scoped `panicmako` publisher token as `TABS_EXCHANGE_TOKEN` for submission and status checks.

```sh
tabsext publish extensions/relay/releases/panicmako-relay-0.2.1.tabsext --registry https://exchange.buildwithtabs.com --tabs-version 2.11.0
tabsext status panicmako relay 0.2.1 --registry https://exchange.buildwithtabs.com --watch
```

The registry must support the Agent notebook capability to accept the submission. Submission starts review. Approved releases become available through Exchange after the registry operator signs them.

## Build from source

From the Tabs repository root:

```sh
bun extensions/relay/scripts/build.mjs
```

The `@relay` parser is generated from `tabs-app/packages/shared/src/relayCommand.ts` (`bun extensions/relay/scripts/gen-command.mjs` refreshes the preview copy `prototypes/relay/relay-command.js`). Use a `tabsext` build with extension API 1.11 support to validate and package the staged files.

```sh
bun test extensions/relay/scripts/controls.test.mjs
tabsext validate --directory extensions/relay/package --tabs-version 2.11.0
tabsext pack extensions/relay/releases/panicmako-relay-0.2.1.tabsext --directory extensions/relay/package --tabs-version 2.11.0
tabsext inspect extensions/relay/releases/panicmako-relay-0.2.1.tabsext --tabs-version 2.11.0
```

The build bundles the Relay source and licensed local fonts with a restrictive content security policy. It starts with an empty notebook on a new profile and preserves existing notebook storage. Standalone review preview: `http://127.0.0.1:4185/`.
