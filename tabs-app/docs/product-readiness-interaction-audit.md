# Tabs Interaction and State Production-Readiness Audit

## Executive assessment

The per-project tool-memory problem is a confirmed state-coordination race, not a failure of persistence. Tabs already stores the selected tool independently for every project and persists that map to local storage. The selection is later overwritten when a project switch occurs while the current URL still identifies an Agent thread. The route-to-store synchronization effect interprets that stale route as a fresh user intent and restores the previous project and its Agents tool before navigation finishes.[^1]

The broader settings and browser-profile concerns are also valid:

- Settings currently mixes immediate auto-save, local drafts, explicit Save buttons, and optimistic remote persistence without a shared save-status model.
- The standard Browser tool already defaults to **Resume last visited page = on**, but custom browser tabs default to off in both their schema and creation UI.[^2]
- The Browser Profiles “Stored sites” view is actually a cookie-domain inspector. It cannot show sites that only have local storage, IndexedDB, cache, service workers, or browsing history, and errors are converted into an indistinguishable empty list.[^3]
- Settings is a 7,000-line route component with 15 section branches. That increases maintenance risk and first-interaction work even though only one section is displayed at a time.
- Animation is widespread but not governed consistently. A global panel-duration/reduced-motion mechanism exists, while many components independently use fixed Tailwind durations.

The architecture does not need a total rewrite. It needs a single navigation authority, a unified persistence contract, truthful profile diagnostics, and a small motion system. These are targeted changes that can be shipped and tested incrementally.

## Priority findings

| Priority | Finding                                                                                         | User impact                                                         | Confidence                                                |
| -------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| P0       | A stale Agent route can overwrite the selected project and tool during project switching        | Returns to Agents instead of Code/Git/Browser; appears intermittent | Confirmed                                                 |
| P0       | Remote settings auto-save is optimistic with no rejection handling or rollback                  | UI can say/show a value that was never saved                        | Confirmed                                                 |
| P1       | Save semantics differ by setting without a visible rule or status                               | Users cannot know whether a change is saved                         | Confirmed                                                 |
| P1       | “Stored sites” reports cookie domains only and suppresses inspection errors                     | Profiles appear empty even when they contain other site data        | Confirmed                                                 |
| P1       | Custom browser tabs default resume behavior to off while the standard Browser defaults it to on | Inconsistent restoration between visually similar tools             | Confirmed                                                 |
| P1       | Settings route is monolithic and eagerly imports many section dependencies                      | Slower initial interaction and high regression surface              | Confirmed structurally; profiling required for exact cost |
| P2       | Motion durations are partly configurable and partly hard-coded                                  | Transitions feel inconsistent; reduced-motion behavior is uneven    | Confirmed                                                 |
| P2       | Several async settings/profile operations swallow errors                                        | “Empty” and “failed to load” are presented as the same state        | Confirmed                                                 |

## 1. Per-project tool memory

### Intended behavior

The store owns an `activeToolIdByProjectId` map. Selecting a tool writes only the chosen project’s entry, project synchronization preserves valid entries, and the persisted store includes the entire session.[^4] Existing unit tests verify that one project can retain Git while another retains Browser. The underlying data model is therefore appropriate.

### Confirmed failure sequence

1. Project A is open on an Agent thread, so the URL contains A’s environment and thread IDs.
2. Project B previously used Code or Git.
3. Clicking Project B calls `openProject(B)` immediately.
4. The shell re-renders before `navigate({ to: "/" })` has cleared A’s thread URL.
5. `routeProjectId` is still derived from A’s active thread.
6. The route synchronization effect sees that A differs from the newly active B, calls `setActiveProject(A)`, and unconditionally calls `setActiveTool(A, "agents")`.[^1]
7. Timing determines which update is visible last. This is why the behavior is inconsistent rather than permanently broken.

There is a second product-level ambiguity: a thread URL and the tab strip both currently claim authority over active project/tool state. As long as those writes can occur independently, similar races can return.

### Recommended correction

Create one `activateProjectSurface` coordinator and make tab clicks, keyboard tab switching, recent-project selection, file search, and deep links use it.

For a normal project-tab switch:

1. Read the destination project’s remembered tool and validate that it is still visible.
2. If the destination is Agents and has a remembered thread, navigate to that thread.
3. Otherwise clear the stale thread route by navigating to `/`.
4. Commit the active project and remembered tool as one store action.

The route synchronization effect should only hydrate store state for a deliberate deep link or browser-history navigation. It must not override a project switch while a conflicting foreground navigation is pending. TanStack Router exposes foreground `status`, requested `location`, and settled `resolvedLocation`, specifically allowing the application to distinguish requested navigation from the previous presentation.[^5]

A minimal patch can add a navigation-intent guard, but the production-safe change is the atomic coordinator plus an integration test. Do not change the default tool globally to work around this; that would hide rather than fix the race.

### Required regression tests

- A/Agents thread → B/Code → A restores Agents → B restores Code.
- A/Agents thread → B/Git does not reactivate A during the transition.
- A/Code → B/Agents remembered thread → A restores Code.
- Keyboard tab cycling and mouse tab clicks produce identical results.
- Closing the active tab restores the fallback project’s remembered tool.
- Hidden or deleted custom tools fall back deterministically to the first visible built-in tool.
- Browser back/forward to a thread is still allowed to activate the thread’s project and Agents tool.

## 2. Settings persistence and save semantics

### Current behavior

Settings has at least three persistence models:

1. **Immediate local save:** client-only settings write directly to local storage.
2. **Immediate remote save:** server settings optimistically patch the query cache, fire an RPC, and refresh after success.
3. **Draft plus explicit Save:** compound settings such as browser URL/isolation, custom browser tabs, and animation presets remain local until Save is pressed.

This can be a sound model, but the interface does not communicate which model applies. For example, the panel-animation slider persists on every input event, while the animation style/palette is only committed by “Save Settings.” The full-screen preview button also commits the animation draft before previewing it, which makes “Preview” carry an unexpected save side effect.[^6]

More seriously, remote auto-save has no `.catch`, rollback, or error state. A rejected RPC leaves the optimistic value visible until another refresh, and may produce only an unhandled promise rejection.[^7]

### Recommended contract

- Auto-save atomic controls: toggles, segmented controls, selects, and short sliders.
- Use a 300–500 ms debounce for sliders and text-like controls to avoid write storms.
- Use explicit Apply/Save for multi-field drafts where values must remain internally consistent.
- Preview must preview; it should not silently save.
- Show one shared header status: `Saving…`, `Saved`, or `Couldn’t save — Retry`.
- On remote failure, either roll back to the confirmed value or retain the draft with a clear unsaved/error indicator.
- Prevent stale responses from overwriting newer changes by assigning a mutation sequence number per setting group.
- Flush debounced changes on blur and before window close.

This provides reliable auto-save without adding a Save button to every preference.

## 3. Browser “Resume last visited page” defaults

The standard Browser is already correct: its schema default is `true`, and the project settings draft also falls back to `true`.[^2] No change is required there.

Custom browser tabs are inconsistent:

- The contract decodes a missing `resumeLastVisitedPage` as `false`.
- The settings editor maps a missing value to `false`.
- A newly created custom browser tab explicitly sets the value to `false`.[^8]

### Recommended change

- Change the custom browser-tab decoding default and new-draft default to `true`.
- Preserve an existing explicit `false`; do not globally overwrite user choices.
- Add a one-time migration only for records where the property is genuinely absent.
- Rename the setting to “Reopen where I left off” if user testing shows that wording is clearer.
- Add tests for the main Browser, newly created custom tabs, legacy missing fields, and explicit opt-out.

## 4. Browser Profiles and stored-site visibility

### What works

Named profiles consistently use `persist:tabs-browser:profile:<id>`. Electron documents that a `persist:` partition is stored on disk and shared by pages using the same partition.[^9] The profile login window and inspector derive the same partition, so this is not primarily a partition-name mismatch.

### Why profiles can appear empty

`getProfileDomains` calls `session.cookies.get({})` and builds its list solely from cookie domains.[^3] Consequently:

- A site with local storage or IndexedDB but no cookie is invisible.
- A site whose cookies expired or were partitioned/blocked is invisible.
- Browsing a site without storage is invisible.
- Passwords and passkeys are intentionally unavailable.
- Any bridge/session inspection failure is caught and displayed as an empty array, producing the same “No cookies or stored sites” result as a genuinely empty profile.

The current label “Stored sites” therefore overpromises. Electron exposes methods to clear multiple storage types and to retrieve the session storage path, but its documented Session API does not provide one simple method that enumerates every origin across cookies, local storage, IndexedDB, cache, and service workers.[^9]

### Recommended product behavior

Immediate truthful fix:

- Rename the section to **Cookie domains**.
- Change empty copy to “No cookie domains detected.”
- Add separate states for Loading, Empty, and Inspection failed, with Retry.
- Display the partition ID and whether Electron reports it as persistent.
- Show last refresh time and cookie count.

Enhanced inspection:

- Track top-level origins visited through Tabs for each profile in a small profile metadata store.
- Merge that origin history with cookie-domain results.
- Label each row accurately: `Visited`, `Cookies`, and, only when verifiable, `Likely signed in`.
- Never claim that a cookie proves authentication; the existing warning correctly avoids this.
- If deeper storage inspection is added, use Chromium DevTools Protocol per known origin rather than parsing Chromium database files directly.

This produces a useful profile inventory without pretending Electron can reliably infer every login.

## 5. Settings architecture and loading performance

`_chat.settings.tsx` currently contains approximately 7,370 lines, 15 major section branches, provider management, theme editing, animation previews, and multiple dialogs. Browser workspace settings and Browser Profiles add roughly another 3,600 lines. Only the active branch is mounted, but the route module and its dependency graph still have to be parsed/evaluated, and every edit carries a broad regression surface.[^10]

TanStack Router supports route-level code splitting, intent preloading, pending components, and loader/dependency separation. Intent preloading only begins for `Link` hover/focus/touch by default; imperative button navigation does not automatically gain the same hover behavior unless it is explicitly preloaded or represented as a Link.[^11]

### Recommended decomposition

- Keep `/settings` as the stable shell and navigation frame.
- Move each settings section to its own lazy component.
- Lazy-load especially heavy sections: Themes, Animations, Providers, Diagnostics, Documentation, Keybindings, and Browser Profiles.
- Preload a section on sidebar hover/focus and show a lightweight section skeleton while it loads.
- Move provider cards and animation editors out of the route component.
- Keep shared state in focused hooks rather than one route-level component.
- Measure route module evaluation, first Settings paint, section switch duration, and long tasks before and after splitting.

Do not add artificial minimum loading durations. A transition should be visible when work exists and disappear immediately when the destination is ready.

## 6. Motion and interaction polish

The codebase contains more than 250 fixed transition/animation declarations. A centralized panel animation setting exists, but many surfaces use fixed values such as 150, 200, or 300 ms. This makes animation preference partly effective rather than authoritative.[^12]

### Motion system recommendation

Use four semantic tokens:

| Token      | Suggested duration | Use                                 |
| ---------- | -----------------: | ----------------------------------- |
| Instant    |            0–80 ms | Pressed/hover feedback              |
| Fast       |         120–160 ms | Menus, tooltips, small controls     |
| Standard   |         180–240 ms | Panels and settings-section changes |
| Deliberate |         280–360 ms | Full-surface entry/exit             |

Rules:

- Animate opacity and transform; avoid animating layout dimensions where possible.
- Keep travel short (approximately 4–12 px) for application surfaces.
- Never delay input readiness to finish decoration.
- Use skeletons for stable content geometry and spinners for indeterminate actions without a predictable layout.
- Honor both the app’s reduced-motion preference and the operating system’s `prefers-reduced-motion` setting. MDN recommends using that media feature to reduce non-essential motion for users who request it.[^13]
- Do not add animation to every element. Motion should explain hierarchy, causality, or loading state.

### High-value locations

- Project/tool switches: immediate selected state plus a short content crossfade.
- Settings section switches: 150–220 ms fade/4 px translation, with lazy-section skeleton when required.
- Empty → loaded lists: preserve container geometry and fade rows in once.
- Profile refresh/import: explicit progress and success/error state.
- Save status: subtle state transition in a stable header position.

## 7. Additional production-readiness observations

### Error-state integrity

Multiple settings and profile code paths use empty catches or convert failures to empty arrays. Before production, every user-triggered async action should resolve to success, actionable error, or cancellation. Logging alone is insufficient when the visible result can be mistaken for valid empty data.

### Test coverage gap

The store has strong isolated tests for per-project values, but the confirmed defect occurs between the router and store. Add integration tests around `WorkspaceShell` navigation, not more store-only tests. Likewise, Browser Profiles tests currently validate cookie mapping and data clearing but should cover bridge failure and distinguish it from an empty profile.

### Accessibility

Loading and saving states should use stable live regions without repeatedly announcing animation frames. Focus should move to the Settings page heading after navigation, return predictably when dialogs close, and remain visible during keyboard interaction. Reduced motion must affect new page transitions as well as existing panel helpers.

### Performance budget

Adopt measurable budgets instead of judging smoothness only by feel:

- Project/tool click feedback: next frame, under 100 ms.
- Previously loaded surface visible: under 200 ms.
- First Settings shell paint: under 300 ms on the target low-performance Mac.
- No UI-thread task over 50 ms during ordinary project/tool switching.
- Profile inspection should never block the renderer; results should stream or settle independently per profile.

## Recommended delivery sequence

### Phase 1 — correctness blockers

1. Fix the router/store project-switch race with a single activation coordinator.
2. Add router-plus-store integration tests covering Agent URLs and non-Agent destination tools.
3. Add remote settings failure handling, rollback/retry, and a shared save status.
4. Stop converting Browser Profile inspection errors into empty profiles.

### Phase 2 — consistent behavior

1. Default new custom browser tabs to resume their last page while preserving explicit opt-outs.
2. Standardize auto-save versus explicit Apply semantics.
3. Separate Preview from Save in Animations.
4. Rename and improve the Browser Profile site-data presentation.

### Phase 3 — performance and polish

1. Split Settings by section and preload likely destinations.
2. Introduce semantic motion tokens tied to the existing duration and reduced-motion settings.
3. Add focused content transitions only to project/tool switches, settings sections, and asynchronous result lists.
4. Profile on the intended low-performance baseline and enforce the interaction budgets.

## Release acceptance checklist

- Each project always restores its last valid tool across mouse switching, keyboard switching, restart, deep linking, and back/forward navigation.
- No setting can visually claim success after persistence failed.
- Every preference clearly communicates whether it saves immediately or requires Apply.
- New standard and custom browser tabs reopen the last page by default; explicit opt-out persists.
- Browser Profiles distinguish loading, empty, and failed inspection.
- Browser Profiles describe cookie-derived data truthfully.
- Settings sections load independently and do not mount heavyweight inactive editors.
- All surface transitions obey reduced-motion settings.
- No decorative animation delays navigation or blocks interaction.
- Integration tests cover router/store coordination and settings persistence failure.

## Sources

[^1]: Tabs source, `apps/web/src/components/WorkspaceShell.tsx`, route synchronization at lines 10851–10875 and project focus at lines 11028–11060 (local repository, inspected 2026-09-14).

[^2]: Tabs source, `packages/contracts/src/settings.ts`, `ProjectBrowserSettings` at lines 1406–1414; `apps/web/src/components/ProjectWorkspaceSettingsSection.tsx`, Browser draft fallback around lines 600–620 (local repository, inspected 2026-09-14).

[^3]: Tabs source, `apps/desktop/src/browserHostManager.ts`, `getProfileDomains` at lines 735–790; `apps/web/src/components/settings/BrowserProfilesSettings.tsx`, inspection error handling and empty state (local repository, inspected 2026-09-14).

[^4]: Tabs source, `apps/web/src/workspaceShellStore.ts`, `activeToolIdByProjectId`, `setActiveTool`, synchronization, persistence partialization, and `apps/web/src/workspaceShellStore.test.ts` per-project isolation tests (local repository, inspected 2026-09-14).

[^5]: TanStack, “[RouterState type](https://tanstack.com/router/latest/docs/api/router/RouterStateType),” accessed 2026-09-14.

[^6]: Tabs source, `apps/web/src/routes/_chat.settings.tsx`, panel animation and animation editor/save behavior around lines 3647–3725 and 5010–5635 (local repository, inspected 2026-09-14).

[^7]: Tabs source, `apps/web/src/hooks/useSettings.ts`, `useUpdateSettings` at lines 181–210 (local repository, inspected 2026-09-14).

[^8]: Tabs source, `packages/contracts/src/settings.ts`, `ProjectCustomEmbedDefinition` at lines 1382–1392; `apps/web/src/components/ProjectWorkspaceSettingsSection.tsx`, custom embed decoding and creation around lines 439 and 1492 (local repository, inspected 2026-09-14).

[^9]: Electron, “[session](https://www.electronjs.org/docs/latest/api/session),” persistent partitions and Session storage APIs, accessed 2026-09-14.

[^10]: Tabs source, `apps/web/src/routes/_chat.settings.tsx`, `apps/web/src/components/ProjectWorkspaceSettingsSection.tsx`, and `apps/web/src/components/settings/BrowserProfilesSettings.tsx` (local repository, inspected 2026-09-14).

[^11]: TanStack, “[Preloading](https://tanstack.com/router/latest/docs/guide/preloading)” and “[Code Splitting](https://tanstack.com/router/latest/docs/guide/code-splitting),” accessed 2026-09-14.

[^12]: Tabs source, `apps/web/src/panelAnimations.ts` and fixed transition declarations under `apps/web/src/components` and `apps/web/src/routes` (local repository, inspected 2026-09-14).

[^13]: MDN, “[Using media queries for accessibility](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Using_for_accessibility),” accessed 2026-09-14.
