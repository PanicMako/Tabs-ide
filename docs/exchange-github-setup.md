# GitHub sign-in setup for the owner

PanicMako (GitHub account ID `121330302`) is the user-confirmed owner/operator.
The ignored, private `apps/exchange/.env.local` records that bootstrap identity.
Real GitHub sign-in has now succeeded on the isolated local registry. The
reviewer-access page identifies PanicMako as Operator. Logout removed privileged
access, and a fresh GitHub sign-in restored it.

GitHub OAuth lets people sign in to Exchange with their existing GitHub account.
It does not give reviewers ownership of your GitHub account or repositories.
Exchange's login requests no repository scopes. Reviewer roles are stored by
Exchange separately from GitHub authorization.

## Local acceptance OAuth app

Created with the owner’s confirmation: [Tabs Exchange — local acceptance](https://github.com/settings/applications/3902038), owned by PanicMako. The public Client ID is saved locally. The owner generated and saved the client secret privately. Its presence and successful OAuth use were verified without displaying it.

The registered values are:

| GitHub field               | Value                                        |
| -------------------------- | -------------------------------------------- |
| Application name           | Tabs Exchange — local acceptance             |
| Homepage URL               | `http://localhost:8787`                      |
| Application description    | Local testing of Tabs Exchange sign-in       |
| Authorization callback URL | `http://localhost:8787/auth/github/callback` |
| Enable Device Flow         | Leave disabled                               |

On the registered app’s settings page, generate a client secret. The owner should perform
the credential-generation and entry steps. Put the Client ID and client secret
into `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in the local file above, using
a local editor. Do not paste the secret into chat, commit it, or put it into
frontend/public configuration. Tell Codex only that the fields have been saved.

This file is Git-ignored and has mode 0600. The public frontend preview on port
4331 is a different process; creating the OAuth app will not make that preview's
account API work. Run `bun run --cwd apps/exchange acceptance:local` to use the dedicated loopback
test PostgreSQL/S3 services. The launcher creates and retains isolated resource
identities in `.test-data/exchange-real-github/state.json`, validates the private
owner configuration, and refuses fixture authentication or remote services.
The local configuration keeps submissions disabled until the acceptance
workflow is deliberately enabled. No deployment is implied.

Use a separate OAuth app for the eventual HTTPS production origin. The current GitHub form allows multiple redirect URIs; this local app has only
the exact localhost callback, with wildcard matching disabled. The production
origin is still unprovisioned. No extra
domain purchase is required to use a subdomain of `buildwithtabs.com`.

## Give friends access below the owner

After real sign-in, the operator sees **Reviewer access** (`/admin/reviewers`).
A friend first signs in to establish an Exchange account. The operator grants
reviewer access using their GitHub username and records a reason. Reviewers
can scan/review/reject/approve/revoke packages and manage registry security
controls; they cannot grant or revoke other reviewers. The operator can remove
reviewer access and inspect its grant/revoke audit history. Review approval is
still separate from signed publication; neither role owns signing keys in the
API process.

The local acceptance instance is private. Add an invited friend's numeric ID to
`EXCHANGE_ALLOWED_GITHUB_IDS` before they can sign in there. This is distinct
from granting reviewer authority. Do not add friends to the operator bootstrap
list unless they are deliberately being made equal owners.

References: [GitHub: creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app),
[GitHub: authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).
