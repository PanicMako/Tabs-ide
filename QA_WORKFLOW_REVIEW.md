# Testing workspace: QA lifecycle review

Date: 2026-09-04. Status: implementation and focused automated checks complete; native end-to-end acceptance incomplete. Product Reports is excluded as requested.

## Executive assessment

The reported problems cross three boundaries: the browser being scanned was not reliably the browser shown to the user; discovered elements lost identity and coverage during extraction/storage/display; generated tests did not reliably express the reviewed test steps. Fixing a single selector prompt would not repair this workflow.

Changes in this working tree address those boundaries, but this is not a claim that every test now passes. In particular, authenticated execution, whole-suite performance, dynamic-page coverage and native acceptance still need work/verification.

## Findings and implemented changes

| Area              | Finding                                                                                                                                                                 | Change                                                                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| URL entry         | Navigation and editing state were coupled.                                                                                                                              | Address draft commits through Open or Enter; only HTTP(S) URLs are accepted.                                                                                       |
| Wrong page        | A separate MCP session and historical first-page fallback could disagree with the embedded browser.                                                                     | Desktop scans consume the exact preview session's accessibility and DOM snapshots; selected results match the captured URL.                                        |
| Subpage scanning  | Discovery state made the flow behave like a one-shot wizard.                                                                                                            | Scan the current page within an existing discovery session; repeated scans do not consume additional page slots.                                                   |
| Missing locators  | Accessibility-only extraction omits useful unnamed/non-semantic elements; non-ASCII names could collapse into the same normalized key; display was capped at 100 cards. | Shared DOM extraction, selector-based unique keys, preserved non-ASCII identity, and removal of the card slice.                                                    |
| Poor names        | Generic trailing URL segments produced weak page names; icon glyphs produced unreadable element names.                                                                  | Page names use meaningful path segments; element labels use available labels/attributes/context and exclude private-use glyphs.                                    |
| Rescan safety     | Destructive replacement risks losing a usable library on failure.                                                                                                       | Failed scans preserve previous results; successful complete scans archive absent discovered entries rather than deleting them.                                     |
| Test generation   | Generic activation did not express fills, selections, checks, keyboard actions or step assertions.                                                                      | Structured ordered action plans; unknown locator keys and missing inputs block generation instead of fabricating executable success.                               |
| Failure diagnosis | Failure evidence was not directly usable from the run view.                                                                                                             | Error details and an explicit rebuild-failed-cases action pass sanitized diagnostics to generation without authorizing weakened assertions.                        |
| Runner packaging  | A source-relative Playwright CLI path was brittle in bundled execution.                                                                                                 | Resolve the installed package CLI and supply module lookup/environment configuration.                                                                              |
| Authentication    | A persistent browser profile alone does not provide storage state to an independent Playwright test context.                                                            | Explicit authentication capture exports storage state, restricts its file permissions, and execution loads it when present. This path still needs live acceptance. |
| Startup           | Timeout/empty hydration state exposed a misleading empty workspace before saved projects arrived.                                                                       | Keep the startup animation until bootstrap and project hydration complete, with a delayed connection status instead of false empty recents.                        |

### Why Chinese appeared

The supplied screenshot contains Chinese accessible names. The application must preserve actual page names in selectors; translating them to English would create selectors that do not match the page. The code-level defect confirmed here is identity loss when non-ASCII names normalize to the same key, not a proven translation setting in Tabs.

The embedded OrangeHRM login was observed in English during inspection. The source of the authenticated page's Chinese labels remains unconfirmed: site/account state and browser language behavior must be checked in the same authenticated session. No shared demo language setting was changed.

### What “all elements” means

The new scanner includes rendered meaningful elements such as controls, links, headings, images, table rows/cells and text elements, including off-screen rendered elements. It records current selector match counts and flags structural fallbacks as fragile. Capture limits remain explicit rather than promising unbounded output.

It does not discover future DOM states automatically. Open a menu/modal, change a tab or paginate, then scan again to capture that state. Closed shadow roots, iframe contents, virtualized rows not currently rendered and hidden future controls are not covered by this implementation. More candidates is not the same as more stable locators; review fragile candidates before exporting.

## Intended QA workflow and acceptance gates

1. Open the correct repository. Wait for restored projects to finish loading; a genuinely fresh profile should show no recent projects only after hydration.
2. In App & locators, enter OrangeHRM and commit with Open/Enter. Confirm the visible URL and page match. Typing must not repeatedly navigate.
3. Authenticate in the relevant browser workflow. Do not assume embedded-preview cookies automatically transfer to an independent verification or execution browser; use the explicit authentication capture workflow for runnable authenticated tests.
4. Navigate to Dashboard, Employee List, then Time. At each page, press Scan without cancelling discovery. Results must identify that page, never an earlier Google scan.
5. Review candidates and selection. Include links, unlabeled inputs, repeated table controls and non-English labels. Each exported locator must resolve uniquely or be explicitly marked for review; compare the count with the currently rendered page, not the entire application.
6. Save selected locators/page objects to the intended repository. Inspect the diff before using them. Repeat a scan and confirm previous manual/repository edits are preserved.
7. Select reviewed test cases with explicit preconditions, inputs, ordered actions and expected outcomes. Map the required locators. Missing data should block the case with a reason.
8. For a quick local path, record a journey in the embedded preview. Stop, review the structural selectors, replace input placeholders with test data, add an explicit expected visible text, then save. This creates a repository test and Tabs-managed artifact without using AI.
9. For a generated candidate, select exactly one reviewed case and choose **Build with official Playwright tools**. It uses the currently selected provider and the installed Playwright MCP tools in an isolated managed folder. Review the candidate before execution; a generated file is not proof of a working test.
10. Inspect the actual error. Distinguish application defect, selector drift, missing authentication/data and infrastructure failure. The official repair action produces a separate candidate from the failure evidence; it must not remove assertions or skip cases merely to produce green results.
11. For a larger batch, verify case isolation and deterministic data before increasing concurrency. Preserve per-case failure evidence and cancellation behavior.

## Verification evidence

- Latest focused server run: recorder, recording handoff and official-candidate tests passed (six tests), and the combined generator/execution suite passed 12 tests with one intentional controlled-browser skip.
- Latest preview helper run: 1 file, 3 tests passed (URL validation, accessibility serialization and exact-page selection).
- Server, web and shared-package typechecks passed; unrelated Effect advisory messages remain.
- Full web suite passed: 90 files / 681 tests.
- Full server run was not green: 7 failed files, 177 passed, 6 skipped; 36 failed tests, 1413 passed, 31 skipped. Failures included provider/transport timeouts and incomplete-port exports outside this work. Their pre-existing status was not independently established on a clean checkout.
- Workspace typecheck was blocked by missing TypeScript executables in other packages. Required `vp` commands are unavailable in this environment. The VS Code precommit entry point declined to run because no files were staged.
- Native computer use currently sees Electron's default-app window under the `Tabs (Dev)` name, rather than the Tabs workspace. This is a launch-state issue, so it cannot validate the end-to-end sequence. No provider-backed generation was invoked during implementation because it can consume the selected provider's quota.

## Remaining risks / follow-up work

- Complete the native acceptance sequence above before release; do not treat recorder/candidate tests as authenticated browser execution evidence.
- Add real-DOM extraction fixtures, iframe/open-shadow-root coverage and same-URL hydration/readiness checks.
- Review rediscovery of previously archived entries: existing-key upsert currently preserves old entries, so reappearing controls may remain archived.
- Verify manually named CSS locators independently; match-count fallback through accessibility snapshots is not equivalent to evaluating every CSS selector.
- Verify authenticated scan, verification and run contexts end-to-end, including expired sessions and login redirects.
- Official agent generation is intentionally one reviewed case per request, because its provider usage is not a hard-capped batch budget. The normal runner supports one to four isolated concurrent cases.
- Review selected-artifact versus latest-generation-job behavior and URL override semantics before relying on mixed-job execution.
- Startup now waits for readiness rather than a timer, but connection failure needs a recoverable retry/error experience and live restart testing.

## Research and reusable upstream patterns

- [Playwright best practices](https://playwright.dev/docs/best-practices): test user-visible behavior, isolate tests and use resilient locators. Adopt its testing principles rather than maximizing brittle DOM paths.
- [Playwright locators](https://playwright.dev/docs/locators): semantic locators and test IDs are preferable contracts; generated structural selectors should remain visibly fragile.
- [Playwright actionability](https://playwright.dev/docs/actionability): use actionability checks and retrying assertions instead of arbitrary sleeps.
- [Playwright debugging](https://playwright.dev/docs/debug): preserve execution evidence so repairs target actual failures.
- [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp): useful browser/tool integration reference. Its accessibility snapshot is not an exhaustive application locator inventory. Installed tool behavior was inspected before adding DOM evaluation and storage export.
- [Microsoft Playwright](https://github.com/microsoft/playwright): reference for runner, generator and trace workflows (Apache-2.0).
- [Gauge Taiko](https://github.com/getgauge/taiko) and [Taiko documentation](https://docs.taiko.dev/installing/): reference for readable browser-test authoring and interactive exploration. Evaluate fit and current license before reusing implementation.

No upstream source code was copied into this patch. Any future reuse should retain license notices and be evaluated against Tabs' embedded-browser/session architecture.

Accessibility guidance influenced the use of labelled controls, status announcements and the existing custom confirmation dialog rather than native browser dialogs.
