// Adapted from Orca (MIT, (c) 2026 Lovecast Inc.) — src/main/bots/bot-look-around-schedule.ts, src/shared/bots/bot-look-around.ts
import type { TeammateLookAroundPreset } from "@tabs/contracts";

/** Local hours each preset looks at; nothing runs at night. */
export const LOOK_AROUND_HOURS: Record<TeammateLookAroundPreset, ReadonlyArray<number>> = {
  every4h: [8, 12, 16, 20],
  every2h: [8, 10, 12, 14, 16, 18, 20],
  twiceDaily: [8, 13],
  mornings: [8],
};

/** A look started this soon before a slot, such as "Look now", stands in for it. */
export const LOOK_RECENT_MS = 60 * 60 * 1000;

const startOfLocalDay = (at: number): number => {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

/** The most recent slot at or before `now`, today only; null before the day's first slot. */
export function latestSlotAtOrBefore(preset: TeammateLookAroundPreset, now: number): number | null {
  const day = startOfLocalDay(now);
  let latest: number | null = null;
  for (const hour of LOOK_AROUND_HOURS[preset]) {
    const slot = new Date(day);
    slot.setHours(hour, 0, 0, 0);
    if (slot.getTime() <= now) latest = slot.getTime();
  }
  return latest;
}

/** The first slot strictly after `now`, today or tomorrow. */
export function nextSlotAfter(preset: TeammateLookAroundPreset, now: number): number {
  const day = startOfLocalDay(now);
  for (let offset = 0; offset < 2; offset += 1) {
    for (const hour of LOOK_AROUND_HOURS[preset]) {
      const slot = new Date(day);
      slot.setDate(slot.getDate() + offset);
      slot.setHours(hour, 0, 0, 0);
      if (slot.getTime() > now) return slot.getTime();
    }
  }
  throw new Error("unreachable: a preset always has a slot within two days");
}

/**
 * The slot due now, or null. A slot the machine slept through is caught up the same day until the
 * next slot; a slot before the setting was turned on is never caught up; a look started within the
 * last hour stands in for it.
 */
export function lookAroundDueSlot(input: {
  readonly preset: TeammateLookAroundPreset;
  /** When looking around was last turned on (or the teammate created). */
  readonly armedAt: number;
  readonly lastLookAt: number | null;
  readonly now: number;
}): number | null {
  const slot = latestSlotAtOrBefore(input.preset, input.now);
  if (slot === null) return null;
  if (slot < input.armedAt) return null;
  if (
    input.lastLookAt !== null &&
    (slot <= input.lastLookAt || slot - input.lastLookAt < LOOK_RECENT_MS)
  ) {
    return null;
  }
  return slot;
}
