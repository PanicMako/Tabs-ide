# Public-beta privacy

Basic Tabs-owned usage analytics is enabled by default when a dedicated Tabs
PostHog project is configured. There is no consent popup. Turn off **Share basic
usage analytics** in **Settings > General > Privacy** to stop collection without
restarting. `TABS_TELEMETRY_ENABLED=false` disables collection at process start,
even when the setting is on. No project key means no collection or saved
analytics ID; Tabs never falls back to another project's key.

Analytics uses a random installation UUID and never reads Codex, Claude, or other
provider account files for identity. Turning analytics off drops unsent markers
and removes the saved UUID when the runtime next checks the setting (normally
within one second). Requests already in flight may finish; already delivered
records are not deleted. Re-enabling analytics creates a new UUID.

This is pseudonymous measurement: the UUID groups repeat activity from one
installation, without linking it to a name, email, or provider account. It does
not establish the number of unique people across devices or reinstallations.

Batches go to the dedicated Tabs PostHog project (`https://us.i.posthog.com` by
default). Only two day-level markers are delivered:

- `tabs.installation.opened`: the backend started that day.
- `tabs.installation.active`: a connected foreground client reported interaction,
  or an agent request was successfully sent that day.

Each marker uses a UTC date with a midnight timestamp and a stable daily event
UUID to deduplicate restarts and retries. Payload properties are limited to OS,
architecture, Tabs version, and server app type. Person profiles are disabled;
geographic enrichment is disabled. There is no browser analytics SDK,
autocapture, session replay, or model/reasoning tracking.

Caller-supplied event properties and all other operational events are excluded.
Names, email addresses, provider logins, custom model names, source, prompts,
terminal/browser contents, paths, repository names, tokens, API keys, attachment
counts, and precise interaction timestamps are not serialized. PostHog still
receives network requests and their source IPs; omitting identity fields does
not make transport anonymous. Request payloads are not logged on delivery failure.

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
