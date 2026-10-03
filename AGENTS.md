# Agent Rules & Instructions

- **NO DESTRUCTIVE GIT COMMANDS:** NEVER run destructive Git commands under any circumstances unless explicitly, verbally commanded to do so by the user. This includes, but is not limited to: `git reset --hard`, `git clean -fd`, `git stash drop`, `git stash clear`, `git checkout -- .`. You are strictly forbidden from altering, dropping, or clearing the user's Git stash, or wiping out their uncommitted working directory history.
- **NEVER Delete Code Without Permission:** Do not delete existing files, features, or large chunks of logic unless explicitly instructed by the user. If a change requires significant deletions or removals, you MUST ask for permission first. Avoid doing "whatever you want" and strictly adhere to the requested changes.
- **Maintain Test Suite Correctness:** Whenever you implement a new feature, fix a bug, or modify any existing codebase, you MUST identify and run the relevant unit/integration tests to ensure no regressions are introduced. If existing tests are broken by your intentional changes, you MUST update the tests to reflect the new behavior. Always verify the full test suite passes using the workspace test commands (e.g. `bun run test` or package-specific test runner) before completing the task. Never leave failing or outdated tests.
- **No Native UI allowed**: The user explicitly requires that NO native UI (e.g. `window.confirm`, `window.alert`, `window.prompt`) should be used anywhere in the application. Always use the provided custom UI components (like the `useConfirm` hook) instead of native browser popups/dialogs.

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
