# Tabs

Tabs is a desktop-first workspace for coding agents.

It combines:

- a React web app for chat, project state, browser tools, terminal tools, and workspace controls
- a local Node/WebSocket server that brokers provider runtimes such as Codex and Claude
- an Electron shell that can host the app, embedded terminals, browser surfaces, and a local VS Code-based workbench inside the Code tab

## What the project contains

- `apps/web`
  The main Tabs frontend.
- `apps/server`
  The local server that owns settings, orchestration, provider runtime integration, git helpers, terminal sessions, and IPC-facing APIs.
- `apps/desktop`
  The Electron desktop shell.
- `packages/contracts`
  Shared runtime contracts and schemas.
- `packages/shared`
  Shared utilities used across the app.

## Core features

- provider-backed agent threads
- project-aware chat and workspace state
- embedded browser tooling
- embedded terminal tooling
- project-specific custom browser tabs and terminal tabs
- git and server controls inside the workspace shell
- desktop app with an embedded Code tab powered by a local VS Code build
- Tailscale status monitoring & network connection options
- Source control / Git credentials configuration
- Multi-provider model configuration picker in settings

## Prerequisites

You need:

- `bun` 1.3+
- `node` 24+
- a working Codex CLI install if you want Codex-backed threads
- a working Claude CLI / agent install if you want Claude-backed threads

## Install dependencies

From the repo root:

```bash
bun install
```

## Run the web app and local server in development

From the repo root:

```bash
bun run dev
```

Useful variants:

```bash
bun run dev:web
bun run dev:server
bun run dev:desktop
```

## Run the desktop app

From the repo root:

```bash
bun run dev:desktop
```

For a packaged-start style local run:

```bash
bun run start:desktop
```

## Embedded Code tab setup

The desktop Code tab prefers a sibling VS Code checkout that has already been compiled for the Electron workbench.

Tabs now expects that checkout at:

```bash
../tabs-code-oss
```

Build it like this:

```bash
cd ../tabs-code-oss
npm install
npm run compile
```

Tabs will auto-detect `../tabs-code-oss` and expects these compiled assets:

- `out/vs/base/parts/sandbox/electron-browser/preload.js`
- `out/vs/code/electron-browser/workbench/workbench-dev.html`
- `out-build/nls.messages.json`

You can also override detection with:

- `TABS_CODE_OSS_BUILD_DIR`
  Absolute path to the local `tabs-code-oss` checkout root

The intentional integration boundary, upstream update workflow, and required
regression coverage are documented in [Code-OSS parity contract](docs/code-oss-parity.md).

## Workspace folder layout expected by this repo

A typical local layout now looks like:

```text
tabs/
  logo/
  tabs-app/
  tabs-code-oss/
  tabs-code-web/
```

`tabs-code-web` is the renamed companion web checkout folder in the workspace. Tabs itself does not rely on that sibling name for the desktop Code tab boot path the way it does for `tabs-code-oss`, but keeping the naming consistent helps local development.

## Typecheck

From the repo root:

```bash
bun typecheck
```

## Tests

From the repo root:

```bash
bun test
```

You can also run package-specific checks as needed.

## Build

From the repo root:

```bash
bun run build
```

## Privacy & telemetry

Pre-built desktop releases send an anonymous daily active installation ping (a random
installation UUID, OS, architecture, and Tabs version) to help us measure release
adoption. Tabs NEVER collects or transmits names, provider logins, prompts, code, model
choices, reasoning settings, or recordings. You can completely disable all telemetry at any
time by starting Tabs with the environment variable `TABS_TELEMETRY_ENABLED=false`.

See the [privacy details](docs/privacy.md) and
[owner setup and adoption dashboard guide](docs/usage-analytics.md).

## Notes

- This project is still under active development.
- Some areas still reflect upstream VS Code internals because the desktop Code tab is built on top of a local VS Code workbench checkout.
- Internal VS Code protocol names such as `vscode-webview` are expected and should not be treated as Tabs branding issues.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a change.

## Acknowledgments & Shoutouts

Tabs is built on top of and inspired by incredible open-source projects and developer tools:

- **[T3 Code](https://github.com/t3tools/t3code)** — The foundational base upon which the Tabs IDE application was built and evolved.
- **[Code-OSS](https://github.com/microsoft/vscode)** — The open-source core of Visual Studio Code powering Tabs' embedded editor runtime and desktop workbench.
- **[Synara](https://trysynara.com)** — A key inspiration for multi-agent workflows, provider integration patterns, and code analysis capabilities.
