# Tabs IDE

[![Watch the Tabs IDE workspace tour. The Tabs mascot sits beside the wordmark and a preview of the Code workspace.](docs/readme/tabs-cover.png)](docs/readme/replay.mp4?raw=true)

Tabs is a desktop workspace for building software with AI agents. Keep several projects open in one window, then use each project’s agent chat, editor, browser, terminal, and Git tools.

**[Download Tabs](https://buildwithtabs.com/downloads)** · [Watch the real Tabs workflow](docs/readme/replay.mp4?raw=true) · [What’s new](CHANGELOG.md) · [Build from source](#build-from-source)

Tabs is in public beta for macOS, Windows, and Linux. The installers include the editor.

**Try the interactive prototype.** From a local checkout, open [`docs/readme/workspace-tour.html`](docs/readme/workspace-tour.html) in your browser. Switch between two sample projects, save tools to the toolbar, and try Quick Actions.

## Start with a project

1. **Install Tabs.** On a Mac, open **Apple menu → About This Mac** to check whether you need the Apple Silicon or Intel download. On Windows, run the `.exe` installer. On Linux, use the `.AppImage` and allow it to run as a program if your system asks.
2. **Open a folder.** Pick a folder you already work in, create a project, or paste a Git repository URL to clone a copy. The guided tour walks through the workspace. If you minimize it, click the mascot to pick up where you left off.
3. **Connect an agent when you’re ready.** Open **Settings → Providers** and follow the setup for the one you use. You can explore your files, browser, and terminal before connecting an agent.
4. **Try a small first task.** Open **Agents** and ask, “What’s in this project, and where should I start?” Open a file in **Code** as you follow along, and use **Git** to review any changes you make.

<details>
<summary>If macOS blocks the app on first launch</summary>

The beta builds are unsigned and unnotarized. After attempting to open Tabs, go to **System Settings → Privacy & Security** and choose **Open Anyway** if you trust the download. See [Apple’s first-launch guidance](https://support.apple.com/102445) for details, or [build from source](#build-from-source).

</details>

<a name="why-tabs"></a>

## Inside the workspace

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="tabs-app/apps/marketing/public/product/agents-dark.png" />
  <img src="tabs-app/apps/marketing/public/product/agents-light.png" alt="Tabs workspace with a project sidebar, an agent conversation, and the model picker open." width="960" />
</picture>

- **Project tabs.** Use the top row to switch between projects in one window. Each project has its own workspace and toolbar.
- **Agents and Code.** Chat with an agent about the open project, then read and edit the same files in the built-in Code OSS editor. Markdown files have editing and preview modes.
- **Browser and terminal.** In **Settings → Workspace**, add a Browser tab with a URL or a Terminal tab with a command. Open a cloud tool, a local preview, or a repeat command from the project toolbar. Choose project-shared, isolated, or named browser profiles when you need separate sign-ins.
- **Quick Actions.** Press **⌘ + Option + K** on macOS or **Ctrl + Alt + K** on Windows and Linux to open the wheel. Use it to return to Code, start a conversation, or open a temporary browser or terminal.
- **Git.** See what changed, review file diffs, and work with branches, commits, and pull requests in the same workspace.
- **Make it yours.** Preview toolbar styles against your theme, create a palette, or set a wallpaper for the workspace or a single conversation. Browse extensions in [Tabs Exchange](https://exchange.buildwithtabs.com).

<a name="supported-providers"></a>

## Use your own agent account

Tabs connects through your provider’s local tool, sign-in, or API key. Your provider’s own plan and usage charges apply. Tabs adds no subscription fee or usage markup.

<details>
<summary>Supported providers and setup</summary>

| Provider           | How to connect                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------ |
| OpenAI Codex       | Install the [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`.    |
| Anthropic Claude   | Install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`. |
| Cursor             | Install the [Cursor CLI](https://cursor.com/cli) and run `agent login`.                    |
| GitHub Copilot     | Sign in with GitHub or configure a Copilot token.                                          |
| xAI Grok Build     | Install the [Grok Build CLI](https://x.ai/cli) and run `grok login`.                       |
| OpenCode           | Install [OpenCode](https://opencode.ai) and run `opencode auth login`.                     |
| Google Antigravity | In Providers, enable Antigravity, choose **Install Antigravity**, and sign in with Google. |
| Google Gemini      | Add an API key in Providers or set `GEMINI_API_KEY`.                                       |
| Droid              | Install the Droid CLI or set the path to an existing installation in Providers.            |
| Kilo               | Install the Kilo runtime or configure its path in Providers.                               |
| OpenRouter         | Add an OpenRouter API key in Providers.                                                    |

In **Settings → Providers**, you can also add multiple instances of the same provider and configure custom model IDs. The model picker lets you switch models within a conversation where the provider supports it. Tabs also shows token and cost information when the provider reports it.

</details>

<a name="quick-start"></a>

## Build from source

Use the Node.js version in [`tabs-code-oss/.nvmrc`](tabs-code-oss/.nvmrc), npm, [Bun](https://bun.sh/) 1.3.9 or newer in the 1.3 line, and the native build tools for your OS (Python 3 and a C/C++ toolchain).

From a checkout of this repository:

```sh
cd tabs-code-oss
npm install
npm run compile

cd ../tabs-app
bun install
bun run dev:desktop
```

`bun run dev:desktop` launches the Electron app with its embedded editor, terminal, and desktop authentication. See the [developer guide](tabs-app/README.md) for build troubleshooting, project structure, and contribution checks.

## Privacy and feedback

Tabs does not collect your code, chats, or provider keys. Requests go to the provider you configure. Packaged releases send an anonymous daily activity ping with installation and version metadata. Set `TABS_TELEMETRY_ENABLED=false` before starting Tabs to turn that ping off. [Read the privacy details](tabs-app/docs/privacy.md).

- [Report a bug](https://github.com/PanicMako/Tabs-ide/issues/new?template=bug_report.yml) with your Tabs version, operating system, and steps to reproduce it.
- [Contribute to Tabs](CONTRIBUTING.md) or read the [security reporting policy](SECURITY.md).
- [Browse desktop releases](https://github.com/PanicMako/Tabs-ide/releases) and the [release history](CHANGELOG.md).

## Built on open source

[T3 Code](https://github.com/pingdotgg/t3code) provided the foundation for the agent workspace, [Code OSS](https://github.com/microsoft/vscode) powers the embedded editor, and [Synara](https://trysynara.com) inspired multi-agent workflows. See the [MIT license](LICENSE) and [component notices](LICENSING.md). [View verified build activity on Not a Cent](https://notacent.app/en/app/tabs-ide).
