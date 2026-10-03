import type { Thread } from "../types";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  isLatestTurnSettled,
} from "../session-logic";
import { hasUnseenCompletion, isThreadWorking } from "../components/Sidebar.logic";

export type TabActivityType = "waiting-input" | "pending-approval" | "completed";

export interface TabActivityIndicator {
  type: TabActivityType;
  label: string;
  dotClass: string;
  pulse: boolean;
}

/**
 * Resolves the tab activity indicator for a set of threads belonging to a project.
 *
 * Rules:
 * 1. If any thread is awaiting user input (question asked by agent) -> amber pulsing dot.
 * 2. If any thread is awaiting approval -> amber pulsing dot.
 * 3. If any thread is actively working/running -> null (NO green dot while working).
 * 4. If all work has settled, no active questions exist, and any thread completed its task
 *    and has not been viewed yet (`completedAt > lastVisitedAt`) -> emerald dot.
 * 5. Otherwise (quiet / already viewed / no active questions) -> null (no dot).
 */
export function resolveTabActivityIndicator(
  threads: ReadonlyArray<Thread>,
): TabActivityIndicator | null {
  if (threads.length === 0) return null;

  // Priority 1: User input requested by agent (questions, choices)
  for (const thread of threads) {
    if (derivePendingUserInputs(thread.activities ?? []).length > 0) {
      return {
        type: "waiting-input",
        label: "Agent waiting for input",
        dotClass: "bg-amber-500 shadow-sm shadow-amber-500/50 ring-1 ring-amber-400/40",
        pulse: true,
      };
    }
  }

  // Priority 2: Approvals pending (e.g. tool/execution approval)
  for (const thread of threads) {
    if (derivePendingApprovals(thread.activities ?? []).length > 0) {
      return {
        type: "pending-approval",
        label: "Pending approval",
        dotClass: "bg-amber-500 shadow-sm shadow-amber-500/50 ring-1 ring-amber-400/40",
        pulse: true,
      };
    }
  }

  // If ANY thread in the project is currently working, suppress completion indicator.
  // The user should never see a green dot while work is actively running.
  if (threads.some((thread) => isThreadWorking(thread))) {
    return null;
  }

  // Priority 3: Task completed, turn settled, and not yet viewed
  let hasCompleted = false;
  for (const thread of threads) {
    if (
      thread.latestTurn?.state === "completed" &&
      isLatestTurnSettled(thread.latestTurn, thread.session) &&
      hasUnseenCompletion(thread)
    ) {
      hasCompleted = true;
      break;
    }
  }

  if (hasCompleted) {
    return {
      type: "completed",
      label: "Task completed",
      dotClass: "bg-emerald-500 shadow-sm shadow-emerald-500/50 ring-1 ring-emerald-400/40",
      pulse: false,
    };
  }

  return null;
}
