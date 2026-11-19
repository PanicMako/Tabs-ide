import type { UsageSubTab, UsageWindowPreset } from "./usage";

export type UsageMetric = "cost" | "tokens";

export type UsageCommand =
  | "usage.open"
  | "usage.cost"
  | "usage.tokens"
  | "usage.limits"
  | "usage.period.day"
  | "usage.period.week"
  | "usage.period.month"
  | "usage.period.quarter";

export interface UsageCommandEffect {
  readonly tab: UsageSubTab;
  readonly metric?: UsageMetric;
  readonly window?: UsageWindowPreset;
}

/** What each usage shortcut changes on the Usage & Limits page. Every one of them opens it. */
export function usageCommandEffect(command: UsageCommand): UsageCommandEffect {
  switch (command) {
    case "usage.open":
      return { tab: "usage" };
    case "usage.cost":
      return { tab: "usage", metric: "cost" };
    case "usage.tokens":
      return { tab: "usage", metric: "tokens" };
    case "usage.limits":
      return { tab: "limits" };
    case "usage.period.day":
      return { tab: "usage", window: "24h" };
    case "usage.period.week":
      return { tab: "usage", window: "7d" };
    case "usage.period.month":
      return { tab: "usage", window: "30d" };
    case "usage.period.quarter":
      return { tab: "usage", window: "90d" };
  }
}

export function isUsageCommand(command: string): command is UsageCommand {
  return command === "usage.open" || command.startsWith("usage.");
}
