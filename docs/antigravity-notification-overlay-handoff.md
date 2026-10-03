# Notification Overlay Architecture & Implementation Handoff

## Executive Summary

Tabs uses Electron native `WebContentsView` child views to host Code-OSS (`CodeHostManager`), Browser (`BrowserHostManager`), Testing widgets, and custom embedded browsers. Because WebContentsViews composite natively above any HTML elements rendered in the primary React renderer, standard CSS `z-index` cannot place HTML notifications above native code or web surfaces.

Previously, a workaround in `apps/web/src/nativeSurfaceOverlay.ts` classified toast elements as blocking overlays. Whenever a toast was displayed, MutationObservers triggered `hideCodeSession()`, `hideBrowserSession()`, or detached native views. This caused:

- Black or blank editor/browser views during notifications.
- Interrupted loading/navigation in Code-OSS and Browser tabs.
- Loss of focus and scroll state.
- Potential race conditions between React DOM updates and native session lifecycle.

We have designed, implemented, and validated a dedicated **topmost notification overlay `WebContentsView`** managed by the Electron main process, backed by a unified `NativeViewStackCoordinator`. Notifications render above all native surfaces without detaching, hiding, or interrupting active Code or Browser sessions.

---

## Architecture & Lifecycle

### 1. Unified Native View Stacking Coordinator

- **Location:** `apps/desktop/src/nativeViewStackCoordinator.ts`
- **Responsibilities:**
  - Coordinates tool views and automation/transient views attached to the main window, while keeping the notification view last (topmost) in `window.contentView.children`.
  - Code and Browser managers retain direct attachment fallbacks for tests or callers that do not inject the coordinator. Picture-in-picture views belong to separate windows and are intentionally outside this main-window stack.
  - Automatically re-asserts the notification overlay to the topmost index whenever a tool or modal surface is attached or activated (`contentView.addChildView(view)` without second argument reorders existing views to topmost in Electron 44).

### 2. Dedicated Notification Overlay Manager

- **Location:** `apps/desktop/src/notificationOverlayManager.ts`
- **Responsibilities:**
  - Lazily creates one overlay `WebContentsView` for the main application window when the first notification appears. Popout windows retain the DOM toast renderer.
  - Configures a transparent background (`#00000000`).
  - Strict security: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, using an isolated preload bridge (`apps/desktop/src/notificationPreload.ts`).
  - Does not focus the view for passive notifications. Interactive actions, dismissal, and Copy restore the renderer or native tool surface that most recently owned focus.
  - Subscribes to window resize, zoom factor changes, and close lifecycle events.
  - Slices measured toast stack bounds and sets overlay view bounds clamped to the window, respecting titlebar window controls (`TOP_OFFSET = 56`, `MARGIN_RIGHT = 16`). When no notifications are active, view bounds are collapsed to `{ x: 0, y: 0, width: 0, height: 0 }`.
  - Cleans up all listeners and child views upon window close or disposal.

### 3. Lightweight Overlay HTML & Preload Bridge

- **Location:** `apps/desktop/resources/notification-overlay.html`, `apps/desktop/src/notificationPreload.ts`
- **Features:**
  - Self-contained, lightweight DOM and CSS (dark and light themes via CSS custom properties, matching Tabs theme tokens).
  - Dynamic stacking and animation with `prefers-reduced-motion` compliance.
  - Accessible semantics: `role="status"` for info/loading/success, `role="alert"` for error/warning, `aria-live="polite"`.
  - Interactive actions (e.g. Retry, Copy, Dismiss) with keyboard focus management and Esc key dismissal.
  - `ResizeObserver` measures exact DOM bounding box and dispatches `{ width, height }` via IPC to the main process.
  - No access to filesystem, shell, tokens, cookies, or arbitrary IPC capabilities in the overlay renderer.

### 4. Typed IPC Protocol

- **Location:** `packages/contracts/src/notificationOverlay.ts`, `packages/contracts/src/ipc.ts`
- **Channels & Contracts:**
  - `syncNotificationOverlay(toasts: readonly NotificationToastPayload[])`: Synchronizes the bounded notification stack. Theme is synchronized separately by the main process, zoom follows the main renderer, and reduced-motion is handled by the overlay stylesheet.
  - `onNotificationOverlayAction(handler: (toastId: string, actionId: string) => void)`: Dispatches user clicks on toast action buttons back to the primary renderer.
  - `onNotificationOverlayDismiss(handler: (toastId: string) => void)`: Dispatches dismissals back to the primary renderer.

### 5. Web Toast Adapter & Workaround Removal

- **Location:** `apps/web/src/components/ui/notificationOverlayAdapter.ts`, `apps/web/src/components/ui/toast.tsx`, `apps/web/src/nativeSurfaceOverlay.ts`
- **Key Changes:**
  - `useNotificationOverlayAdapter`: Subscribes to the existing `toastManager` store. When running under Electron (`window.desktopBridge.syncNotificationOverlay`), toasts are serialized and forwarded via typed IPC. Action and dismiss callbacks invoke the existing `toast.action.onClick()` and `toastManager.dismiss()`.
  - In-DOM Fallback: When `desktopBridge` is not present (browser dev/test environments), toasts render directly into the DOM as before.
  - **Removed Detach Workaround:**
    - Removed `[data-slot='toast-root']`, `[data-slot='toast-popup']`, and `[data-slot='toast-action']` from `BLOCKING_NATIVE_SURFACE_OVERLAY_SELECTORS` in `apps/web/src/nativeSurfaceOverlay.ts`.
    - Consolidated duplicate MutationObserver boilerplate across `WorkspaceShell.tsx` (CodeHost, BrowserHost, CustomBrowser) into a reusable `useNativeSurfaceOverlaySuspension` hook.
    - Dialogs, popups, and genuine blocking overlays remain fully functional without affecting passive or interactive toasts.

---

## Old Detach / Hide Paths Removed

1. **`apps/web/src/nativeSurfaceOverlay.ts`**:
   - Removed all toast selector patterns (`[data-slot='toast-root']`, `[data-slot='toast-popup']`, `[data-slot='toast-action']`).
   - Active toasts no longer match `hasBlockingNativeSurfaceOverlay()` and will NEVER trigger suspension of native surfaces.
2. **`apps/web/src/components/WorkspaceShell.tsx`**:
   - Replaced multiple independent MutationObserver implementations that previously called `hideCodeSession()` and `hideBrowserSession()` with a single consolidated `useNativeSurfaceOverlaySuspension` hook that ignores toasts.
3. **`apps/desktop/src/codeHostManager.ts` & `browserHostManager.ts`**:

- Main-window Code and Browser attachment paths delegate to `attachToolView` or `attachAutomationView`; direct calls remain as intentional fallbacks when no coordinator is supplied.

---

## Corrections to the Diagnostic Report

1. **`setIgnoreMouseEvents` on Electron 44.1.0:**
   - _Diagnostic report hypothesis:_ Suggested exploring full-window transparent overlays using `setIgnoreMouseEvents({ forward: true })` on the overlay `WebContentsView`.
   - _Correction / Reality:_ In Electron 44.1.0, `setIgnoreMouseEvents` is implemented strictly on `BaseWindow` / `BrowserWindow`, **NOT** on `WebContentsView` or `View`. Calling it on a `WebContentsView` results in a runtime TypeError.
   - _Resolution:_ Implemented the preferred, robust measured rectangular bounds design. The overlay `WebContentsView` is sized strictly to the bounding box reported by `ResizeObserver` inside the overlay HTML (with bounds clamped to the window and empty `{ width: 0, height: 0 }` when no toasts are visible). This guarantees zero pointer interception outside the toast stack.

2. **Stack Reordering API:**
   - In Electron 44.1.0, re-adding an existing child via `contentView.addChildView(view)` moves it to the top of `contentView.children`. The `NativeViewStackCoordinator` uses this property reliably to guarantee that the notification overlay view remains at the highest index whenever any tool or modal surface is activated.

---

## Validation & Test Results

### 1. Automated Test Suites

- **`packages/contracts`**:
  - Command: `bun run --cwd packages/contracts test`
  - Result: 34 files passed, 471 tests passed (0 failures).
- **`apps/desktop`**:
  - Command: `bun run --cwd apps/desktop test`
  - Result after Codex review: 39 files passed, 351 tests passed (0 failures).
  - Includes focused coverage for native stacking, focus restoration, payload validation, overlay bounds/lifecycle, and the original 18 integration scenarios.
- **`apps/web`**:
  - Command: `bun run --cwd apps/web test`
  - Result after Codex review: 176 files passed, 1301 tests passed (0 failures).
- **`apps/web build`**:
  - Command: `bun run --cwd apps/web build`
  - Result: Production bundle completed successfully.
- **`vp check` & `vp run typecheck`**:
  - `vp check`: 0 errors in 1815 linted files (pre-existing warnings remain).
  - `vp run typecheck`: 12 packages typechecked successfully with 0 errors.

### 2. Desktop bundle verification

- `bun run --cwd apps/desktop build` produced the main, primary preload, and isolated notification preload bundles.
- `node apps/desktop/scripts/smoke-test.mjs` passed. The temporary CDP verifier referenced by the original handoff was not present in the authoritative worktree during Codex review, so its claims are not counted as current verification evidence.

---

## Known Limitations & Considerations

1. **Titlebar Overlap Guard:**
   - To avoid overlapping the macOS window traffic lights and custom title bar controls, the overlay stack currently uses a fixed top offset (`56px`). A future dynamic-titlebar implementation would need an explicit contract change.
2. **Multiple Displays / Mixed DPI:**
   - Electron converts DIP bounds automatically on macOS/Windows. Window zoom factor changes are subscribed to and handled cleanly.
