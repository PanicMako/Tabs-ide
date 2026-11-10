# Develop Tabs IDE

The `tabs-app` monorepo contains the desktop product and its supporting services. If you’re here to install Tabs or open your first project, start with the [Tabs IDE guide](../README.md).

## Run the desktop app

Use [Bun](https://bun.sh/) 1.3.9 or newer in the 1.3 line, the Node.js version in [the editor’s `.nvmrc`](../tabs-code-oss/.nvmrc), npm, and your OS’s native build tools. From the repository root:

```sh
cd tabs-code-oss
npm install
npm run compile

cd ../tabs-app
bun install
bun run dev:desktop
```

Use `bun run dev:desktop` for end-to-end development. Electron supplies the desktop authentication bridge, native IPC, terminals, browser surfaces, and embedded editor. The standalone `dev:web` and `dev:server` commands are useful for work on those components in isolation.

<details>
<summary>If the embedded editor does not start</summary>

Tabs looks for a compiled `../tabs-code-oss` checkout next to this directory. Check for these files in that checkout:

- `out/vs/base/parts/sandbox/electron-browser/preload.js`
- `out/vs/code/electron-browser/workbench/workbench-dev.html`
- `out-build/nls.messages.json`
- `product.json`

Set `TABS_CODE_OSS_BUILD_DIR` to the absolute path of the checkout if it lives elsewhere. Use `npm run watch` from the editor checkout when actively developing its workbench. See the [Code OSS parity contract](docs/code-oss-parity.md) for the integration boundary and regression coverage.

</details>

## Find the right code

| Directory                              | What lives here                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `apps/desktop`                         | Electron windows, native integrations, and Code OSS hosting                   |
| `apps/web`                             | React workspace, project tools, and agent conversations                       |
| `apps/server`                          | Local WebSocket server for providers, terminals, Git, and SQLite-backed state |
| `apps/marketing`                       | Public website and download pages                                             |
| `apps/exchange`                        | Tabs extension catalog and publishing services                                |
| `packages/`                            | Shared contracts, runtime libraries, and extension tooling                    |
| `scripts/`                             | Development, build, and release tooling                                       |
| [`../tabs-code-oss`](../tabs-code-oss) | The editor runtime fork bundled with desktop builds                           |

The Electron shell hosts the React workspace and mounts Code OSS inside **Code**. The local server coordinates agent runtimes, Git operations, terminals, and persistence. The product and editor live in separate source trees so each can be developed within its own boundary.

## Check changes

Run these from `tabs-app/` before opening a change. See the [contribution guide](CONTRIBUTING.md) for repository conventions.

```sh
vp check
vp run typecheck
vp run test
```

Use `bun run test:desktop-smoke` for a desktop smoke test, `bun run dev:marketing` to work on the public site, or `bun run start:desktop` for a packaged-style local run.

## Package the desktop app

Desktop installers bundle the compiled Code OSS runtime. From `tabs-app/`:

```sh
bun run dist:desktop:dmg         # macOS, current architecture
bun run dist:desktop:dmg:arm64   # macOS, Apple Silicon
bun run dist:desktop:dmg:x64     # macOS, Intel
bun run dist:desktop:win         # Windows NSIS installer
bun run dist:desktop:linux       # Linux AppImage
```

Build Windows installers on Windows or in CI because the app includes native modules. Release tags use the [release workflow](../.github/workflows/release.yml) and require a matching entry in [`.github/release-notes/`](../.github/release-notes/).

See the [privacy documentation](docs/privacy.md), [usage analytics guide](docs/usage-analytics.md), and [release history](../CHANGELOG.md).
