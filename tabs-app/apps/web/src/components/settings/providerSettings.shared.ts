export const PROVIDER_SETTINGS_KEYS = [
  "codex",
  "claudeAgent",
  "cursor",
  "copilot",
  "grok",
  "kiro",
  "fx",
  "opencode",
  "kilo",
  "droid",
  "antigravity",
  "openrouter",
  "pi",
  "muse",
] as const;

export type ProviderSettingsKey = (typeof PROVIDER_SETTINGS_KEYS)[number];
