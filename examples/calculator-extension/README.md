# Calculator sample extension

This Tabs-native extension contributes a full-workspace calculator and two
packaged pure-computation commands. The UI calls
`tabsExtension.logic.invoke("add" | "multiply", { first, second })` and Tabs
runs `dist/logic.js` in a fresh QuickJS worker for each invocation. The logic
has no direct Node, filesystem, network, workspace, or credential access.
The Add command is also AI-callable after granting this extension's AI tools for
the specific project in Settings > Extensions > Profiles & Permissions. Tabs'
Codex MCP session receives a tool whose `input` is `{ "first": number, "second": number }`; Multiply
remains callable only from the extension UI. This tool is exposed through Tabs'
MCP session for the active project, never to unrelated projects. The Claude SDK
configuration is wired too, but live Claude verification and ACP provider wiring
are still pending.

Validate and pack it from `tabs-main`:

```sh
bun packages/extension-package/src/cli.ts validate examples/calculator-extension --tabs-version 1.3.17
bun packages/extension-package/src/cli.ts pack examples/calculator-extension /tmp/calculator.tabsext --tabs-version 1.3.17
```

Load it in a desktop development build, enable it for a project in Settings >
Extensions, and select Calculator in the project toolbar.
