# Upstream integration status

This is an incremental integration into Tabs, not a replacement by four installed platforms.

## Implemented in the application

- Test runs offers 1-4 concurrent cases, defaulting to one. Each case retains its own browser process, output directory and report. Enable parallel execution only for independent accounts/data.
- Bounded scheduling follows QA Studio's general batch-runner approach, implemented locally against Tabs' stores and contracts. No QA Studio source was copied.
- Official Playwright JSON reports determine status alongside the process result. A green result requires actual successful tests, no skips, no retry-flaky outcomes, no expected-failure annotations and no report-level errors.
- Missing reports, skipped/empty suites, timeouts and process launch failures are blocked rather than green. Launch failures are persisted instead of leaving a run running.
- The controlled browser integration test exercises the actual Playwright runner, database persistence and evidence handling.
- **Record journey** now records trusted, top-level interactions in the embedded Tabs preview. It deliberately retains structural selectors only: typed values, text labels and URLs from page elements are never captured. A recorded journey must be reviewed, supplied with test data and given an explicit visible-text assertion before it can be saved.
- Saving a reviewed journey creates both a repository spec and a Tabs-managed runnable artifact. This path is local and uses no model or provider quota.
- **Build with official Playwright tools** creates one isolated, managed candidate using the installed Playwright generator/healer MCP server. It keeps the selected provider; Tabs does not switch providers or silently fall back. A repair keeps the original test and proposes a separate candidate. Skips, expected-failure markers, empty suites and unchanged repairs are rejected.

## Pinned references inspected

- [Playwright 1.61.1](https://github.com/microsoft/playwright/tree/v1.61.1): installed official runner, MCP and demo agent definitions.
- [QA Studio batch runner](https://github.com/AbdulrahmanMasoud/qa-studio/blob/771b9fe737d2f3a63e7a4a5dd68de23ddb0adec2/apps/server/src/services/batch-runner.ts): bounded-concurrency reference. package.json declares MIT.
- [Quorvex architecture](https://github.com/NihadMemmedli/quorvex_ai/blob/bd83e409f888d707bc2cee70cd179b78867ab50e/docs/explanation/pipeline-architecture.md): MIT LICENSE and independently persisted pipeline stages inspected; not imported.
- [Locator-registry Scout](https://github.com/Karthick-1501/playwright-agent/blob/d2543126f1e0735bfa16d8716a0edcb001dbfa31/src/agent/scout.js): implementation filters unnamed accessibility nodes and uses ASCII naming. Not a drop-in fix for Tabs' missing/non-English locators. No code copied; review exact license before copying.

## Verification and remaining scope

Focused recorder, generation, repair and execution tests pass, including a real local Playwright fixture and a candidate syntax/import check using the installed runner. Server and web typechecks pass. The current visible `Tabs (Dev)` process is Electron's default-app screen rather than the Tabs workspace, so it cannot be used as native acceptance evidence; no OrangeHRM/provider-backed generation run was performed.

Quorvex remains a reference, not an installed engine. Provider-backed generation is deliberately not called during implementation: it uses the currently selected provider and can consume its quota. Authenticated OrangeHRM acceptance remains a release check once the actual Tabs workspace is launched.
