# Git Status example

This Tabs-native, UI-only extension requests the `git-status` capability. Load
it in desktop development mode, enable it for a project, then grant "Allow
read-only Git status" for that project in Settings > Extensions > Profiles &
Permissions. Its full-workspace tool shows only the active project's branch
and whether Git sees changes. It cannot choose a repository path, list file
names, run Git commands, or access another project's status. A project without
a Git repository reports an error.

Validate and package it with:

```sh
bun packages/extension-package/src/cli.ts validate examples/git-status-extension --tabs-version 1.3.17
bun packages/extension-package/src/cli.ts pack examples/git-status-extension /tmp/git-status.tabsext --tabs-version 1.3.17
```
