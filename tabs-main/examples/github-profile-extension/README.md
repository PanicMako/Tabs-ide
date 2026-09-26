# GitHub Profile example

This Tabs-native UI-only extension displays the GitHub account selected for the
active project. It requests `network` and `credentials` for the exact host
`api.github.com`; it has no direct browser network access. The host sends a
saved Bearer token to GitHub's `GET /user` endpoint and returns the response.
The token is not present in the package or exposed through the extension bridge.

Load the folder from Settings > Extensions > Discover in a desktop development
build. Add named profiles such as Work and Personal in Profiles & Permissions.
Save a separate fine-grained GitHub personal access token for each profile,
assign profiles to projects, and grant both network and credential use for each
project. GitHub documents that `GET /user` needs no fine-grained token
permissions; use a minimally scoped token and avoid a broad classic token.
The extension will display the assigned account when you select its toolbar
tool and press **Load assigned account**. If a grant or token is missing, the
status message explains the failure.

The endpoint and token guidance are from [GitHub's REST user API](https://docs.github.com/en/rest/users/users)
and [credential security guidance](https://docs.github.com/en/rest/authentication/keeping-your-api-credentials-secure).
The service can reflect submitted credentials in a response; only use tokens
for services you trust. This example has no background runtime or AI-callable
operation.

Validate and package it with:

```sh
bun packages/extension-package/src/cli.ts validate examples/github-profile-extension --tabs-version 1.3.17
bun packages/extension-package/src/cli.ts pack examples/github-profile-extension /tmp/github-profile.tabsext --tabs-version 1.3.17
```
