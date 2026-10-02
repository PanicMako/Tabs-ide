# @tabs/extension-api

Public, dependency-free types for Tabs-native `.tabsext` extensions. This is
not the VS Code extension API. Import `TabsExtensionManifest` to type-check a
manifest object and `TabsExtensionHostBridge` to type-check a packaged UI. The
package also exports the current API version at runtime.

New manifests should set `engines.api` to `^1.2.0` when they use logic commands,
or `^1.3.0` when marking a pure command `aiCallable: true`. Use `^1.4.0`
when declaring host-run `storage.version` and `storage.migrations` key renames.
Use `^1.5.0` when requesting the read-only `git-status` capability.
Use `^1.6.0` for listing metadata (README/icon paths, license identifier,
category/keyword slugs and external-service disclosure). README paths end in
`.md`; icons must be PNG, JPEG or WebP. These assets must be staged with the
package. SVG and remote listing images are not supported.
Use `^1.7.0` for `listing.screenshots`: at most six unique packaged PNG/JPEG/WebP
paths, each at most 1 MiB, paired with a nonempty `alt` description of at most
300 characters. For example: `screenshots: [{ path: "preview.png", alt: "Project board with pending tasks" }]`.
The scan worker checks declared image bytes before manual review; the website
loads them by manifest index only after signed publication. Older clients reject
this unsupported listing field rather than treating it as remote content.
Older v1 manifests without this field remain compatible. The host validates both `engines.tabs` and
`engines.api` during local load and package inspection; importing these types
alone does not validate a manifest. Use the `tabsext` pack/inspect command for
validation.

The bridge is available only inside an active extension main frame. Each method
requires its manifest capability and the user's per-project grant. Calls reject
after the view, project, profile, or grant changes. `storage` is non-secret
JSON storage; `workspace.readText` is a scoped, read-only text broker;
`git.status()` returns only the active project's branch and dirty state after
a separate project grant; and
`network.getText` performs a bounded HTTPS GET to an exact declared host.
The optional `credentials` capability lets the host attach a saved Bearer token
to an approved HTTPS request without exposing the token through the bridge.
An optional `logic.entry` and `contributes.commands` expose pure, JSON-only
commands to the extension's own active UI through `logic.invoke(commandId,
input)`. Each invocation runs in a fresh bounded QuickJS worker; it has no
broker, Node, network, workspace, or credential access. An `aiCallable` command
also requires the `ai-tools` capability and a separate project grant before
Tabs advertises it in that project's MCP tool list. The AI tool accepts one
JSON object named `input` and uses the same disposable runtime. There is no
persistent background service or workspace write API.

See `docs/extensions.md` in the Tabs repository for package and permission
details. The API version is independent of the Tabs desktop version.
