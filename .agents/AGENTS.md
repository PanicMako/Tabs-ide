# Agent Rules & Instructions

**CRITICAL STARTING POINT**: For a complete overview of the application's architecture, package structure, and technologies, agents MUST read [ARCHITECTURE.md](file:///Users/rushil.dev/Desktop/Tabs-ide-cleanup-vscode-web-2026-04-28/.agents/ARCHITECTURE.md) first. Update it whenever significant architectural changes are made.


- **MANDATORY ANTI-ROGUE PROTOCOL:** You MUST act as a strictly obedient pair programmer. Before executing ANY task, you must consult `instructions/anti-rogue.instructions.md`. Unprompted refactoring, UI rewrites, and guessing the user's intent are strictly forbidden.
- **MANDATORY ARCHITECTURE PROTOCOL:** Before creating new files or adding features, you must consult `instructions/architecture.instructions.md` to understand where your code belongs within the `apps/` and `packages/` monorepo structure. Do not guess.
- **MANDATORY UI/UX PROTOCOL:** Any task involving frontend development must comply with `instructions/ui-ux.instructions.md`. All UI must be production-ready and premium. Do not hallucinate layouts; use mockups and ask for clarification.
- **MANDATORY PRODUCTION STANDARDS:** All code must be performant, tested, and CI-ready. Before completing any task, you must consult `instructions/production-standards.instructions.md`. You are forbidden from pushing untested code or code that fails local pre-flight checks (types, lint, tests).
- **MANDATORY SAFETY NET:** To prevent workspace corruption, you must strictly follow `instructions/safety-net.instructions.md`. You are forbidden from running `npm`/`yarn`, auto-committing to Git without permission, or modifying files outside this workspace.
## This is an Electron app — it must be launched as a desktop app, never as a plain web page in a browser

1. The ONLY correct way to run and test this application is:
     bun run dev:desktop
   This launches the real Electron shell, which is required for the app to
   function correctly (native IPC bridges, desktopBridge APIs, WebSocket
   auth token exchange between the Electron main process and the backend,
   window/menu management, etc. all depend on running inside Electron).

2. NEVER run `bun run dev` (without `:desktop`) expecting it to represent
   the real app. That command only starts the Vite web dev server and the
   backend directly, which opens the frontend in a plain browser tab
   (localhost) instead of inside Electron. This has already caused a
   misdiagnosis once — testing in a browser tab produced different/
   irrelevant behavior and timing than the real Electron app, because
   critical pieces (the desktop bridge, native IPC, main-process-injected
   WS URL/token) simply aren't present in a browser context.

3. If a task, script, or automated test needs to launch this app for any
   reason (reproduction, diagnostics, verification), it MUST use
   `bun run dev:desktop` specifically — never `bun run dev`, never opening
   http://localhost:<port> directly in a browser, and never assuming a
   browser tab is an acceptable substitute for the real app "just to check
   something quickly."

4. If you are ever unsure whether the app is running as Electron vs. a
   browser tab, check for an Electron process in `ps aux` (matching
   `tabs-dev-root` or `dist-electron/main.js`) rather than assuming based
   on what appeared on screen.

## Process management — CRITICAL, non-negotiable

1. HARD LIMIT: NEVER have more than ONE (1) instance of this app
   (`bun run dev:desktop` / any Electron+backend launch of Tabs) running at
   any time. Two instances is already the absolute maximum tolerable in an
   emergency and should basically never happen — the target is always
   exactly one. Each instance can consume 70GB+ of disk/memory, so even a
   handful running simultaneously (this has happened before — 6 at once)
   is enough to completely crash the machine and require a hard restart.

   Before launching ANY new instance, always verify nothing is already
   running:
     ps aux | grep -iE "tabs-dev-root|dist-electron|apps/server/dist"
   If ANYTHING shows up, kill it and confirm it's gone before launching
   anything new. Do not launch "just one more" on top of an existing one
   for any reason, including testing, comparison, or automation.

2. NEVER run automated loops that launch this app multiple times in
   sequence (e.g. "launch 20 times to catch a bug") UNLESS each iteration
   is followed by a verified, confirmed full kill of that instance —
   checked via the ps command above, not just a `sleep` delay or a bare
   `pkill` — before the next iteration starts. If you cannot guarantee
   with certainty that iteration N is fully dead before iteration N+1
   launches, do not run the loop at all — do a small number of manual,
   individually-verified launches instead.

3. NEVER use broad process-kill patterns. Specifically NEVER run:
     pkill -f "electron"
     pkill -f "node"
     pkill -f "bun"
   on their own — these bare patterns match against the FULL command line
   of every running process and will kill unrelated applications, including
   the IDE/host application itself (this has already happened once and
   caused Antigravity itself to quit repeatedly). ONLY use narrowly scoped
   patterns specific to this app, such as:
     pkill -9 -f "tabs-dev-root"
     pkill -9 -f "dist-electron/main.js"
     pkill -9 -f "apps/server/dist/index.mjs"

4. Before ending any task/session that involved launching this app, always
   run the ps check above AND `git status` to confirm zero orphaned
   processes and zero uncommitted source changes are left behind. Report
   both explicitly as part of finishing the task.

5. Do not edit application source files (anything under apps/*/src) for
   temporary debug logging without asking for explicit confirmation first,
   describing the exact line(s) to be added. Revert any such temporary
   changes before finishing the task.

6. If disk space or memory ever looks abnormally high while working in this
   repo, stop immediately and check for leftover Tabs instances (via the ps
   command above) before doing anything else — do not assume it's unrelated.
- **NO DESTRUCTIVE GIT COMMANDS:** NEVER run destructive Git commands under any circumstances unless explicitly, verbally commanded to do so by the user. This includes, but is not limited to: `git reset --hard`, `git clean -fd`, `git stash drop`, `git stash clear`, `git checkout -- .`. You are strictly forbidden from altering, dropping, or clearing the user's Git stash, or wiping out their uncommitted working directory history.
- **NEVER Delete Code Without Permission:** Do not delete existing files, features, or large chunks of logic unless explicitly instructed by the user. If a change requires significant deletions or removals, you MUST ask for permission first. Avoid doing "whatever you want" and strictly adhere to the requested changes.
- **Maintain Test Suite Correctness:** Whenever you implement a new feature, fix a bug, or modify any existing codebase, you MUST identify and run the relevant unit/integration tests to ensure no regressions are introduced. If existing tests are broken by your intentional changes, you MUST update the tests to reflect the new behavior. Always verify the full test suite passes using the workspace test commands (e.g. `bun run test` or package-specific test runner) before completing the task. Never leave failing or outdated tests.
- **No Native UI allowed**: The user explicitly requires that NO native UI (e.g. `window.confirm`, `window.alert`, `window.prompt`) should be used anywhere in the application. Always use the provided custom UI components (like the `useConfirm` hook) instead of native browser popups/dialogs.

## Bundled (Fat) Desktop Installers and Development Runtime Protocol

1. **Self-contained desktop installers only:** All desktop installers (`.dmg`, `.exe`, `.AppImage`) MUST bundle the Code-OSS runtime (`tabs-code-oss`) directly inside the package (`Resources/tabs-code-oss` on macOS, `resources/tabs-code-oss` on Linux/Windows), matching standard IDE distributions like Cursor, Antigravity, and VS Code. Desktop releases must NEVER rely on on-demand downloads or external runtime zips.
2. **No silent thin fallback:** The desktop packaging script (`scripts/build-desktop-artifact.ts`) must never silently fall back to thin mode if `tabs-code-oss` is missing or uncompiled. Any desktop artifact build command without explicit `--thin` must fail loudly if the runtime cannot be staged.
3. **Development mode isolation:** In dev mode (`bun run dev:desktop`), Tabs must ALWAYS resolve the editor runtime from the local checkout (`../tabs-code-oss` or `TABS_CODE_OSS_BUILD_DIR`). It must NEVER attempt to download release zips from GitHub releases.
4. **Required Code-OSS compiled assets:** For `bun run dev:desktop` or desktop builds to succeed, `tabs-code-oss` must have its core build assets present:
   - `out/vs/base/parts/sandbox/electron-browser/preload.js`
   - `out/vs/code/electron-browser/workbench/workbench-dev.html`
   - `out-build/nls.messages.json`
   - `product.json`
   If any are missing, run `cd ../tabs-code-oss && npm install && npm run compile`.

## Task Completion Requirements

- `vp check` and `vp run typecheck` must pass before considering tasks completed.
  - If changing native mobile code, `vp run lint:mobile` must also pass.
- Use `vp test` for the built-in Vite+ test command and `vp run test` when you specifically need the `test` package script.

## Project Snapshot

Tabs IDE is a minimal web GUI for using coding agents like Codex and Claude.
This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and client applications. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.
- `packages/client-runtime`: Shared runtime package for sharing client code across web and mobile.

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.

## Vendored Repositories

This project vendors external repositories under `.repos/` as read-only reference material for coding agents.
- Prefer examples and patterns from the vendored source code over generated guesses or web search results.
- Do not edit files under `.repos/` unless explicitly asked.
- Do not import from `.repos/`; application code must continue importing from normal package dependencies.
- Manage vendored subtrees with `bun run sync:repos`; use `bun run sync:repos --repo <id>` to sync one configured repository.
- When updating a dependency with a configured vendored subtree, sync that subtree in the same change so `.repos/` matches the installed dependency version.
- When writing Effect code, read `.repos/effect-smol/LLMS.md` first and inspect `.repos/effect-smol/` for examples of idiomatic usage, tests, module structure, and API design.
- When writing relay infrastructure code with Alchemy, inspect `.repos/alchemy-effect/` for examples of idiomatic usage, tests, module structure, and API design.

## VS Code Agents Instructions

This file provides instructions for AI coding agents working with the VS Code codebase.
For detailed project overview, architecture, coding guidelines, and validation steps, see the [Copilot Instructions](.github/copilot-instructions.md).

## Knowledge Index

This repository contains a vast library of highly specific agent instructions, prompts, and skills located in the `.agents/` directory. When working on a specific task, you **MUST** consult these directories for specialized instructions:

- **`instructions/`**: Contains task-specific guidelines (e.g., `unit-tests.instructions.md`, `accessibility.instructions.md`).
- **`prompts/`**: Contains specialized prompts for complex tasks (e.g., `fix-error.prompt.md`, `migrate.prompt.md`).
- **`agents/`**: Contains overarching agent roles and data structures.
- **`skills/`**: Contains executable skill directories (e.g., `fix-ci-failures`, `memory-leak-audit`, `launch`).
- **`cursor-rules/`**: Contains editor-specific rules (e.g., `cursor-cloud.mdc`).
