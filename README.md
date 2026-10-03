<p align="center">
  <img src="tabs-main/apps/desktop/resources/icon.png" width="112" alt="Tabs IDE app icon" />
</p>

<h1 align="center">Tabs IDE</h1>

<p align="center">
  <strong>A desktop workspace built for coding with agents.</strong><br />
  Chat, edit, browse, run commands, and manage Git without losing context.
</p>

<p align="center">
  <a href="https://notacent.app/en/app/tabs-ide">
    <img src="https://notacent.app/api/badge/tabs-ide.svg?style=card&lang=en" alt="75 active days, verified by Not a Cent" />
  </a>
</p>

<p align="center">
  <a href="#why-tabs">Why Tabs</a> ·
  <a href="#supported-providers">Supported providers</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#development">Development</a> ·
  <a href="#releases">Releases</a> ·
  <a href="#acknowledgments--shoutouts">Acknowledgments</a>
</p>

> [!NOTE]
> **Public Beta.** Tabs is in active development. Expect some bugs and rough edges. Feedback and bug reports are welcome. [Download installers](https://tabside.vercel.app/downloads) or build from source below.

> [!IMPORTANT]
> **macOS Gatekeeper & Notarization Notice**:
> Pre-built macOS releases are currently unsigned and not notarized because we do not have an active Apple Developer account.
> If macOS blocks the app with a security warning (*"Tabs cannot be opened because Apple cannot check it for malicious software"* or *"unidentified developer"*):
> 1. Open **System Settings** > **Privacy & Security**.
> 2. Scroll down to the **Security** section where Tabs is listed as blocked.
> 3. Click **Open Anyway** (and confirm with **Open**).
> 
> Build and run Tabs locally from source below if you prefer not to override the warning. [Apple’s guidance](https://support.apple.com/102445) explains this first-launch approval.

## Why Tabs

Coding with an agent usually means juggling a chat window, an editor, terminals, Git tools, and browser tabs. Tabs brings those surfaces into one project-aware desktop app so the agent and the developer work from the same context.

### One workspace, fewer handoffs

- **Agent conversations** with streaming responses across 11 supported providers (Codex, Claude, Cursor, Copilot, Antigravity, and more)
- **Code-OSS editor** embedded as a native desktop workbench
- **Terminal sessions** backed by local PTYs
- **Browser tools** with shared, isolated, or named persistent profiles
- **Git workflows** for branches, commits, diffs, stashes, merges, rebases, and pull requests
- **Project sessions** that preserve state across restarts
- **Cross-platform packaging** for macOS, Windows, and Linux

## Supported providers

Tabs is built on top of [T3 Code](https://github.com/pingdotgg/t3code) and extends its agent harness design. Rather than locking you into a proprietary API subscription or proxy markup, Tabs lets you **bring your own keys and subscriptions (BYOK / BYOS)**. If an agent or CLI is set up on your machine, or you have an API key, Tabs connects directly to it.

<p align="center">
  <img src="tabs-main/apps/marketing/public/product/agents-dark.png" alt="Tabs Agents View with Model Picker and Provider Rail" width="100%" />
</p>

Tabs currently supports **11 model and agent providers**:

| Provider | Integration | Setup & Authentication |
| --- | --- | --- |
| **OpenAI Codex** | Native App-Server / CLI | Install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login` |
| **Anthropic Claude** | Claude Code / Agent SDK | Install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login` |
| **Cursor** | Cursor Agent CLI / ACP | Install [Cursor CLI](https://cursor.com/cli) and run `agent login` |
| **GitHub Copilot** | Copilot SDK / ACP | Authenticate via GitHub account or configure Copilot token |
| **xAI Grok Build** | Grok CLI / ACP | Install [Grok Build CLI](https://x.ai/cli) and run `grok login` |
| **OpenCode** | OpenCode Runtime | Install [OpenCode](https://opencode.ai) and run `opencode auth login` |
| **Google Antigravity** | Built-in ACP | Enable in Settings, then click **Install Antigravity** & **Sign in with Google** (no CLI required) |
| **Google Gemini** | Google Generative AI API | Set `GEMINI_API_KEY` or configure API key in Settings |
| **Droid** | Native CLI / ACP | Install Droid CLI or configure runtime path in Settings |
| **Kilo** | Kilo Runtime | Install `kilo` (`~/.kilo/bin/kilo`) or configure in Settings |
| **OpenRouter** | Direct API | Configure OpenRouter API key in Settings for unified access to 100+ models |

### Multi-instance & custom models

- **Multiple Instances**: Run multiple accounts simultaneously for the same provider (e.g. `codex_personal` alongside `codex_work`).
- **Custom Model Slugs**: Save additional model slugs and reasoning effort parameters directly in Settings or switch them using `/model`.
- **Live Token & Cost Tracking**: Built-in usage metrics monitor token consumption, prompt caching, context limits, and cost across all active providers in real time.

## Quick start

### Prerequisites

- [Bun](https://bun.sh/) 1.3.9 or newer in the 1.3 line
- [Node.js](https://nodejs.org/) 22.12 or newer (and `npm` for building the Code-OSS runtime)
- Build tools (Python 3, C/C++ compiler toolchain) for compiling Code-OSS native modules
- At least one authenticated provider CLI or API key (e.g., Codex, Claude Code, Cursor, Antigravity, or a Gemini/OpenRouter API key)

### 1. Compile the Code-OSS runtime (`tabs-code-main`)

Tabs embeds a full Code-OSS (VS Code) workbench inside the desktop app. Before running Tabs locally, compile the sibling `tabs-code-main` runtime:

```bash
cd tabs-code-main
npm install
npm run compile
```

Tabs auto-detects `tabs-code-main` and verifies the core compiled assets:
- `out/vs/base/parts/sandbox/electron-browser/preload.js`
- `out/vs/code/electron-browser/workbench/workbench-dev.html`
- `out-build/nls.messages.json`
- `product.json`

*(Tip: Run `npm run watch` if you are actively modifying the Code-OSS workbench).*

### 2. Install Tabs dependencies

```bash
cd ../tabs-main
bun install
```

### 3. Launch the desktop app

```bash
bun run dev:desktop
```

> [!NOTE]
> `bun run dev:desktop` is the ONLY supported development entry point. Never run `bun run dev` (without `:desktop`), which only opens a plain browser tab and lacks native Electron IPC, Code-OSS editor hosting, and the desktop authentication bridge.

## How it works

```text
┌────────────────────────── Tabs desktop (Electron) ──────────────────────────┐
│                                                                             │
│   React workspace        Code-OSS workbench       Browser / terminals       │
│          │                       │                         │                │
│          └────────────── project and session context ──────┘                │
│                                  │                                          │
│                         local WebSocket server                              │
│                     ┌────────────┼────────────┐                             │
│                 agent runtime    Git       persistence                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

The Electron shell owns the desktop window and native integrations. The React workspace provides Tabs' project and tool surfaces, while a compiled Code-OSS workbench is mounted inside the Code tool. A local server coordinates agent providers, terminals, Git operations, browser automation, and SQLite-backed state.

### Technology

| Area            | Stack                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------- |
| Workspace UI    | React 19, Vite, Tailwind CSS, Zustand, TanStack Router and Query                            |
| Desktop         | Electron with an embedded Code-OSS workbench                                                |
| Server          | Node.js, Effect, WebSocket, SQLite                                                          |
| Agent providers | 11 drivers: Codex, Claude, Cursor, Copilot, Grok, OpenCode, Antigravity, Gemini, Droid, Kilo, OpenRouter |
| Tooling         | Bun, Turborepo, Vitest, Playwright, oxlint, oxfmt                                           |

## Repository map

```text
tabs/
├── tabs-main/          Product monorepo
│   ├── apps/
│   │   ├── desktop/    Electron shell and native integrations
│   │   ├── marketing/  Public website
│   │   ├── server/     Local WebSocket backend
│   │   └── web/        React workspace UI
│   ├── packages/       Shared contracts and runtime libraries
│   └── scripts/        Development, build, and release tooling
├── tabs-code-main/     Tabs' Code-OSS runtime fork
├── .github/            CI, release workflows, and release notes
└── README.md
```

The two source trees have different responsibilities: `tabs-main/` is the Tabs product, while `tabs-code-main/` is the editor runtime bundled into desktop builds. Neither is generated output.

## Development

Run project commands from `tabs-main/`:

```bash
bun run dev:desktop   # Start the complete Electron application
bun run typecheck     # Check TypeScript across the monorepo
bun run lint          # Run oxlint
bun run fmt:check     # Verify formatting
bun run test          # Run the test tasks
```

Useful focused commands:

```bash
bun run dev:server
bun run dev:web
bun run dev:marketing
bun run test:desktop-smoke
```

### Browser profiles

Tabs keeps embedded-browser data in persistent Electron partitions:

- **Shared (Project)** shares one session between browser tabs in a project.
- **Isolated** gives one tab its own session.
- **Named Profile** shares a selected session across projects and tabs.

Sites remain responsible for their own authentication policies. Tabs does not copy cookies from external browsers, and some providers may block sign-in from an embedded browser.

## Releases

Desktop installers are self-contained and bundle the compiled Code-OSS runtime.

> [!NOTE]
> **macOS Gatekeeper**: These public-beta builds are not Apple Developer ID signed or notarized. After attempting to open Tabs, use **System Settings > Privacy & Security > Open Anyway**. Building from source is an alternative.

```bash
cd tabs-main
bun run dist:desktop:dmg         # macOS, current architecture
bun run dist:desktop:dmg:arm64   # macOS, Apple Silicon
bun run dist:desktop:dmg:x64     # macOS, Intel
bun run dist:desktop:win         # Windows NSIS installer
bun run dist:desktop:linux       # Linux AppImage
```

Windows installers should be built on Windows or in CI because the application includes native modules. Release tags use the release workflow and require a matching file in `.github/release-notes/`.

See [CHANGELOG.md](CHANGELOG.md) for shipped changes.

## Public-beta privacy and feedback

Tabs-owned product analytics is **off by default**. Explicit opt-in uses a random
Tabs installation ID, never a provider account ID. See [privacy details](tabs-main/docs/privacy.md)
for collected fields, opt-out, and separate provider/browser/extension traffic.

Testing is unfinished **Early access**, hidden by default, and available through
Workspace settings for deliberate opt-in. Provider integrations require their
own authentication or credentials; availability does not mean they are preconfigured.

Installers target macOS arm64/x64, Windows x64, and Linux x64. Each platform still
needs native installer QA before publication. [Report a bug](https://github.com/PanicMako/Tabs-ide/issues/new?template=bug_report.yml)
with version, OS, architecture, reproduction steps, and sanitized diagnostics.
For vulnerabilities, follow [SECURITY.md](SECURITY.md).

## Contributing

Before opening a change:

1. Read the [contribution guide](tabs-main/CONTRIBUTING.md).
2. Keep product changes in `tabs-main/` and editor-runtime changes in `tabs-code-main/`.
3. Run formatting, lint, type checking, and the relevant tests.
4. Document user-visible changes in the appropriate release notes.

Performance, reliability, and predictable recovery behavior take priority over clever shortcuts.

## Acknowledgments & Shoutouts

Tabs is built on top of and inspired by incredible open-source projects and developer tools:

- **[T3 Code](https://github.com/pingdotgg/t3code)** — The foundational base upon which the Tabs IDE application was built and evolved.
- **[Code-OSS](https://github.com/microsoft/vscode)** — The open-source core of Visual Studio Code powering Tabs' embedded editor runtime and desktop workbench.
- **[Synara](https://trysynara.com)** — A key inspiration for multi-agent workflows, provider integration patterns, and code analysis capabilities.

## License

The product’s existing [MIT License](LICENSE) retains T3 Tools Inc.’s notice. Code-OSS retains Microsoft’s separate MIT notice. See [LICENSING.md](LICENSING.md) for component scope, bundled notices, and the outstanding Tabs-original copyright-holder decision.
