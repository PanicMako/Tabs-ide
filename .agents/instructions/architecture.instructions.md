---
name: architecture
description: Comprehensive map of the codebase to give agents structural understanding before modifying files.
---

# Codebase Architecture Blueprint

**WARNING TO AGENT:** You MUST read and understand this blueprint before adding or modifying any logic in the workspace. Failure to understand where a feature belongs will result in broken dependency graphs.

## The Monorepo Structure (tabs-app)

This project is a strict monorepo using Vite, React, Node.js, and Electron. 
The application logic is heavily segmented. You must never mix backend logic into the frontend, or UI logic into the schema contracts.

### 1. `apps/web` (The Frontend)
- **Role:** React/Vite UI. This is the entire client-side application.
- **Rules:** 
  - Owns session UX, conversation/event rendering, and client-side state.
  - DO NOT put server-side logic, file system operations, or raw database calls here.
  - DO NOT use native UI alerts (`window.confirm`, `window.prompt`).

### 2. `apps/server` (The Backend)
- **Role:** Node.js WebSocket server.
- **Rules:**
  - Wraps the Codex app-server (JSON-RPC over stdio).
  - Serves the React web app and manages AI provider sessions.
  - Handles the filesystem, SQLite database, and deep system integrations.
  - DO NOT put any React or UI code here.

### 3. `apps/desktop` (The Shell)
- **Role:** The Electron wrapper for the application.
- **Rules:**
  - Handles OS-level windowing, tray icons, and native system menus.
  - Keeps a very thin layer. Most logic should be delegated to `apps/server` or `apps/web`.

### 4. `packages/contracts` (The Strict Schema Layer)
- **Role:** Shared schemas (Effect/Schema) and TypeScript contracts.
- **Rules:**
  - Defines provider events, WebSocket protocols, and model/session types.
  - **CRITICAL:** Keep this package schema-only. ZERO runtime logic is allowed here. It is strictly for type definitions and validation schemas.

### 5. `packages/shared` & `packages/client-runtime`
- **Role:** Shared utility logic.
- **Rules:**
  - `shared`: Used by both the server and client applications (e.g., pure parsing functions, constants). Uses explicit subpath exports (`@t3tools/shared/git`) instead of a barrel index.
  - `client-runtime`: Shared runtime package for sharing client code across web and mobile.

### 6. `tabs-code-oss` (The Embedded Code-OSS Runtime)
- **Role:** Patched VS Code runtime powering the in-app editor.
- **Rules:**
  - **Self-Contained Fat Installers:** Production desktop installers (`.dmg`, `.exe`, `.AppImage`) MUST bundle `tabs-code-oss` directly inside (`Resources/tabs-code-oss` on macOS, `resources/tabs-code-oss` on Linux/Windows). Never publish thin installers that require on-demand downloads for production releases.
  - **No Silent Fallback:** Packaging scripts (`build-desktop-artifact.ts`) must never silently fall back to thin mode if `tabs-code-oss` is uncompiled or missing.
  - **Development Mode Isolation:** `bun run dev:desktop` must always resolve from the local checkout (`../tabs-code-oss`) and never attempt to download release zips from GitHub.

## Implementation Philosophy
- **Performance & Reliability First:** Keep behavior predictable under load (e.g., partial streams, reconnects).
- **Maintainability:** Do not duplicate logic. Extract shared functions to appropriate packages if used across apps. 
- **Wait for Instructions:** Combine this understanding with your Anti-Rogue directives. Knowing *where* code belongs does not give you permission to refactor it without user consent.
