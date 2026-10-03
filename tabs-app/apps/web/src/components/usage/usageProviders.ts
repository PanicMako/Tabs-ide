import type { UsageProviderKind } from "@tabs/contracts";

import {
  AntigravityIcon,
  ClaudeAI,
  CopilotIcon,
  CursorIcon,
  DroidIcon,
  GrokIcon,
  type Icon,
  KiloIcon,
  OpenAI,
  OpenCodeIcon,
  OpenRouterIcon,
} from "../Icons";

export type UsageProviderPresentation = {
  readonly label: string;
  readonly color: string;
  readonly mark: Icon;
};

/**
 * Exhaustive presentation for providers supported by the usage contract.
 * Declaration order is reused by every chart and table, so adding a provider
 * only requires its contract support and one entry here.
 */
export const PROVIDER_PRESENTATION = {
  codex: {
    label: "Codex",
    color: "var(--contrast-foreground)",
    mark: OpenAI,
  },
  claude: {
    label: "Claude Code",
    color: "#d97757",
    mark: ClaudeAI,
  },
  cursor: {
    label: "Cursor",
    color: "#6e56cf",
    mark: CursorIcon,
  },
  copilot: {
    label: "GitHub Copilot",
    color: "#58a6ff",
    mark: CopilotIcon,
  },
  grok: {
    label: "Grok Build",
    color: "color-mix(in oklab, var(--contrast-foreground) 72%, var(--background))",
    mark: GrokIcon,
  },
  opencode: {
    label: "OpenCode",
    color: "#22c55e",
    mark: OpenCodeIcon,
  },
  droid: {
    label: "Droid",
    color: "#06b6d4",
    mark: DroidIcon,
  },
  kilo: {
    label: "Kilo",
    color: "#f59e0b",
    mark: KiloIcon,
  },
  antigravity: {
    label: "Antigravity",
    color: "#a855f7",
    mark: AntigravityIcon,
  },
  openrouter: {
    label: "OpenRouter",
    color: "#6366f1",
    mark: OpenRouterIcon,
  },
} satisfies Record<UsageProviderKind, UsageProviderPresentation>;

/** Stable provider reading order across charts, summaries, tables, and hover rows. */
export const PROVIDER_ORDER = Object.keys(PROVIDER_PRESENTATION) as UsageProviderKind[];

/** Providers with real activity, independent of the metric currently displayed. */
export function providersWithUsage(
  totals: readonly {
    readonly provider: UsageProviderKind;
    readonly costUsd: number;
    readonly totalTokens: number;
  }[],
): readonly UsageProviderKind[] {
  const active = new Set(
    totals
      .filter((entry) => entry.totalTokens > 0 || entry.costUsd > 0)
      .map((entry) => entry.provider),
  );
  return PROVIDER_ORDER.filter((provider) => active.has(provider));
}
