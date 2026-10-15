# Project Companion sample extension

This single Tabs-native package exercises five independent capabilities:
named account profiles, profile storage, project-scoped workspace reads,
credentialed network access, and an AI-callable pure command. Its full-workspace
tool reads a text file from the active project, displays at most 10,000 UTF-16
code units, and can pass that preview to the packaged text-analysis command.
The same command is AI-callable when `ai-tools` is granted for the project,
but an AI caller must supply its own text: the logic runtime cannot read the
workspace, profile storage, network, or credentials.

In a desktop development build, load this folder from Settings > Extensions >
Discover. Create Work and Personal profiles in Profiles & Permissions. Assign
them to different projects, enable Project Companion in each project, and grant
`workspace-read` and `profile-storage` separately in each project. A shared
profile deliberately shares its saved `lastPath`; a project-isolated profile
keeps that state separate. To try the account button, save a separate GitHub
token for each profile for `api.github.com` and grant `network` and
`credentials` for the project. Tabs attaches the token to `GET /user`; this
sample never receives the token. Only use a minimally scoped token for a
service you trust. Grant `ai-tools` separately to expose Analyze Text through
that project's MCP session; start a new provider session after granting it.

To verify isolation, assign Work in one project and Personal in another, load
each account, and read a different `README.md` in each project. Revoke one
project's workspace grant and confirm that its read fails while the other
project still works. The AI command accepts `{ "text": "hello world" }` and
returns word, line, and Unicode-character counts without using either account
or project file access.

Validate and package from `tabs-main`:

```sh
bun packages/extension-package/src/cli.ts validate examples/project-companion-extension --tabs-version 1.3.17
bun packages/extension-package/src/cli.ts pack examples/project-companion-extension /tmp/project-companion.tabsext --tabs-version 1.3.17
```

This is a development sample, not a reviewed Exchange publication. It uses
the same fixed GitHub endpoint described in the
[GitHub Profile sample](../github-profile-extension/README.md).
