// FILE: providerUsageDisplay.ts
// Purpose: Formatting helpers for quota pace, deficit percentage, time until reset, and token metrics.

import type { ServerProviderUsageLimit, ServerProviderUsageSnapshot } from "@tabs/contracts";
import { compactDuration, deriveUsagePace, type UsagePaceSummary } from "./usagePace";

export type ProviderUsageTone = "healthy" | "warning" | "danger";

export interface ProviderUsageDisplayLimit {
  readonly label: string;
  readonly remainingPercent: number;
  readonly usedPercent: number;
  readonly leftText: string;
  readonly resetText: string | null;
  readonly pace: UsagePaceSummary | null;
  readonly remainingTone: ProviderUsageTone;
  readonly paceTone: ProviderUsageTone;
}

export const PROVIDER_USAGE_TONE_CLASS_NAME: Record<ProviderUsageTone, string> = {
  healthy: "bg-emerald-500 dark:bg-emerald-400",
  warning: "bg-amber-500 dark:bg-amber-400",
  danger: "bg-rose-500 dark:bg-rose-400",
};

export const PROVIDER_USAGE_TONE_TEXT_CLASS_NAME: Record<ProviderUsageTone, string> = {
  healthy: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-rose-600 dark:text-rose-400",
};

function remainingTone(remainingPercent: number): ProviderUsageTone {
  if (remainingPercent <= 15) return "danger";
  if (remainingPercent <= 35) return "warning";
  return "healthy";
}

function paceTone(status: UsagePaceSummary["status"]): ProviderUsageTone {
  switch (status) {
    case "behind":
      return "danger";
    case "on-track":
      return "warning";
    case "ahead":
      return "healthy";
  }
}

export function formatResetCountdown(resetsAt: string | undefined): string | null {
  if (!resetsAt) return null;
  const resetMs = Date.parse(resetsAt);
  if (!Number.isFinite(resetMs)) return null;
  const deltaMs = resetMs - Date.now();
  if (deltaMs <= 0) return "Resetting now";
  const duration = compactDuration(deltaMs);
  return duration ? `Resets in ${duration}` : null;
}

export function deriveDisplayLimits(
  snapshot: ServerProviderUsageSnapshot,
): readonly ProviderUsageDisplayLimit[] {
  if (!snapshot.limits || snapshot.limits.length === 0) {
    return [];
  }

  return snapshot.limits.map((limit: ServerProviderUsageLimit) => {
    const usedPercent =
      limit.usedPercent !== undefined ? Math.max(0, Math.min(100, limit.usedPercent)) : 0;
    const remainingPercent = Math.max(0, Math.min(100, 100 - usedPercent));
    const resetsAt = limit.resetsAt;
    const windowDurationMins = limit.windowDurationMins;

    const pace = deriveUsagePace({
      remainingPercent,
      resetsAt,
      windowDurationMins,
    });

    const resetText = formatResetCountdown(resetsAt);
    const rTone = remainingTone(remainingPercent);
    const pTone = pace ? paceTone(pace.status) : rTone;

    return {
      label: limit.window,
      remainingPercent,
      usedPercent,
      leftText: `${Math.round(remainingPercent)}% left`,
      resetText,
      pace,
      remainingTone: rTone,
      paceTone: pTone,
    };
  });
}
