# @tabs/extension-api

Public, dependency-free types for Tabs-native `.tabsext` extensions. This is
not the VS Code extension API. Import `TabsExtensionManifest` to type-check a
manifest object and `TabsExtensionHostBridge` to type-check a packaged UI. The
package also exports the current API version at runtime.

New manifests should set `engines.api` to `^1.2.0` when they use logic commands.
Older v1 manifests without this field remain compatible. The host validates both `engines.tabs` and
`engines.api` during local load and package inspection; importing these types
alone does not validate a manifest. Use the `tabsext` pack/inspect command for
validation.

The bridge is available only inside an active extension main frame. Each method
requires its manifest capability and the user's per-project grant. Calls reject
after the view, project, profile, or grant changes. `storage` is non-secret
JSON storage; `workspace.readText` is a scoped, read-only text broker; and
`network.getText` performs a bounded HTTPS GET to an exact declared host.
The optional `credentials` capability lets the host attach a saved Bearer token
to an approved HTTPS request without exposing the token through the bridge.
An optional `logic.entry` and `contributes.commands` expose pure, JSON-only
commands to the extension's own active UI through `logic.invoke(commandId,
input)`. Each invocation runs in a fresh bounded QuickJS worker; it has no
broker, Node, network, workspace, or credential access. There is no persistent
background service, workspace write, or AI tool API yet.

See `docs/extensions.md` in the Tabs repository for package and permission
details. The API version is independent of the Tabs desktop version.
