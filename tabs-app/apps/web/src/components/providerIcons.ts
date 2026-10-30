import { BotIcon } from "lucide-react";
import {
  AntigravityIcon,
  ClaudeAI,
  CopilotIcon,
  CursorIcon,
  DroidIcon,
  GrokIcon,
  KiloIcon,
  OpenAI,
  OpenCodeIcon,
  OpenRouterIcon,
  type Icon,
} from "./Icons";

export const PROVIDER_BRAND_ICONS: Record<string, Icon> = {
  codex: OpenAI,
  claudeAgent: ClaudeAI,
  cursor: CursorIcon,
  copilot: CopilotIcon,
  grok: GrokIcon,
  opencode: OpenCodeIcon,
  kilo: KiloIcon,
  droid: DroidIcon,
  antigravity: AntigravityIcon,
  openrouter: OpenRouterIcon,
};
const aliases: Record<string, string> = {
  claude: "claudeAgent",
  claudeagent: "claudeAgent",
  openai: "codex",
  "factory-droid": "droid",
};
export function resolveProviderIcon(instanceId?: string, driver?: string): Icon {
  for (const value of [driver, instanceId]) {
    if (!value) continue;
    const key = aliases[value.toLowerCase()] ?? value;
    if (PROVIDER_BRAND_ICONS[key]) return PROVIDER_BRAND_ICONS[key];
    const token = value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .find((part) => PROVIDER_BRAND_ICONS[aliases[part] ?? part]);
    if (token) return PROVIDER_BRAND_ICONS[aliases[token] ?? token]!;
  }
  return BotIcon;
}
