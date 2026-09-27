# Calculator sample extension

This Tabs-native extension contributes a full-workspace calculator and two
packaged pure-computation commands. The UI calls
`tabsExtension.logic.invoke("add" | "multiply", { first, second })` and Tabs
runs `dist/logic.js` in a fresh QuickJS worker for each invocation. The logic
has no direct Node, filesystem, network, workspace, or credential access.

Validate and pack it from `tabs-main`:

```sh
bun packages/extension-package/src/cli.ts validate examples/calculator-extension --tabs-version 1.3.17
bun packages/extension-package/src/cli.ts pack examples/calculator-extension /tmp/calculator.tabsext --tabs-version 1.3.17
```

Load it in a desktop development build, enable it for a project in Settings >
Extensions, and select Calculator in the project toolbar.
