import type { ServerProvider } from "@tabs/contracts";

export function isCompactCommandMessage(message: {
  readonly role?: string | undefined;
  readonly text?: string | undefined;
  readonly attachments?: readonly unknown[] | undefined;
}): boolean {
  const text = (message.text ?? "").trim().toLowerCase();
  return (
    message.role === "user" &&
    text === "/compact" &&
    !(message.attachments && message.attachments.length > 0)
  );
}

export function providerSupportsManualCompaction(
  provider: ServerProvider | null | undefined,
): boolean {
  if (!provider) return false;
  return (
    (provider.slashCommands?.some((command) => command.name === "compact") ?? false) ||
    provider.driver === "codex" ||
    provider.driver === "claudeAgent" ||
    provider.driver === "opencode" ||
    provider.instanceId === "codex" ||
    provider.instanceId === "claudeAgent" ||
    provider.instanceId === "opencode"
  );
}

export function formatContextWindowCompactionMessage(
  modelDisplayName?: string | null | undefined,
  autoCompactThreshold?: number | null | undefined,
): string {
  if (typeof autoCompactThreshold === "number" && autoCompactThreshold > 0) {
    return `Compacts automatically at ${autoCompactThreshold.toLocaleString("en-US")} tokens.`;
  }
  return modelDisplayName
    ? `Context for ${modelDisplayName} compacts automatically when needed.`
    : "Context compacts automatically when needed.";
}

export type ContextRoom = "roomy" | "filling" | "nearlyFull";

/** How much room is left, in words anyone can read at a glance. */
export function describeContextRoom(usedPercentage: number | null): {
  readonly level: ContextRoom;
  readonly label: string;
} {
  const used = usedPercentage ?? 0;
  if (used >= 85) return { level: "nearlyFull", label: "Almost full" };
  if (used >= 55) return { level: "filling", label: "Filling up" };
  return { level: "roomy", label: "Plenty of room" };
}

/** One short line on what happens when the window fills. */
export function formatAutoCompactHint(
  autoCompactThreshold: number | null | undefined,
  formatTokens: (value: number) => string,
): string {
  if (typeof autoCompactThreshold === "number" && autoCompactThreshold > 0) {
    return `Auto-compacts at ${formatTokens(autoCompactThreshold)}`;
  }
  return "Auto-compacts when full";
}

/* ---------- pip meter + auto-compact line ---------- */

export const PIP_COUNT = 40; // each pip = 2.5% of the window
export const THRESHOLD_MIN = 0.4; // the auto-compact line can sit anywhere from 40% to 100%
export const THRESHOLD_STEP = 1 / PIP_COUNT;
export const HOLD_TO_COMPACT_MS = 650;
const CLAUDE_AUTO_COMPACT_MIN_TOKENS = 100_000;
const CLAUDE_AUTO_COMPACT_MAX_TOKENS = 1_000_000;

/** Snap a 0-1 fraction into the allowed range; anything near the end means "when full". */
export function clampThresholdFraction(value: number): number {
  const clamped = Math.max(THRESHOLD_MIN, Math.min(1, value));
  return clamped > 0.985 ? 1 : clamped;
}

/** The fraction of the window the auto-compact line sits at (1 when it only fires when full). */
export function thresholdFraction(
  autoCompactThreshold: number | null | undefined,
  maxTokens: number | null | undefined,
): number {
  if (!autoCompactThreshold || !maxTokens || autoCompactThreshold <= 0 || maxTokens <= 0) {
    return 1;
  }
  return clampThresholdFraction(autoCompactThreshold / maxTokens);
}

/**
 * The Claude `autoCompactWindow` setting for a chosen line position: whole thousands of tokens
 * within Claude's accepted 100k-1M range, or "" to fall back to Claude's own default (when full).
 */
export function autoCompactSettingForFraction(fraction: number, maxTokens: number): string {
  const clamped = clampThresholdFraction(fraction);
  if (clamped >= 1) return "";
  const tokens = Math.round((clamped * maxTokens) / 1000) * 1000;
  return String(
    Math.max(CLAUDE_AUTO_COMPACT_MIN_TOKENS, Math.min(CLAUDE_AUTO_COMPACT_MAX_TOKENS, tokens)),
  );
}

/** Tokens left after a compaction: a fifth of what was there, never under 5k. */
export function tokensKeptAfterCompaction(usedTokens: number): number {
  return Math.max(5000, usedTokens * 0.2);
}

export interface PipState {
  readonly filled: boolean;
  /** Filled now, but will be freed by compacting (shown while previewing or holding). */
  readonly freed: boolean;
  readonly threshold: boolean;
  /** Empty and beyond the line: the zone where auto-compact will have fired. */
  readonly zone: boolean;
}

export function computePips(input: {
  readonly usedFraction: number;
  readonly thresholdFraction: number;
  readonly holdProgress: number;
  readonly previewing: boolean;
}): PipState[] {
  const used = Math.max(0, Math.min(1, input.usedFraction));
  const kept = tokensKeptAfterCompaction(used * 1_000_000) / 1_000_000;
  const shown = used - (used - kept) * input.holdProgress; // the bar shrinks while holding
  const filledCount = Math.round(shown * PIP_COUNT);
  const usedCount = Math.round(used * PIP_COUNT);
  const thresholdIndex = Math.round(input.thresholdFraction * PIP_COUNT) - 1;
  const ghost = input.previewing || input.holdProgress > 0;
  return Array.from({ length: PIP_COUNT }, (_, index) => ({
    filled: index < filledCount,
    freed: ghost && index >= filledCount && index < usedCount,
    threshold: index === thresholdIndex,
    zone: index > thresholdIndex && index >= filledCount,
  }));
}
