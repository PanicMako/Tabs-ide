export interface BalanceCandidate {
  readonly environmentId: string;
  /** 0 to 100. Zero keeps a machine out of the rotation. */
  readonly weight: number;
}

export const DEFAULT_LOAD_BALANCING_WEIGHT = 50;

/** The weight to use for a machine: what was saved, or the default, kept to 0 to 100. */
export function weightFor(
  weights: Readonly<Record<string, number>>,
  environmentId: string,
): number {
  const value = weights[environmentId];
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LOAD_BALANCING_WEIGHT;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Picks a machine for a new conversation in proportion to the weights, so a
 * weight of 80 against 20 sends about four of five there. `random` is a number
 * from 0 up to (not including) 1. Returns null when every weight is zero.
 */
export function pickBalancedEnvironment(
  candidates: ReadonlyArray<BalanceCandidate>,
  random: number,
): string | null {
  const usable = candidates.filter((candidate) => candidate.weight > 0);
  const total = usable.reduce((sum, candidate) => sum + candidate.weight, 0);
  if (total === 0) return null;
  let point = Math.min(Math.max(random, 0), 0.999999999) * total;
  for (const candidate of usable) {
    if (point < candidate.weight) return candidate.environmentId;
    point -= candidate.weight;
  }
  return usable.at(-1)?.environmentId ?? null;
}

const SWITCH_QUIET_MS = 5_000;
let lastMachineSwitchAt: number | null = null;

/** A conversation just moved to another machine, by you or by balancing. */
export function markMachineSwitch(now = Date.now()): void {
  lastMachineSwitchAt = now;
}

/**
 * True right after a machine switch. The draft that switching opens must keep
 * the machine it was given instead of being balanced away again.
 */
export function justSwitchedMachine(now = Date.now()): boolean {
  return lastMachineSwitchAt !== null && now - lastMachineSwitchAt < SWITCH_QUIET_MS;
}

export function resetMachineSwitch(): void {
  lastMachineSwitchAt = null;
}
