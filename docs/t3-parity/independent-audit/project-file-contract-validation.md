# Project file contracts — batch209

HEAD unchanged bb89383e8516d6ee6c730579be3e353a8e43a0e9. Complete143line new T3 schema/71line new tests/104line Tabs schema read. Full20-addition/18-deletion Tabs diff inspected; new T3 files wholly added. Reused824contract tests.

Both schemas accept async setup scripts and submodule mode; Tabs switches to shared TrimmedNonEmptyString. T3 adds file-backed setting metadata and resolved types; contracts index exports both modules. T3 tests cover normal fields/trim/unknown stripping/missing command/invalid icon/mode but not50-script or512-path limits, whitespace-only fields or Tabs schema directly.

Shared public ./t3ProjectFile maps to tabsProjectFile.ts and its T3 decoder is an alias of the Tabs decoder (earlier shared review finding). V2 T3ProjectFileLoader imports this alias yet builds only workspaceRoot/t3.json at69; missing file returns none at87. No tabs.json fallback appears in that loader. TabsProjectFile description promises tabs.json or t3.json, so that source path does not implement the documented filename coverage. This is bounded source evidence for V2; shipped desktop integration remains unverified and earlier entrypoint split remains relevant. No external schema website availability verified.

No production edits. Full audit incomplete.
