import * as FS from "node:fs";
import { fileURLToPath } from "node:url";
import * as Path from "node:path";

export interface ExtensionDoc {
  slug: string;
  title: string;
  body: string;
}
// Astro bundles this module into a different directory. Locate the repository's
// contracts from either the source or bundled location; fail closed if absent.
let repository = Path.dirname(fileURLToPath(import.meta.url));
while (!FS.existsSync(Path.join(repository, "packages/extension-api/src/index.d.ts"))) {
  const parent = Path.dirname(repository);
  if (parent === repository)
    throw new Error("Cannot generate extension API reference without SDK sources.");
  repository = parent;
}
const declarations = FS.readFileSync(
  Path.join(repository, "packages/extension-api/src/index.d.ts"),
  "utf8",
);
const contracts = FS.readFileSync(
  Path.join(repository, "packages/contracts/src/extensions.ts"),
  "utf8",
);
const version = /TABS_EXTENSION_API_VERSION: "([^"]+)"/.exec(declarations)?.[1] ?? "unknown";
const fields =
  contracts
    .split("export const TabsExtensionManifest = Schema.Struct({")[1]
    ?.split("export type TabsExtensionManifest")[0] ?? "";
export const extensionApiVersion = version;
export const extensionDocs: ExtensionDoc[] = [
  {
    slug: "",
    title: "Start here",
    body: `# Build your first Tabs extension

A Tabs-native extension contributes a full-workspace tool to the project toolbar. It is not a VS Code VSIX, browser bookmark, or native ACP agent.

## Release status

API ${version} and the CLI are experimental and **not published to npm**. Official public submissions remain closed. Download the versioned SDK and CLI bundle from this Exchange's [Developers page](/developers). A compatible desktop testing build is required; the bundle does not include a public desktop installer.

## What you need

Node 22.12 or newer, npm, and a compatible Tabs desktop development/testing build. Download and extract the developer bundle into a new folder, then open a terminal in that folder. Its README and release.json identify package versions and the target desktop build. You do not need the Tabs source checkout. SHA256SUMS helps detect corruption; checksums alone are not independent proof of authenticity.

## Create, build, and package

The React/TypeScript template is the default. Run these commands from the extracted bundle folder on macOS/Linux:

\`\`\`sh
npm install -g --prefix ./tabs-toolchain ./tabs-extension-cli-${version}.tgz
./tabs-toolchain/bin/tabsext init my-tool --sdk "$PWD/tabs-extension-api-${version}.tgz" --tabs-version 1.3.17
cd my-tool
npm install
npm run build
../tabs-toolchain/bin/tabsext validate
../tabs-toolchain/bin/tabsext pack
\`\`\`

These shell paths are for macOS/Linux. Windows npm global-prefix executables live directly in tabs-toolchain (use tabsext.cmd rather than bin/tabsext). You may instead install the supplied CLI tarball into your usual npm global prefix and use tabsext directly. The staging directory is \`.tabs-extension\`. In Tabs desktop development mode, open Settings > Extensions > Discover > Load development folder and select that directory. Enable the tool in Installed and select it from the project toolbar.

Use the desktop testing version named in your bundle's release.json instead of 1.3.17 if different. Initialization records it in \`.tabsext.json\`; validation, packaging, inspection, and publishing use that project target unless you override \`--tabs-version\`. There is no hidden default. Use \`--json\` for automation; output is readable by default. No capabilities are requested by the starter.

After a real npm release, the equivalent initialization command is \`npx @tabs/extension-cli init my-tool\`. That command is not the current installation method.
`,
  },
  {
    slug: "development",
    title: "Development",
    body: `# Development

## Project structure

The source project contains \`tabs-extension.json\`, \`src/main.tsx\`, styles, Vite/TypeScript configuration, README, and a local staging script. React builds into \`.tabs-extension/dist\`; the staging script copies only the manifest and README beside those assets.

The manifest entry \`dist/index.html\` is relative to the packaged root, not the source project. Vite uses a relative asset base. Do not package node_modules, .env files, npm installation scripts, native binaries, or remote executable scripts. Listing README rendering escapes raw HTML, accepts HTTP/HTTPS/mailto links, and displays only the declared packaged raster icon; arbitrary remote images and undeclared screenshots are removed.

## Watch and reload

Run \`npm run build\` first, then \`tabsext dev\` to watch local built assets. This is build watching, not remote HMR. Reload the development tool using the host control after a build. Changes to manifest identity or permissions require re-importing and reviewing the extension.

## Plain HTML

Use \`tabsext init my-tool --template html\` for the static alternative. Edit files in \`ui/\`; \`npm run build\` stages them. No React or SDK npm installation is required for JavaScript UI.

## Sandbox and debugging

The desktop hosts packaged files through its own protocol in an isolated view. Node, direct networking, popups, and arbitrary navigation are unavailable. Project/profile URL parameters are display context, never authorization. Debug using your own development build, not production user credentials. Test with keyboard navigation, both themes, narrow windows, denied grants, and project switching.
`,
  },
  {
    slug: "reference",
    title: "Manifest & SDK reference",
    body: `# Manifest and SDK reference

This section is generated at website build time from the actual contract and dependency-free SDK declaration. API version: **${version}**. Import the interfaces as TypeScript types; \`window.tabsExtension\` exists only in an active desktop extension main frame.

## Choosing an API

Use the injected bridge, not Electron imports or direct fetch. The host binds calls to the current installed package, project, and assigned profile; callers never supply those identities. A capability in the manifest requests access but does not grant it. Ask users to grant it in Tabs, and make denial an ordinary inline UI state.

### storage.get, storage.set, and storage.delete

Use these for non-secret account/profile state such as drafts or preferences. get takes a key and resolves to JSON or null when absent. set takes a key and JSON value and resolves without a value; delete takes a key and also resolves without a value. JSON excludes functions, undefined, binary objects, and cycles. The host chooses the assigned profile, so changing Work/Personal assignments does not merge documents. Use the credentials settings for tokens instead of storing them here.

### workspace.readText

Read a UTF-8 text file from the active project using a relative path, for example README.md. The promise resolves to its text. Do not pass an absolute path, traversal path, or a path from another project. There is no file-write, directory-listing, shell, or arbitrary filesystem API in this bridge. An unsupported project or denied grant must be shown as unavailable, not silently replaced with another project's data.

### git.status

Read the active project's branch and dirty flag. The method takes no arguments and resolves to an object containing branch and dirty; it does not return changed filenames or run caller-supplied commands. It is appropriate for a status indicator, not a general Git client.

### network.getText

Send an HTTPS GET to an exact declared network host and resolve to text. The only option is useProfileCredential; it asks the trusted host to attach the active profile's saved Bearer credential. There is no arbitrary method, header, redirect, or credential-read API. Treat service failures as retryable UI states without logging credentials or response bodies containing account secrets.

### logic.invoke

Pass a declared command ID and JSON input to packaged pure logic; the promise resolves to JSON output. This is not a privileged background extension host. The logic runtime cannot call storage, workspace, Git, network, or credentials. AI exposure additionally depends on the manifest contribution and project grant; invoking a command from the UI does not imply it is available to an agent.

## Lifecycle and failure handling

Read data again after a host-owned reload or project/profile change. Do not assume that a previously granted call remains authorized: uninstall, disable, revocation, and assignment changes can invalidate it. Catch rejected promises, retain unsaved UI input where possible, and explain which host setting the user should check. Raw exception messages are not stable API error codes. Do not repeatedly retry a permission denial or treat authentication expiry as package revocation.

## Manifest contract

\`\`\`ts
export const TabsExtensionManifest = Schema.Struct({${fields}
\`\`\`

## Public API declarations

\`\`\`ts
${declarations}
\`\`\`

## Method limits and failure behavior

| Method | Required grant | Result and limits |
| --- | --- | --- |
| storage.get/set/delete | profile-storage | Non-secret JSON; each value at most 64 KiB, each profile document at most 1 MiB. Keys match [a-zA-Z][a-zA-Z0-9._-]{0,127}. Missing keys return null. |
| workspace.readText | workspace-read | Active project relative UTF-8 path; at most 1 MiB. Traversal and escaping links rejected. |
| git.status | git-status | Only branch and dirty state; no caller paths or Git commands. |
| network.getText | network | HTTPS GET to an exact declared host; no redirects, caller headers, or private-address access; 1 MiB text maximum, 15-second request deadline. |
| network.getText with useProfileCredential | network and credentials | Host attaches active profile Bearer token; bridge never returns the saved token directly. |
| logic.invoke | declared logic command | JSON input/output at most 64 KiB each; source at most 256 KiB; default 3-second outer watchdog; no privileged brokers. |

All privileged calls reject when the active identity, project, profile, or grant becomes invalid. Handle errors with readable inline status and retry controls; do not depend on raw host error strings as stable API codes.

## Storage examples

These examples require the listed manifest capabilities and current project grants; the zero-permission starter deliberately cannot call privileged methods yet. Keep account tokens out of this non-secret storage.

\`\`\`ts
await window.tabsExtension.storage.set("draft", { text: "A local note" });
const draft = await window.tabsExtension.storage.get("draft");
await window.tabsExtension.storage.delete("draft");
\`\`\`

## Read-only Git

Request git-status and API >=1.5.0. The host chooses the active project; no command or repository path is accepted from the extension.

\`\`\`ts
const { branch, dirty } = await window.tabsExtension.git.status();
console.log(branch, dirty);
\`\`\`

## Network and credentials

Declare network and the exact networkHosts entry, then request a project grant. The URL below is an illustrative service, not a Tabs endpoint. Credential use additionally needs credentials and a token set through the active host profile's credential settings; the token is never returned to extension JavaScript.

\`\`\`ts
const publicText = await window.tabsExtension.network.getText("https://api.example.com/status");
const accountText = await window.tabsExtension.network.getText("https://api.example.com/me", {
  useProfileCredential: true,
});
\`\`\`

## Pure logic

Declare a packaged logic entry and a command named sum. Its synchronous run implementation receives JSON; it cannot call privileged SDK methods. This example assumes your command implements that sum operation.

\`\`\`ts
const result = await window.tabsExtension.logic.invoke("sum", { values: [1, 2, 3] });
\`\`\`

## Workspace errors

\`\`\`ts
try {
  const text = await window.tabsExtension.workspace.readText("README.md");
  // Render as text, never unsanitized HTML.
  console.log(text.length);
} catch {
  // Show a visible error and explain the required project permission.
}
\`\`\`

Publisher/name must match \`^[a-z][a-z0-9-]{1,62}$\`. Listing metadata requires engines.api starting at 1.6.0. README is a packaged .md path; listing icons are PNG/JPEG/WebP. Categories and keywords have at most 12 unique lowercase tags. A license identifier declares a license; it does not replace the license text or third-party notices.
\`listing.screenshots\` requires an API minimum of 1.7.0. Supply at most six unique packaged raster paths with nonempty accessible descriptions: \`[{ "path": "preview.png", "alt": "Project board showing pending tasks" }]\`. Stage those PNG/JPEG/WebP files with the package; each is limited to 1 MiB. Remote paths, SVG, traversal, duplicate paths, and missing descriptions are rejected. Scanning validates advertised image bytes before manual review. Only signed, approved releases expose preview assets by numeric index.
`,
  },
  {
    slug: "permissions",
    title: "Permissions & profiles",
    body: `# Permissions and account profiles

Installation is one package version per environment. Enablement, toolbar ordering, grants, and account profile assignments are independent project controls.

Declare only required capabilities in the manifest. Users grant each privileged capability separately per project. A shared account profile does not automatically grant project access.

Named Work/Personal profiles have separate credentials and data. Shared profiles deliberately share non-secret profile storage across assigned projects. Project-isolated profiles keep separate namespaces for each project. Assigning another profile never merges its data.

Store non-secret values through the storage bridge; put service tokens in host-managed credential settings. Tokens are encrypted with OS-backed safe storage. Never embed credentials in packaged source. Linux insecure basic_text credential storage is refused.

The publisher's GitHub account and registry download tokens are not an extension account profile. Registry credentials must not be exposed through the extension bridge.

Permission denial, disabled tools, project changes, and stale requests must fail visibly. A request already delivered to a remote service cannot be undone by revoking its grant.
`,
  },
  {
    slug: "logic",
    title: "Logic & AI tools",
    body: `# Optional logic and AI tools

UI-only tools need no logic runtime. Optional packaged logic exports a synchronous global \`run(input)\`; declare its entry and commands in the manifest. \`window.tabsExtension.logic.invoke\` invokes the extension's own command.

Each invocation uses a disposable QuickJS worker, bounded JSON, an 8 MiB heap, 512 KiB stack, inner interrupt, and outer watchdog. Logic cannot access Node, network, workspace, credentials, or the UI bridge. Cancellation and runtime failures reject the operation.

Marking a command aiCallable also requires the ai-tools capability and a separate project grant. Tabs exposes the pure command through its project-scoped MCP integration. Start a fresh provider session after changing tool grants. Do not claim universal provider compatibility: mock wiring tests do not replace live provider verification.

Persistent background services, privileged AI operations, native binaries, and workspace mutation brokers are unsupported. External native ACP agents use a separate trust/install flow.
`,
  },
  {
    slug: "publishing",
    title: "Publish an extension",
    body: `# Publish an extension

Public official publishing is closed until production readiness gates pass. A configured self-hosted development registry can exercise the flow independently.

1. Sign in to the registry publisher dashboard with GitHub.
2. Read and explicitly accept its publisher terms; create a namespace matching the manifest publisher. Namespace membership does not prove verified ownership.
3. Build, validate, pack, and inspect the .tabsext archive locally. The archive limit is 25 MiB.
4. Select or drag the package into the publisher upload area. Its identity is read from the validated manifest; the server checks membership.
5. Follow its scan and review status. Uploaded bytes stay private. Every version needs manual exact-digest approval.
6. Approval awaiting signing is not publication. Only approved versions in signed registry targets become publicly available.

## CLI publishing

Create a namespace-scoped publish token in your dashboard. Store it in your terminal environment or CI secret store, never in source, URLs, or shell history commands containing the secret. Tokens expire after 30 days and can be revoked.

\`\`\`sh
tabsext registry --registry https://your-registry.example
tabsext publish my-publisher.my-tool-0.1.0.tabsext --registry https://your-registry.example
tabsext status my-publisher my-tool 0.1.0 --registry https://your-registry.example
tabsext status my-publisher my-tool 0.1.0 --registry https://your-registry.example --watch
\`\`\`

Set TABS_EXCHANGE_TOKEN through your environment's secret mechanism before publish/status. Website and CLI submit to the same API. A token cannot bypass namespace checks, scans, reviewer approval, or signing.

Watching checks every five seconds and stops at rejection, revocation, or signed publication. Approval alone remains pending. The default watch deadline is 15 minutes; use --watch-timeout with 1–3600 seconds to change it. Ctrl+C cancels without changing the submission. A deadline is not rejection: reconnect with status later. With --json --watch, each change is one JSON line.

The registry hosts package objects; authors do not need their own download server. Disclose external services, data use, support/privacy links, and external charges. Closed-source submissions are allowed; Tabs has no marketplace checkout. Review is not a security guarantee.
`,
  },
  {
    slug: "updates",
    title: "Updates & removal",
    body: `# Updates and removal

Keep publisher/name stable and increase the semantic version. Never overwrite an existing version with different bytes. Build, test previous profiles, validate, pack, and submit every release for new review and signed publication.

Desktop verifies signed metadata, package length/digest, compatibility, and archive contents. New permissions require consent. Pinning suppresses background update discovery, not revocation checks. Experimental automatic updates are opt-in, permission-neutral, and apply at a safe inactive boundary.

Declarative storage migrations rename bounded profile-storage keys with backup/rollback at first activation. They do not roll back credentials, IndexedDB, or arbitrary data changes after successful activation. Test migration collisions and interrupted activation.

Disable stops tools while preserving data. Uninstall asks separately about profile/data retention; no silent account-data deletion. Registry-origin identity prevents another same-named registry package from inheriting credentials.

Signed revocation is different from an expired registry access token. Reconnect for authentication failures. A private registry cannot remotely erase previously downloaded packages.
`,
  },
  {
    slug: "registry",
    title: "Registry API & clients",
    body: `# Registry API and compatible clients

Tabs-native /v1 is not the VS Code gallery API. Read the registry's /v1/registry capabilities and /v1/openapi.json reference. Search, versions, and raw downloads are discovery/inspection interfaces, not installation authority.

On the Exchange, use the [browsable API reference](/docs/extensions/registry-api) to inspect operations, parameters, limits, and response descriptions. It is generated from the same OpenAPI contract served by the registry; use the JSON contract for client generation.

Public browsing/download require no account. Private instances require an allowed GitHub account or an expiring read token. Clients send credentials only in Authorization headers to the exact configured HTTPS registry origin; never follow redirects with credentials.

## Trust configuration

Configure TABS_EXCHANGE_ORIGIN, TABS_EXCHANGE_TRUST_ROOT_PATH, TABS_EXCHANGE_TRUST_ROOT_SHA256, and TABS_EXCHANGE_TRUST_ID independently of the catalog. An operator must distribute the initial root out of band. Root rotation follows TUF; do not replace the trust identity on routine key rotation.

Private registry authentication and signed integrity are separate requirements. Store desktop read tokens using OS-backed secure storage through the host registry connection settings. Never expose them to packaged extension code. A token is not a signing key.

With a scoped read token in TABS_EXCHANGE_TOKEN, use \`tabsext search dashboard --registry https://your-registry.example\` to browse private listings. Catalog output is only a discovery hint; this CLI does not bypass the desktop's signed installer.

Compatible forks may use the documented public format/API and independently configured trust root. Marketplace access is free for individuals, OSS, and commercial clients, subject to abuse controls. No ratings, federation, or Open VSX VSIX interoperability is promised.
`,
  },
  {
    slug: "self-hosting",
    title: "Self-hosting & operations",
    body: `# Self-hosting and operations

The registry API/worker are separate from the static website. Deployment uses PostgreSQL and private S3-compatible object storage. Render/R2 are defaults, not protocol requirements.

## Local Docker setup

In a Tabs source checkout, copy apps/exchange/.env.example to a private .env and replace placeholders. Register a GitHub OAuth application with the registry /auth/github/callback URL. Use a unique URL-safe PostgreSQL password, a private object bucket, and operator-owned terms. Never commit .env or signing keys.

\`\`\`sh
cd tabs-main/apps/exchange
cp .env.example .env
# Edit .env before proceeding; keep submissions disabled.
docker compose config
docker compose up --build -d
curl --fail http://localhost:8787/healthz
\`\`\`

Docker must be running; a configuration check is not a live deployment test. The same-origin registry /extensions page supports authenticated private browsing; /publisher is its account and submission portal. The static marketing site is a public presentation client, not a cross-site session portal. Configure HTTPS at the reverse proxy before handling real accounts or tokens.

Compose uses PostgreSQL and pinned SeaweedFS 4.48 with persistent private objects. Mandatory S3 credentials prevent anonymous access. Only the S3 port is exposed on loopback for operator backup; management/filer ports are not published. An authenticated bucket-readiness check gates startup. This single-node setup is not highly available; replication and production restore drills remain operator responsibilities.

## Private instances

Set EXCHANGE_VISIBILITY=private and EXCHANGE_ALLOWED_GITHUB_IDS to an explicit comma-separated numeric GitHub ID allowlist. Keep it separate from reviewer IDs. Allowlist removal invalidates registry access. Read tokens protect catalog/assets/download/signed-metadata transport; publish tokens are namespace-bound.

## Signing and launch gates

Keep EXCHANGE_PUBLISHING_ENABLED=false until terms, OAuth, storage, operator ownership, scanning, signing, and client trust-root distribution are ready. Signing keys remain outside the API/worker. Export the exact approved targets, sign root/targets/snapshot/timestamp with an established offline TUF tool, and submit the staged metadata to the verification gate:

\`\`\`sh
bun run tuf:export-targets
# Review the exported map and sign offline. Never invent signatures.
bun run tuf:publish /absolute/offline-signed-metadata
bun run verify:objects
\`\`\`

Set EXCHANGE_TUF_BOOTSTRAP_ROOT_SHA256 from an independently verified initial root. Distribute that root and digest to clients out of band. Subsequent root rotations must satisfy the previous and new thresholds. No official production keys are provisioned by these tools.

## Recovery and monitoring

Freeze writes by stopping API and worker. Export PostgreSQL with pg_dump -Fc and mirror the private bucket into a separate restricted backup directory. Record the trusted root identity, metadata versions, and object-verification report with the snapshot. Back up offline signing keys separately, with controlled access. Restore to a fresh database and private bucket, run pg_restore and object verification, and prove an independently pinned client can install before accepting writes.

The portable JSON backup deliberately excludes sessions, OAuth state, and access tokens. A full PostgreSQL restore contains old token hashes: revoke restored sessions and tokens before reconnecting users, so disaster recovery cannot resurrect revoked credentials. Never restore stale signed metadata to bypass client rollback protection; issue newer signed roles when recovering.

Monitor scan backlog, worker heartbeat, metadata expiry, API errors, and storage integrity. Drill revocation and dual-threshold root rotation against a throwaway client before production. For upgrades, freeze writes, capture a tested recovery set, deploy the matching API/worker version, run migrations, verify health and signed client behavior, then resume. The repository docs/exchange.md contains the full maintenance and recovery command sequences.

## Abuse limits

Uploads are at most 25 MiB, with two concurrent uploads per API process and a two-minute deadline. Catalog pages contain at most 100 records. Namespace and invitation actions require current terms and membership. Operators must configure reverse-proxy request/account limits and alerting before enabling a public service; the registry does not claim distributed rate limiting. Do not increase limits to work around abusive submissions.

Private responses must not enter shared caches. Package hosting costs belong to the operator even though marketplace access is free.
`,
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    body: `# Troubleshooting

| Symptom | Next step |
| --- | --- |
| npm cannot find SDK/CLI | They are unpublished; install the supplied local release tarballs. |
| Missing .tabs-extension | Run npm run build before validation/loading. |
| Invalid publisher/name | Use 2–63 lowercase letters/numbers/hyphens, beginning with a letter. |
| Unsupported engines.api or Tabs version | Check target version and SDK compatibility; never bypass validation. |
| Capability denied | Review the current project's grants and profile assignment in Settings. |
| No host bridge in a browser preview | The bridge exists only in a real active desktop extension view. |
| 401 from private registry | Reconnect with a current read token and confirm the GitHub allowlist. |
| CLI publishing denied | Check publish-token scope, namespace membership, and whether submissions are enabled. |
| Duplicate version | Increase semantic version; existing archive bytes are immutable. |
| Approved but absent from Explore | Operator must publish current signed target metadata. |
| Signed metadata expired/invalid | Operator must repair signing/freshness; this is not offline permission to bypass trust. |
| Rejected package | Inspect scan/reviewer reasons, correct the package, publish a new version, or use the appeal flow. |

When reporting a bug include CLI/SDK/Tabs versions, safe reproduction steps, and the non-secret digest. Never attach tokens, credentials, private packages, or workspace data without permission.
`,
  },
];
