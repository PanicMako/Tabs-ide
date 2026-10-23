# Exchange documented-command acceptance

This ledger covers the current author-facing commands in Exchange’s Start here,
Development, Publishing, Discovery and Self-hosting documentation, plus the CLI
package README. It does not turn repository maintenance examples or future npm
publication instructions into completed launch acceptance.

## Executed developer commands on macOS

The current SDK and CLI packages are 1.7.0; the developer bundle names Tabs 1.3.17
as its compatibility target. Use the versions in the downloaded release metadata
when they differ. The exact npm-installed executable quickstart ran under the
host’s Node v26.8.1, rather than only invoking CLI source through Bun.

| Documented command or step                                                                                  | Current execution evidence                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install -g --prefix ./tabs-toolchain ./tabs-extension-cli-1.7.0.tgz`                                   | Passed from a fresh folder using the current generated tarball, whose bytes matched release metadata.                                                                     |
| `./tabs-toolchain/bin/tabsext init my-tool --sdk "$PWD/tabs-extension-api-1.7.0.tgz" --tabs-version 1.3.17` | Passed through the installed executable; records the target in `.tabsext.json`.                                                                                           |
| `cd my-tool`                                                                                                | Subsequent subprocesses ran with this exact project as their working directory.                                                                                           |
| `npm install`                                                                                               | Passed in the fresh React project; HTML installation also passed in the separate correction probe.                                                                        |
| `npm run build`                                                                                             | Passed in both React and HTML projects.                                                                                                                                   |
| `../tabs-toolchain/bin/tabsext validate`                                                                    | Passed using the recorded project target.                                                                                                                                 |
| `../tabs-toolchain/bin/tabsext pack`                                                                        | Passed through the installed executable.                                                                                                                                  |
| `tabsext inspect <archive>`                                                                                 | Passed through the installed executable on the resulting React archive; downloaded-bundle verification also independently inspected both templates.                       |
| `tabsext init my-tool --template html --tabs-version 1.3.17`                                                | Corrected command passed in a fresh folder. The old command without the target failed before project creation, confirming the documentation bug.                          |
| `tabsext dev`                                                                                               | Downloaded-bundle verifier exercised real file changes, rebuilds and cancellation for both templates on macOS. Native tool reload is not covered.                         |
| `tabsext registry --registry <origin>`                                                                      | Current installed executable passed against the real private registry at `https://localhost:9443`, with its test CA validated and no token sent.                          |
| CLI package `bun run build` and package `npm pack`                                                          | Developer-release generator executed the CLI build and npm-packed both standalone packages; downloaded artifacts were checked and installed. No npm publication occurred. |

Evidence for this checkpoint:

- `/tmp/tabs-exchange-redesign/documentation-node-cli-y4jtljdw/report.json`
  and its numbered command logs, plus `registry.log`.
- `/tmp/tabs-exchange-redesign/documentation-html-nav5polp/report.json`
  and its numbered logs.
- `/tmp/tabs-exchange-redesign/documentation-command-tutorial.log`:
  React and HTML standalone install/build/validate/pack/inspect, deterministic
  archives, watch rebuild and cancellation all passed.
- `.test-data/sdk-resource-acceptance-20261004/run-Zng9YC/report.json`:
  six source samples, 24 lower-level packaging commands, production filesystem,
  Git and network brokers, and disposable logic workers. These are separate
  from actual native sample views, grants and IPC acceptance.

These local execution logs are supporting evidence. Their temporary locations
must not be treated as production recovery artifacts.

## Commands and actions that still require acceptance

| Documented command or action                                                   | Evidence and outstanding work                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tabsext publish <archive> --registry <origin>`                                | Real owner website uploads/scans/rejection/correction/approval/signed publication passed, but that does not prove real-account CLI submission. Requires an owner-created, namespace-scoped publish token and a private local CLI walkthrough. |
| `tabsext status <publisher> <tool> <version> --registry <origin>`              | Controlled CLI/transport tests exist; real-account token-authenticated status remains unproven.                                                                                                                                               |
| `tabsext status ... --watch`                                                   | Controlled watcher tests exist; the real-account watcher, terminal states and cancellation need a scoped-token walkthrough.                                                                                                                   |
| `tabsext search dashboard --registry <origin>` with a scoped read token        | Actual private read-token handoff remains pending. A successful unauthenticated registry-info command does not prove protected catalog search.                                                                                                |
| Load `.tabs-extension`, reload the development tool and enable it              | Actual desktop window binding remains unavailable. Packaging and broker checks do not prove UI loading, permissions or project/profile enablement.                                                                                            |
| Windows `tabsext.cmd` and development-process cleanup                          | No Windows host execution evidence. macOS cancellation does not establish Windows process-tree cleanup.                                                                                                                                       |
| `cd tabs-main/apps/exchange`, `cp .env.example .env`, edit local configuration | Local acceptance uses its dedicated real-account configuration; the documented Docker setup is a different deployment path and has not been accepted as production configuration. Do not overwrite the existing private configuration.        |
| `docker compose config`                                                        | A check may expand secret values; capture privately if executed. Existing test Compose resources are not evidence for the documented production compose configuration.                                                                        |
| `docker compose up --build -d`                                                 | Dedicated local test PostgreSQL/S3 resources are running. The documented full API/worker deployment, readiness and failure recovery remain unverified.                                                                                        |
| `curl --fail http://localhost:8787/healthz`                                    | Executed successfully against the real local service and returned `{"ok":true}`. Health alone does not prove deployed storage, workers, OAuth or signed installation; production verification remains open.                                   |
| `bun run tuf:export-targets`                                                   | Real approved targets were exported and independently checked in the local publication drill; production signing ceremony and custody remain open.                                                                                            |
| `bun run tuf:publish /absolute/offline-signed-metadata`                        | Local real-account publication and clone rotation used the production verification gate. This is not a production key-custody or client-distribution ceremony.                                                                                |
| `bun run verify:objects`                                                       | Actual cold-restore evidence checks package digests and signed targets; production object-verification execution and operations acceptance remain open.                                                                                       |
| Future `npx @tabs/extension-cli` usage                                         | Deferred until an explicitly approved npm release. Current CLI still requires the SDK tarball and a chosen desktop target.                                                                                                                    |

The broader launch requirements and remaining repository maintenance/recovery
commands remain tracked in [the public-launch acceptance report](exchange-public-launch-acceptance.md).
