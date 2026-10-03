# v1.3.31 Public Beta manual QA

Run this on final native installers before publication. `v1.3.31` is a plain
GitHub tag marked Pre-release; package versions remain `1.3.31` and
`tabsReleaseChannel` is `beta`. See [release.md](release.md) for exact build and
publication commands and secret requirements.

- [ ] Fresh profile: Public Beta identity; add an empty folder with spaces; Code
  opens an empty Explorer without a missing-file dialog; Testing is off.
- [ ] Open Code, Agents, Launchpad, Browser, and Git; create a terminal; restart
  and confirm project, active tool, terminal policy, and browser state restore.
- [ ] Dark and light themes, then near-black, white/light, yellow, cyan, blue,
  red, and purple accents: inspect ordinary neutral icons, filled controls,
  hover/selected/focus states, Launchpad empty/add-preset states, and Workspace
  settings. Use keyboard navigation through buttons, menus, and dialogs.
- [ ] Configure one CLI-auth provider and one supported API-key provider; test
  missing CLI and invalid credentials; remove/reset the key; inspect sanitized
  logs and support diagnostics for credentials or provider account identifiers.
- [ ] Disconnect backend/provider, choose an invalid/moved project path, exit a
  terminal, fail browser navigation and Git operations, then recover and restart
  with workspaces open. Confirm useful messages and working recovery actions.
- [ ] Fresh install: no Tabs-owned analytics requests or analytics identifier.
  Explicitly opt in with `TABS_TELEMETRY_ENABLED=true`, restart, verify expected
  PostHog traffic; unset it or set false and restart, verify no analytics and
  identifier removal. This does not control independent providers or websites.
- [ ] About displays `1.3.31`; click for beta channel, commit and runtime details;
  Report a Bug opens the issue form; Copy Diagnostics contains only safe build
  data. Review any larger support bundle before sharing.
- [ ] macOS: download normally with quarantine, install into Applications,
  observe the warning and use System Settings → Privacy & Security → Open
  Anyway. Do not use `xattr` for this test. Developer ID and notarization are
  intentionally absent for this beta.
- [ ] Fresh install and upgrade over the previous supported release on each
  native platform; verify credential/state continuity, browser persistence,
  Code-OSS startup and update/restart. Check Intel versus Apple Silicon payloads.
- [ ] GitHub says Pre-release, not Latest; all four installers, two mac ZIPs,
  Ed25519 JSON/signature, blockmaps, `beta*.yml` and compatibility `latest*.yml`
  are present, with correct versions, notes, digests and architecture.
- [ ] Homepage and downloads say Public Beta; no Stable claim; feed selects
  `v1.3.31`; arm64, x64, Windows, Linux, GitHub and help links work. Check the
  deployed site after the release-triggered website workflow completes.

Required non-Apple release secrets: `TABS_RELEASE_TOKEN` and
`TABS_MAC_UPDATE_PRIVATE_KEY` matching the embedded Ed25519 public key. Website
secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Secret names alone
do not prove validity; the release preflight checks the signing-key match. Apple
and Azure signing credentials are optional. Never silently rotate the update
key. Preserve upstream licenses and review the final bundled notices.
