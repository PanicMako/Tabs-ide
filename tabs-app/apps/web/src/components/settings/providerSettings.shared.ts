export const PROVIDER_SETTINGS_KEYS = [
  "codex",
  "claudeAgent",
  "cursor",
  "copilot",
  "grok",
  "opencode",
  "kilo",
  "droid",
  "antigravity",
  "openrouter",
] as const;

export type ProviderSettingsKey = (typeof PROVIDER_SETTINGS_KEYS)[number];
