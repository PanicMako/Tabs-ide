# Moved Projects, Code-OSS Paths, and Native Notification Diagnostics

## Executive assessment

The observed failures come from three independent defects that amplify one another:

1. **The native Code-OSS window configuration supplies a percent-encoded URI pathname as an already-decoded URI component.** A folder named `Flat Adventure Background` consequently becomes the literal filesystem path `Flat%20Adventure%20Background` inside Code-OSS. The screenshots and native log confirm this exact conversion.[^1]
2. **The Code host silently relocates missing workspaces by basename.** When the saved project path in Downloads disappeared, the Code host searched nearby roots, found a same-named folder on Desktop, and opened it without updating the project record or asking for confirmation.[^2]
3. **Every application toast deliberately detaches the active native Code/Browser surface.** This makes the toast visible, but replaces the embedded application with a blank host background until the toast is dismissed. CSS `z-index` cannot solve the underlying native-view stacking problem.[^3]

The “folder contains only images” hypothesis is not supported as the primary cause. Code-OSS was given an invalid, encoded filesystem path before it attempted to enumerate or preview the folder. A secondary issue does exist: the default-file heuristic selects the first non-hidden file regardless of format, and the captured session selected an EPS file automatically.[^4]

No production code was changed during this investigation.

## Evidence summary

| Observation                                                        | Direct evidence                | Finding                                                            |
| ------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------ |
| Explorer shows `Flat%20Adventure%20Background`                     | Screenshot 1                   | URI encoding has leaked into the displayed filesystem name         |
| Editor says the encoded name was not found                         | Screenshot 2 and Code host log | Code-OSS is resolving `%20` literally instead of resolving spaces  |
| Finder shows a real folder with spaces and files                   | Screenshot 3                   | The underlying folder exists; the encoded path does not            |
| Project missing toast appears while Code content is black          | Screenshot 4                   | Host toast visibility is coupled to detaching the native Code view |
| Saved path was Downloads; resolved path became Desktop             | Code host log at 14:45:33      | Silent same-basename recovery changed the effective workspace      |
| Workbench reports `/Desktop/Flat%20Adventure%20Background` missing | Code host log at 14:45:38      | Encoded URI pathname was interpreted as a literal native path      |

## 1. Percent-encoded workspace path

### Confirmed runtime sequence

The Code host received the correct path with ordinary spaces:

```text
2026-09-14T14:45:33.106Z ensureSession requested
workspaceRoot=/Users/rushil.dev/Downloads/Flat Adventure Background
```

Its relocation logic selected the Desktop folder:

```text
2026-09-14T14:45:33.111Z resolved workspace root
/Users/rushil.dev/Desktop/Flat Adventure Background
```

The workbench URL correctly encoded that value as a URL query parameter:

```text
tabs_workspaceRoot=%2FUsers%2Frushil.dev%2FDesktop%2FFlat+Adventure+Background
```

Encoding a query parameter is normal. The failure occurs in the structured native window configuration. `toFileUriComponent` currently calls `pathToFileURL(pathname)` and assigns `fileUrl.pathname` directly to the URI component’s `path` field:[^5]

```ts
private toFileUriComponent(pathname: string): UriComponent {
  const fileUrl = pathToFileURL(pathname);
  return {
    scheme: "file",
    authority: "",
    path: fileUrl.pathname,
    query: "",
    fragment: "",
  };
}
```

For a filesystem path containing spaces, the WHATWG URL pathname contains `%20`. That is correct when serialized as a URL string, but a VS Code-style URI component object represents already-separated URI components and is later revived as a `URI`. Passing `%20` in the component’s `path` means the percent characters become data rather than escaping syntax.

The same helper is used for:

- `configuration.workspace.uri`
- profile locations
- settings and keybindings resources
- snippets, prompts, extensions, MCP, language models, and cache locations

The workspace is the visible failure because its path contains spaces. The bug potentially affects every structured location containing spaces, `%`, `#`, non-ASCII characters, or platform-specific path syntax.

### Conclusive log evidence

After the structured configuration was resolved, Code-OSS reported:

```text
Unable to resolve nonexistent file
'/Users/rushil.dev/Desktop/Flat%20Adventure%20Background'
```

That exact nonexistent literal path matches the Explorer label and editor dialog. The real Finder path contains spaces. This excludes folder emptiness, permissions, Git detection, and missing image support as the root cause of this particular failure.[^1]

### Why some projects work

Paths without characters requiring URL encoding are unchanged by `pathToFileURL().pathname`. For example, `Downloads/ThrottleClan` works because it contains no spaces. That makes the defect appear project-specific and intermittent even though the conversion is deterministic.

### Recommended correction

Use one canonical URI conversion that respects the boundary between:

- a native filesystem path,
- a serialized file URL, and
- a structured URI component.

Do not manually mix fields from those representations. The safest implementation is to create the structured object through the same URI utility used by the Code-OSS runtime, or to construct platform-correct decoded components and verify them through round-trip tests. Node documents that URL pathnames percent-encode spaces and that `fileURLToPath` performs the corresponding filesystem decoding.[^6]

Required tests should round-trip:

- ordinary spaces,
- `%` in a folder name,
- `#` and `?`,
- Unicode and emoji,
- decomposed versus composed Unicode on macOS,
- Windows drive letters,
- Windows UNC shares,
- Linux paths,
- profile/settings paths as well as workspace paths.

The test must validate the URI object revived by the actual Code-OSS URI library, not merely compare a generated string.

## 2. Silent workspace relocation

### Confirmed behavior

`resolveWorkspaceRootForSession` does more than validate the requested path. If it is missing, the function extracts its basename, builds a set of candidate roots, scans child directories, and returns the first directory with the same basename.[^7]

For the reported project:

```text
Saved Tabs project path:
/Users/rushil.dev/Downloads/Flat Adventure Background

Silently selected Code workspace:
/Users/rushil.dev/Desktop/Flat Adventure Background
```

The log proves that this was an intentional result of the resolver rather than macOS redirecting the old path.[^2]

### Why the behavior is unsafe

A basename is not a stable project identity. Two unrelated folders can share names such as `app`, `website`, `project`, or `src`. Silent selection can therefore open the wrong code, expose the wrong repository to tools, run commands in an unintended directory, or associate saved editor state with a different project.

It also creates split-brain state:

- The server/read model still says the project is in Downloads.
- Code-OSS operates on Desktop.
- Agents, terminals, Git, Browser presets, and file APIs may continue using the old Downloads path.
- The UI may later delete the project as missing even while Code-OSS appears to have recovered it.

This explains why a moved project can appear to continue working temporarily and later collapse into an unavailable or removed state.

### Recommended lifecycle

When the canonical folder is missing, Tabs should enter an explicit `workspace_missing` state. It should not delete or relocate the project automatically.

The recovery surface should show:

- the previous path,
- **Locate Folder…**,
- **Remove Project**, and
- **Keep Unavailable** or **Cancel**.

If a same-named folder is discovered, it may be offered as a suggestion, but the user must confirm it. Confirmed relocation should update the canonical project workspace root through the orchestration model, retain the project ID and settings, invalidate all environment-bound caches, close the old native sessions, and recreate Code/Git/Terminal/Browser state against the new root.

Automatic relocation should only be considered when there is a strong filesystem identity, such as a persisted file identifier/bookmark that can prove it is the same directory. Basename equality is insufficient.

## 3. Missing-project detection and deletion

### Current web behavior

`verifyProjectExists` calls the project filesystem browser and classifies an error as a missing path by searching lowercased error text for phrases such as `enoent`, `no such file`, and `path does not exist`.[^8] On a match, it:

1. displays “Project folder not found,”
2. dispatches `project.delete` without awaiting it,
3. closes the local project tab immediately, and
4. returns `false`.

The periodic verifier only runs while the welcome surface is visible, once immediately and then every 30 seconds. Project focus also invokes verification. The active Code host has a separate resolver and lifecycle.

### Resulting failure modes

- **Inconsistent timing:** a missing active project can remain visible until a focus or welcome-screen check happens.
- **Destructive surprise:** moving a folder causes the project record to be deleted rather than marked unavailable.
- **UI/server race:** the local tab closes before `project.delete` is confirmed.
- **String-classification risk:** an unrelated error containing one of the phrases can be treated as deletion evidence.
- **Split-brain recovery:** Code may silently find a replacement while the web verifier deletes the original project.
- **Stale native surface:** local close and server projection propagate asynchronously before `syncCodeSessions` closes the native session.

### Recommended state machine

Use typed filesystem results rather than parsing human-readable error messages:

```text
available
checking
missing
permission_denied
environment_offline
unknown_error
relocating
```

Only a confirmed `missing` result should offer removal or relocation. Neither action should happen implicitly. The project should remain in the model until the user chooses.

All native managers should consume the same canonical availability state. When a project becomes missing, Code, Browser, terminal, Git, and testing surfaces should be suspended or closed through one coordinated lifecycle operation.

## 4. Image-only and non-code folders

### Primary conclusion

Tabs does not reject this project because it lacks source code. `findDefaultWorkspaceFile` checks a small preferred list and then returns the first non-hidden regular file in the directory, regardless of extension.[^4] Therefore folders containing only assets are accepted.

The captured session chose:

```text
tabs_relativePath=5707837.eps
```

The visible “file not found” error was caused by the encoded workspace root, not by the absence of code files.

### Secondary usability defect

Choosing the first arbitrary file means a binary, very large asset, EPS, AI, archive, or unsupported format can be opened automatically. That can produce another error or an unhelpful binary editor after the path bug is corrected.

Recommended behavior:

- Always open the Explorer for a valid folder.
- Auto-open only a known-safe, size-bounded previewable or text file.
- Prefer README/project manifests, then supported image previews such as PNG/JPEG, then text.
- Do not auto-open EPS, AI, large binaries, archives, or unknown formats.
- If no safe preview exists, leave the editor empty and show the folder normally.
- Treat “folder is valid but contains no previewable file” as a successful workspace, not an error.

Required fixtures should include empty folders, PNG/JPEG-only folders, EPS/AI-only folders, mixed assets, spaces, Unicode, hidden files, and large binaries.

## 5. Notifications versus native Code/Browser surfaces

### Confirmed architecture

Code-OSS and Browser are Electron `WebContentsView` instances attached as native child views. Application notifications are DOM elements rendered by the host React renderer. A native child view is not part of the host renderer’s CSS stacking context, so a large CSS `z-index` cannot guarantee that the host toast appears above it.

The code explicitly acknowledges this and lists every toast root, popup, and action as a native-surface-blocking overlay.[^3] Each Code and Browser tool observes the entire document. When any matching toast exists, it calls:

```text
hideCodeSession()
```

or:

```text
hideBrowserSession()
```

When the toast disappears, the native session is reactivated.

### Why the page goes black until X is pressed

This is the implemented policy, not a random rendering failure. The toast is made visible by removing the underlying native view entirely. The host content behind the view is mostly an empty dark surface, so the application appears not to render until the toast is closed.

The 50 ms MutationObserver debounce introduces an additional race. During that interval, the toast may initially be below the native surface, leaving only a sliver outside the native view’s bounds. Once detected, the entire native view disappears. Toast exit transitions keep the DOM node present until animation completes, extending the blank interval.

The Code host log records `hideActiveSession detach` immediately after workbench activation in the reported sequence, consistent with an overlay-triggered suspension while the missing-project toast was present.[^2]

### Why the current policy is especially risky

`hideActiveSession` stops a pending main-frame navigation when the Code view is still loading. Although the overlay policy tries to wait for `hostReady`, “session activation returned” is not identical to “the entire Code-OSS workbench and extension lifecycle is settled.” A toast during startup can therefore detach or restart the native lifecycle at a sensitive point.

The same observer/policy is duplicated for the default Browser, custom browser tabs, Code, and Testing. Multiple instances can race to hide or reactivate the shared active native manager.

### Correct architectural options

#### Preferred: dedicated native overlay layer

Render global overlays in a separate topmost `WebContentsView` owned by the main process. Electron’s `View.addChildView(view, index)` controls child ordering, and re-adding an existing child raises it to the top.[^9] The overlay view can cover the window, remain visually transparent outside interactive content, and forward only intentional pointer regions.

This allows Code/Browser to remain mounted and visible while notifications appear above them. It requires careful hit testing, accessibility, focus, window resizing, and lifecycle management.

#### Simpler production option: non-overlapping notification region

Place global notifications in permanent application chrome outside all native-surface bounds. For example, reserve a top notification lane beneath the project toolbar and reduce the native content rectangle while the lane is occupied. This is less elegant but substantially safer than detaching the guest.

#### Context-local notifications

For Code-OSS-specific events, use Code-OSS’s own notification service. For Browser-specific status, render within the Browser toolbar region that already sits outside the guest bounds. Global events still need a native overlay or reserved host region.

### Approaches that will not solve it

- increasing toast `z-index`,
- changing React portal placement within the same host renderer,
- polling the DOM more frequently,
- hiding the native view faster,
- adding more MutationObservers,
- extending the toast timeout.

Those approaches do not change native child-view composition.

## 6. Interaction between the three defects

The reported sequence can be reconstructed from the evidence:

1. Tabs retains `/Downloads/Flat Adventure Background` as the canonical project path.
2. The folder is moved to Desktop.
3. The native Code resolver searches by basename and silently selects the Desktop folder.
4. The structured workspace URI represents spaces as literal `%20` path data.
5. Code-OSS shows an encoded Explorer name and cannot resolve the workspace or restored EPS file.
6. Independently, the web verifier checks the canonical Downloads path and classifies it as missing.
7. The verifier displays a toast, dispatches project deletion, and closes the tab.
8. Toast detection detaches the native Code view so the toast can appear above it.
9. The user sees a mostly black Code area until the toast is dismissed.
10. Read-model propagation eventually removes the project ID, after which `syncCodeSessions` destroys the native session.

Every visible symptom in the screenshots follows from this chain without requiring an image-folder restriction.

## 7. Priority and remediation plan

| Priority | Issue                                                             | Reason                                                                    |
| -------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| P0       | Structured file URI components contain encoded path data          | Breaks every workspace/profile path with common characters such as spaces |
| P0       | Toasts detach native surfaces                                     | Produces blank UI and can disrupt native startup/navigation               |
| P0       | Missing folders are silently relocated by basename                | Can open the wrong project and split project state across directories     |
| P1       | Missing projects are automatically deleted                        | Destructive, timing-dependent, and difficult to recover from              |
| P1       | Native managers do not share one workspace availability lifecycle | Leaves stale or contradictory surfaces during moves/removal               |
| P2       | Default file selection opens arbitrary file types                 | Asset-only projects can begin with an unsupported or expensive preview    |

Recommended implementation order:

1. Add failing path round-trip tests and correct structured URI construction.
2. Remove basename-based automatic relocation; introduce explicit missing/relocation state.
3. Stop automatic project deletion and add Locate/Remove/Keep Unavailable actions.
4. Centralize workspace availability and native-session teardown.
5. Replace toast-driven detach with a native overlay or non-overlapping notification region.
6. Restrict default-file auto-open to safe supported formats.

## 8. Required verification matrix

### Paths

- Existing project with plain path.
- Existing project with spaces.
- `%`, `#`, `?`, apostrophe, emoji, and non-Latin names.
- macOS composed and decomposed Unicode.
- Windows drive and UNC paths.
- Symlinked project and resolved real path.

### Folder lifecycle

- Move an open project while Code is active.
- Move a closed/recent project, restart, then open it.
- Two different folders with the same basename.
- Delete a folder, recreate it with different contents, then reopen.
- Remote environment offline versus local path missing.
- Permission denied versus missing.
- Locate the moved folder and confirm every tool uses the updated root.
- Remove the missing project and confirm every native process/session closes.

### Contents

- Empty folder.
- Text-only folder.
- PNG/JPEG-only folder.
- EPS/AI-only folder.
- Mixed source and binary assets.
- Very large first file.

### Notifications

- Passive toast over Code, Browser, custom Browser, and Testing.
- Interactive toast with Retry/Copy action.
- Toast during initial Code startup.
- Toast while Browser is navigating.
- Multiple stacked toasts.
- Toast dismissal without native reload, black frame, focus loss, or scroll loss.
- Menus and dialogs continue to layer correctly.
- Keyboard and screen-reader access across host and native overlay layers.

## 9. Instrumentation recommendations

Keep the existing Code host log but add structured correlation fields:

- project ID,
- canonical requested root,
- effective root,
- relocation reason,
- URI serialized form,
- URI revived `fsPath`,
- native session generation,
- overlay owner and reason,
- attach/detach reason,
- deletion command ID and acknowledgement.

Do not log file contents, credentials, cookie values, or authentication material. Add a diagnostics export that redacts the home-directory prefix while preserving whether paths differ.

## Sources

[^1]: User-provided screenshots 1–3 and `/Users/rushil.dev/.tabs/userdata/code-host-manager.log`, entries from 2026-09-14 14:43:15 through 14:45:45 (local evidence, inspected 2026-09-14).

[^2]: `/Users/rushil.dev/.tabs/userdata/code-host-manager.log`, especially 14:45:33.106–14:45:38.253 and 14:46:37.561–14:46:45.312; Tabs source `apps/desktop/src/codeHostManager.ts`, `resolveWorkspaceRootForSession` and session lifecycle (local evidence, inspected 2026-09-14).

[^3]: Tabs source `apps/web/src/nativeSurfaceOverlay.ts`; `apps/web/src/components/WorkspaceShell.tsx`, Code and Browser overlay observers; `apps/web/src/components/ui/toast.tsx` (local repository, inspected 2026-09-14).

[^4]: Tabs source `apps/desktop/src/codeHostManager.ts`, `findDefaultWorkspaceFile`; Code host log showing `tabs_relativePath=5707837.eps` (local repository and runtime evidence, inspected 2026-09-14).

[^5]: Tabs source `apps/desktop/src/codeHostManager.ts`, `toFileUriComponent` and `buildDesktopWindowConfiguration` (local repository, inspected 2026-09-14).

[^6]: Node.js, “[URL](https://nodejs.org/docs/latest-v20.x/api/url.html),” percent-encoding, `pathToFileURL`, and `fileURLToPath`, accessed 2026-09-14.

[^7]: Tabs source `apps/desktop/src/codeHostManager.ts`, `resolveWorkspaceRootForSession`, lines approximately 775–829 (local repository, inspected 2026-09-14).

[^8]: Tabs source `apps/web/src/components/WorkspaceShell.tsx`, `verifyProjectExists` and recent-project verification around lines 10945–11025 (local repository, inspected 2026-09-14).

[^9]: Electron, “[View](https://www.electronjs.org/docs/latest/api/view),” `addChildView` ordering; “[WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)”; and “[BaseWindow](https://www.electronjs.org/docs/latest/api/base-window),” accessed 2026-09-14.
