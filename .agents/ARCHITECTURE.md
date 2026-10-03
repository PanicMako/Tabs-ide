# Tabs IDE Architecture and Context

This document provides a comprehensive overview of the Tabs IDE application architecture to help agents quickly understand the codebase. Future agents should keep this document updated as the system evolves.

## High-Level Architecture

Tabs IDE is a minimal web GUI and desktop application for using coding agents (like Codex and Claude). It is built as a **Turborepo monorepo** managed by **Bun**, featuring a strict separation between the client-side UI, the backend server, and shared contracts.

### Monorepo Structure

The repository is divided into `apps/` (runnable applications) and `packages/` (shared libraries).

#### Applications (`apps/`)

- **`apps/web`**: The main frontend React application.
  - **Stack**: React, Vite, Tailwind CSS, Zustand (state management).
  - **Role**: Renders the session UX, workspace shell, conversation/event streams, and embedded browser views. It connects to the local server via WebSocket.
  - **Key Components**: `WorkspaceShell` (the main IDE layout), `DesktopBrowserTool` (embedded browser for webviews), terminal emulators, and chat interfaces.

- **`apps/server`**: The backend Node.js WebSocket server.
  - **Role**: Wraps the Codex app-server (via JSON-RPC over stdio), serves the compiled React web app locally, and manages provider sessions.
  - **Tech**: Node.js, WebSockets, `effect` library for robust async and error handling.

- **`apps/desktop`**: The Electron application wrapper.
  - **Role**: Packages the `server` and `web` apps into a native desktop experience and hosts the Code-OSS desktop workbench. Manages native OS integrations, project-scoped editor views, system menus, and file system access.

- **`apps/marketing`**: The public-facing landing page/website.

#### Shared Packages (`packages/`)

- **`packages/contracts`**: The single source of truth for types and schemas.
  - **Role**: Contains `effect/Schema` definitions and TypeScript contracts for provider events, WebSocket protocols, and model/session types.
  - **Rule**: _Keep this package schema-only — absolutely no runtime logic._

- **`packages/shared`**: Shared runtime utilities.
  - **Role**: Consumed by both server and client applications (e.g., git utilities).
  - **Rule**: Uses explicit subpath exports (e.g., `@t3tools/shared/git`) — no barrel index (`index.ts`).

- **`packages/client-runtime`**: Shared frontend logic.
  - **Role**: Shared runtime code specifically for clients (e.g., sharing React hooks or API clients across web and mobile/desktop).

- **`packages/effect-acp` & `packages/effect-codex-app-server`**:
  - **Role**: Integrations with the Agent Communication Protocol (ACP) and Codex app servers, heavily utilizing the `effect` ecosystem for functional programming patterns.

## Core Technologies

- **Package Manager**: Bun (`bun install`, `bun run dev:desktop`)
- **Build System**: Turborepo (`turbo.json`)
- **Frontend**: React, Vite, Zustand (Store)
- **Backend**: Node.js, Electron (Desktop)
- **Functional Core**: `effect` (Effect-TS) is used extensively in backend and shared packages for schema validation, dependency injection, and concurrency.

## Core Engineering Principles

1. **Performance & Reliability First**: Keep behavior predictable under load and during failures (e.g., session restarts, reconnects, partial streaming). Choose correctness and robustness over short-term convenience.
2. **Shared Logic**: Extract duplicate logic into `packages/shared` or `packages/client-runtime`. Don't take shortcuts by adding local logic if it belongs in a shared module.
3. **No Native UI**: Do not use native browser popups (`window.confirm`, `window.alert`, `window.prompt`). Always use custom UI components like the `useConfirm` hook.
4. **Testing**: Maintain test suite correctness using `vitest` (`bun run test`). Do not leave failing tests.

## Local Development Flow

- Start the desktop app: `bun run dev:desktop`
- The `dev-runner.ts` script orchestrates Turborepo to start the Vite dev server (`apps/web`), the backend WebSocket server (`apps/server`), and the Electron host (`apps/desktop`).

_Note to Agents: When architectural changes are made (e.g., new packages, major state management shifts), you MUST update this file to ensure future agents have accurate context._

## Native Code-OSS Embedding

The desktop app has one Code-OSS runtime path: the compiled Electron desktop renderer loaded from
`tabs-code-oss` over `vscode-file://`. There is no Remote Extension Host web server, served
workbench URL, loopback editor port, or `vscode-remote` filesystem transport.

The Tabs React workspace remains the top-level Electron window and owns the project tabs, tool
toolbar (`Code`, `Agents`, `Server`, provider tools, `Git`, and `Browser`), settings, and other
platform chrome. Code-OSS is not a replacement top-level window: selecting the `Code` tool mounts
the active project's native Code-OSS `WebContentsView` inside the Code surface, and leaving the tool
hides that view while preserving its project session.

- `apps/desktop/src/nativeCodeHostMain.ts` is the Tabs-owned boundary to compiled Code-OSS main
  process modules. It constructs the Electron IPC server and registers extension-host starter,
  local filesystem, utility-process worker, local PTY, external-terminal, workspace, menubar,
  webview, and native MCP discovery channels.
- The extension host and PTY host are Electron utility processes. Code-OSS transfers their
  `MessagePort` connections through Electron IPC, matching the native desktop architecture.
- `apps/desktop/src/codeHostManager.ts` owns the Code-tool per-project sessions: a persistent Electron partition,
  `WebContentsView`, workspace file URI, profile/state roots, configuration IPC channel, bounds/focus,
  recreation, storage flush, and disposal. Each view is registered with the native main backend so
  its extension host can be addressed by webContents ID.
- `Schemas.file` operations use the renderer's `DiskFileSystemProvider` backed by the main-process
  `localFilesystem` channel. They do not pass through the Tabs WebSocket backend.
- `TABS_CODE_OSS_BUILD_DIR` can override runtime discovery with a compiled `tabs-code-oss` root.
  Runtime selection does not support HTTP entries or a web-server fallback.
- **Packaged App Runtime Packaging**: Production desktop installers (`.dmg`, `.exe`, `.AppImage`) are
  self-contained fat bundles containing `tabs-code-oss` inside `Resources/tabs-code-oss` (macOS) or
  `resources/tabs-code-oss` (Linux/Windows). Standard releases never ship as thin installers requiring
  on-demand downloads.
- **Development Resolution**: In local development (`bun run dev:desktop`), the Code-OSS runtime always
  resolves from the sibling `tabs-code-oss` checkout (or `TABS_CODE_OSS_BUILD_DIR`). It never triggers
  on-demand downloads from GitHub release assets. Required compiled assets are `preload.js`,
  `workbench-dev.html`, `nls.messages.json`, and `product.json`.

## Testing Workspace Architecture

Testing is a project-scoped feature spanning the shared contracts, local server, React workspace,
Electron browser host, and built-in Code workbench integration.

- `packages/contracts/src/testing.ts` and `packages/contracts/src/ws.ts` define the Testing API and
  long-running operation inputs. All calls carry the top-level Tabs project ID.
- `apps/server/src/testing/` owns the additive SQLite schema, sanitized accessibility capture,
  Locator Library, page-object artifacts, workbook/story reconciliation, generation, execution,
  healing, and reporting. The Locator Library is canonical; generated Playwright page objects are
  immutable derived artifacts linked to exact locator versions.
- `apps/web/src/components/WorkspaceShell.tsx` hosts the Testing workflow. Locator-first is the
  default when no explicit project preference exists and the server flag is enabled. Classic
  discovery remains available under Advanced and is the kill-switch fallback.
- Desktop Testing preview sessions reuse the project-isolated Electron browser host partition via
  a dedicated `testing:<projectId>` session ID. Browser-only clients fall back to an iframe and the
  server-managed Playwright path where framing is unavailable.
- `apps/server/src/testing/testInventory.ts` statically indexes Playwright test files without
  executing repository code. The built-in `tabs-workbench-integration` extension observes VS Code
  `TestItem` state when that proposed API is available; live editor state takes precedence in the
  merged inventory.

Captured URLs, accessibility names, semantic context, generated code, prompts, and logs cross the
Testing sanitization boundary before persistence. Authentication cookies and credentials remain in
the project-scoped browser profile and are not written to Testing records.
