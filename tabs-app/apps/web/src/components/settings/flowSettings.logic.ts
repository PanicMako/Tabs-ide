import type { PullRequestMergeMethod } from "@tabs/contracts";

/** Days of inactivity before a thread is marked done on its own, with "never" as its own choice. */
export const AUTO_SETTLE_DAY_CHOICES: ReadonlyArray<number | null> = [null, 1, 3, 7, 14, 30, 90];

export function autoSettleLabel(days: number | null): string {
  if (days === null) return "Never";
  return days === 1 ? "After 1 day" : `After ${days} days`;
}

/** A stored value that is not one of the presets still shows, so opening Settings never rewrites it. */
export function autoSettleChoices(current: number | null): ReadonlyArray<number | null> {
  return AUTO_SETTLE_DAY_CHOICES.includes(current)
    ? AUTO_SETTLE_DAY_CHOICES
    : [...AUTO_SETTLE_DAY_CHOICES, current].toSorted(
        (left, right) => (left ?? 0) - (right ?? 0) || (left === null ? -1 : 1),
      );
}

export const FETCH_INTERVAL_CHOICES_MS: ReadonlyArray<number> = [
  15_000, 30_000, 60_000, 300_000, 900_000,
];

export function fetchIntervalLabel(ms: number): string {
  if (ms < 60_000) return `Every ${Math.round(ms / 1000)} seconds`;
  const minutes = Math.round(ms / 60_000);
  return minutes === 1 ? "Every minute" : `Every ${minutes} minutes`;
}

export function fetchIntervalChoices(currentMs: number): ReadonlyArray<number> {
  return FETCH_INTERVAL_CHOICES_MS.includes(currentMs)
    ? FETCH_INTERVAL_CHOICES_MS
    : [...FETCH_INTERVAL_CHOICES_MS, currentMs].toSorted((left, right) => left - right);
}

export type MergeMethodChoice = "ask" | PullRequestMergeMethod;

export const MERGE_METHOD_LABELS: Record<MergeMethodChoice, string> = {
  ask: "Ask each time",
  merge: "Merge commit",
  squash: "Squash and merge",
  rebase: "Rebase and merge",
};

export const mergeMethodChoice = (value: PullRequestMergeMethod | null): MergeMethodChoice =>
  value ?? "ask";
export const mergeMethodFromChoice = (choice: MergeMethodChoice): PullRequestMergeMethod | null =>
  choice === "ask" ? null : choice;
