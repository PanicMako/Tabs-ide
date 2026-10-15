# Workspace Reader example

This Tabs-native extension demonstrates the per-project `workspace-read` grant
and optional named-profile `profile-storage`. It cannot choose a project root:
the host binds reads to the active project. The path is remembered only when
profile storage is separately granted.

Load this folder from Settings > Extensions > Discover in a desktop development
build. Enable it for a project, then grant "Allow read-only workspace files"
for that project in Profiles & Permissions. Grant non-secret profile storage
there too if you want the last path remembered. Read `README.md` or another
UTF-8 file under that project. The file-size limit is 1 MiB.

For a deterministic package, run:

```sh
bun packages/extension-package/src/cli.ts pack examples/workspace-reader-extension /tmp/workspace-reader.tabsext --tabs-version 1.3.17
```

This example has no background runtime, credential access, direct network
access, or AI-callable tools.
