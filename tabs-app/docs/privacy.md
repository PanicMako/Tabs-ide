# Public-beta privacy

Tabs-owned product analytics is off by default. To opt in explicitly, start Tabs
with `TABS_TELEMETRY_ENABLED=true` in its environment. There is currently no UI
consent setting. Remove that variable or set it to `false`, then restart, to opt
out. On startup with analytics disabled, Tabs removes its saved analytics ID;
a later opt-in generates a new random installation UUID. It never reads Codex,
Claude, or other provider account files to identify analytics users.

Opted-in analytics is pseudonymous, not anonymous. Batches go to PostHog at
`https://us.i.posthog.com` by default. They contain operational event names,
installation UUID, OS platform, architecture, Tabs version, and client type.
Allowed event properties are provider kind, bounded operation/approval enums,
boolean capability/presence flags, and nonnegative integer usage counts.
Custom model names, source, prompts, terminal/browser contents, paths, repository
names, provider account IDs, tokens, API keys, and arbitrary properties are not
serialized. Request payloads are not logged on analytics failure.

This setting controls Tabs-owned analytics only. Configured provider APIs and
CLIs send requests under their own policies; extensions may make network
requests and collect telemetry independently. The embedded browser connects to
the sites you open and stores cookies in its selected Electron profile. Git and
GitHub integrations, authentication, extension registry lookups, and automatic
update checks also require network traffic. Disabling analytics does not disable
these functions or establish that every bundled extension sends no telemetry.

Provider secrets use the existing secure-storage mechanisms; platform support
and migrations must be considered separately from analytics consent. Before
sharing diagnostics or logs, remove credentials, private source/prompts,
cookies, sensitive terminal output, and private repository URLs.
