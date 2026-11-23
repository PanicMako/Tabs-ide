/**
 * Single source of truth for the desktop app privacy notice.
 * Every claim here mirrors docs/privacy.md, docs/usage-analytics.md and
 * apps/server/src/telemetry. Edit it here and all concepts follow.
 */
export const effective = "November 23, 2026";
export const email = "tabsappinbox@gmail.com";
export const settingsPath = "Settings → General → Privacy";
export const toggleName = "Share basic usage analytics";

export const lede =
  "When basic usage analytics is enabled, Tabs sends a random installation ID, a small set of app details, and up to two daily activity markers to our PostHog project. PostHog also receives the source IP address of each request.";
export const ledeTwo =
  "Tabs’ analytics does not include your name, email, provider account, prompts, code, or files. You can turn it off in the app settings.";

export const markers = [
  { name: "tabs.installation.opened", when: "when the backend starts" },
  { name: "tabs.installation.active", when: "after foreground interaction, or after an agent request is successfully sent" },
];

/** What a marker carries. */
export const sent = [
  { k: "Installation ID", v: "A random UUID stored for one installation. It groups activity from that installation; Tabs does not link it to a name, email address, or provider account, and it is not a count of unique people." },
  { k: "App details", v: "Operating system, processor architecture, Tabs version, and server app type." },
  { k: "Timing", v: "A UTC day bucket, with a stable daily event ID so restarts and retries are deduplicated. Tabs sends up to two markers per active day." },
  { k: "Network", v: "PostHog receives the source IP address as part of the network request. Geographic enrichment and person profiles are disabled." },
  { k: "Destination", v: "The dedicated Tabs PostHog project, using its configured endpoint. The current default is PostHog US Cloud." },
];

export const notSent = [
  "Your name",
  "Email address",
  "Provider login",
  "Prompts or responses",
  "Source code",
  "File paths",
  "Repository names",
  "Browser or terminal contents",
  "Tokens or API keys",
  "Custom model names",
  "Attachment counts",
  "Precise interaction times",
];

export const notUsed = "Tabs does not use a browser analytics SDK, automatic event capture, session replay, or model/reasoning tracking for this analytics feature.";

export const analyticsParas = [
  "Tabs uses basic usage analytics to understand whether installations are active and which app versions and operating systems are in use. Analytics is enabled by default in builds that include the Tabs PostHog project configuration. If that configuration is absent, the app sends no Tabs-owned analytics.",
  "The analytics ID is a random UUID stored for one installation. It groups activity from that installation; it is not linked by Tabs to a name, email address, or provider account, and it does not represent a count of unique people.",
];

export const leavesOutParas = [
  "Tabs-owned analytics does not serialize your name, email, provider login, prompts or responses, source code, file paths, repository names, browser or terminal contents, tokens, API keys, custom model names, attachment counts, or precise interaction times.",
  notUsed + " Person profiles and PostHog geographic enrichment are disabled.",
];

export const controlsParas = [
  `In Tabs, open <strong>${settingsPath}</strong> and switch off <strong>${toggleName}</strong>. This stops future collection, drops unsent markers, and removes the local installation ID when the setting takes effect.`,
  "A request already in flight may finish. Turning analytics off does not delete events already delivered to PostHog. If you turn it back on, Tabs creates a new installation ID.",
  "If you launch Tabs from a terminal, setting <code>TABS_TELEMETRY_ENABLED=false</code> disables collection when the process starts.",
];

export const servicesParas = [
  "Tabs can send requests to AI providers and command-line agents that you connect and use. Those requests may contain the prompts, code, or other information you choose to provide. The provider receives them under its own terms and privacy practices; Tabs’ analytics setting does not control those services.",
  "Extensions may make their own network requests and collect telemetry independently. The embedded browser connects to the websites you open and stores their cookies in the selected Tabs profile. Git and GitHub features, sign-in, extension registry lookups, and update checks also need network access.",
];

export const storageParas = [
  "The random analytics ID is stored locally while analytics is enabled. Provider secrets use the secure-storage mechanisms available to the app on your platform.",
  "Analytics records already sent are held in the Tabs PostHog project and handled under that service’s retention and security settings. Turning off analytics removes the local ID but does not erase those delivered records. Tabs does not log analytics payloads when delivery fails.",
];

export const contactParas = [
  "Contact us about this notice, the information handled by Tabs-owned analytics, or a request to access or delete data. Please do not email passwords, API keys, or other secrets.",
];

export const connected = [
  { k: "AI providers and agents", v: "Receive what you choose to send, under their own terms." },
  { k: "Extensions", v: "May make their own requests and collect their own telemetry." },
  { k: "Embedded browser", v: "Connects to the sites you open and keeps their cookies in the selected profile." },
  { k: "Git, GitHub, sign-in, registry, updates", v: "Need network access to work." },
];

/** Full policy as ordered chapters, for concepts that render it as a document. */
export const chapters = [
  { id: "analytics", short: "Usage analytics", title: "Basic usage analytics", paras: analyticsParas },
  { id: "not-included", short: "What it leaves out", title: "What analytics leaves out", paras: leavesOutParas },
  { id: "controls", short: "Your controls", title: "Turn analytics off", paras: controlsParas },
  { id: "other-services", short: "Other services", title: "Services you choose to connect", paras: servicesParas },
  { id: "storage", short: "Storage and retention", title: "Storage and retention", paras: storageParas },
  { id: "contact", short: "Privacy requests", title: "Questions or privacy requests?", paras: contactParas },
];

export const title = "Tabs IDE Desktop App Privacy Policy";
export const description =
  "Learn what usage analytics the Tabs IDE desktop app sends, what stays on your device, which third-party services receive information, and how to turn analytics off.";
