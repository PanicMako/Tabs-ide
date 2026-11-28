import type { DeviceComparisonDifference, DeviceComparisonTotal } from "@tabs/contracts";
import { observeTotal, type DeviceObservation } from "./DeviceComparisonSemantics.ts";
import type { Run, Step, TotalCheckpoint } from "./DeviceComparisonRun.ts";

export const sameTotal = (
  approved: DeviceComparisonTotal | undefined,
  total: DeviceComparisonTotal,
) =>
  approved?.sourceLabel === total.sourceLabel &&
  approved.targetLabel === total.targetLabel &&
  approved.currency === total.currency;

export const sourceAmount = (
  step: Step,
  timing: TotalCheckpoint["timing"],
  total: DeviceComparisonTotal,
) =>
  step.savedTotals
    ? step.savedTotals[timing]
    : observeTotal(step[timing], total.sourceLabel, total.currency);

export const verifyTotalAt = (
  run: Run,
  step: Step,
  timing: TotalCheckpoint["timing"],
  target: DeviceObservation,
): Omit<DeviceComparisonDifference, "step"> | undefined => {
  const total = run.total;
  if (!total) return;
  const { targetLabel, currency } = total.settings;
  const sourceTotal = sourceAmount(step, timing, total.settings);
  const targetTotal = observeTotal(target, targetLabel, currency);
  let difference: Omit<DeviceComparisonDifference, "step"> | undefined;
  if (sourceTotal && !targetTotal) {
    difference = {
      kind: "unobservable",
      reason: `Could not verify one ${currency} amount for “${targetLabel}” on the destination.`,
      sourceTotal: sourceTotal.display,
    };
  } else if (sourceTotal && targetTotal && sourceTotal.minor !== targetTotal.minor) {
    difference = {
      kind: "total",
      reason: "The totals differ.",
      sourceTotal: sourceTotal.display,
      targetTotal: targetTotal.display,
    };
  } else if (!sourceTotal && targetTotal !== undefined) {
    difference = {
      kind: "unobservable",
      reason:
        "The destination shows a total label at a step where the demonstration has no observable total.",
      ...(targetTotal === null ? {} : { targetTotal: targetTotal.display }),
    };
  }
  if (difference) total.pending = { step: run.index + 1, timing };
  else delete total.pending;
  return difference;
};
