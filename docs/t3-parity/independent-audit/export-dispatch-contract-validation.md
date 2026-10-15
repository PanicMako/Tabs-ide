# Export and orchestration contracts — batch230

Reviewed complete current source and changed hunks for index.ts (84 lines), providerInstance.ts (200), orchestrationDispatch.ts (16), orchestrationDispatch.test.ts (31), and orchestrationProject.ts (28). Existing contracts56files824tests evidence reused.

The newly explicit index export selects providerInstance.resolveProviderInstanceEnabled rather than settings.resolveProviderInstanceEnabled. A synthetic customDriver with no enabled flags yields false through the public index and true through settings.ts (Bun actual imports exit0). The settings implementation explicitly documents unknown fork drivers defaulting enabled; the public implementation only defaults codex/claudeAgent enabled. Active serverSettings and AgentSessionScanner consumers import the package helper. This establishes a public API default mismatch affecting custom-driver callers; full live custom provider UI/session impact remains unverified. Neither helper implementation was changed in this diff; the new export selects the differing implementation.

Dispatch error tests assert both optional dispositions. Active source search finds the field only in contracts/tests and client-runtime error helper, with no server producer. Consequently tests prove wire decoding, not bootstrap cleanup notification. ProjectStore.toShell maps the new project shell fields; live shell stream coverage remains separate scope.

No production edits.
