# Workbench Extras sample extension

Shows the contribution points added in extension API 1.9 alongside a tool:

- `contributes.quickActions`: a **Notes** entry in the Quick Actions launcher.
- `contributes.paletteCommands`: **Workbench Extras: Open scratch notes** in the Command Palette.
- `contributes.themes`: **Ember** (dark) and **Paper** (light) in Settings → Themes.

The tool keeps per-project notes with `tabsExtension.storage`, so it asks for the `profile-storage` capability; grant it per project in Settings → Extensions. Themes and the launcher and palette entries need no capability.

Validate and pack it:

```sh
bun packages/extension-package/src/cli.ts validate examples/workbench-extras-extension --tabs-version 2.4.0
bun packages/extension-package/src/cli.ts pack examples/workbench-extras-extension /tmp/workbench-extras.tabsext --tabs-version 2.4.0
```
