import type {
  OrchestrationV2ShellThreadStatus,
  TeammateActivity,
  TeammateId,
  TeammateMood,
} from "@tabs/contracts";

/** What activity derivation reads from a thread shell; an unreadable thread is `null`. */
export interface ThreadActivityInput {
  readonly threadId: string;
  readonly kind: "home" | "look-around" | "worker";
  readonly status: OrchestrationV2ShellThreadStatus;
  readonly hasPendingRequest: boolean;
}

const ACTIVE = new Set<OrchestrationV2ShellThreadStatus>([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

export interface ActivityInput {
  readonly teammateId: TeammateId;
  readonly paused: boolean;
  readonly threads: ReadonlyArray<ThreadActivityInput>;
  /** Items currently set to needsYou. */
  readonly needsYouItems: number;
  /** A worker settled successfully within the "happy" window. */
  readonly recentlyHappy: boolean;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Mood priority: needsYou > error > thinking > working > happy > sleeping (paused) > idle.
 * "error" means the home chat's latest run failed, so the owner sees the teammate is stuck;
 * a failed worker surfaces through its item and a notification instead.
 */
export function deriveTeammateActivity(input: ActivityInput): TeammateActivity {
  const home = input.threads.filter((thread) => thread.kind === "home");
  const thinking = input.threads.filter(
    (thread) => thread.kind !== "worker" && ACTIVE.has(thread.status),
  ).length;
  const workers = input.threads.filter((thread) => thread.kind === "worker");
  const working = workers.filter((thread) => ACTIVE.has(thread.status)).length;
  const blockedWorkers = workers.filter((thread) => thread.hasPendingRequest).length;
  const needsYou = input.needsYouItems + blockedWorkers;
  const homeFailed = home.some((thread) => thread.status === "failed");

  let mood: TeammateMood;
  let label: string | undefined;
  if (needsYou > 0) {
    mood = "needsYou";
    label = `Needs you on ${plural(needsYou, "thing")}`;
  } else if (homeFailed) {
    mood = "error";
    label = "Couldn't finish its last turn";
  } else if (thinking > 0) {
    mood = "thinking";
    label = "Thinking";
  } else if (working > 0) {
    mood = "working";
    label = `Working on ${plural(working, "task")}`;
  } else if (input.recentlyHappy) {
    mood = "happy";
    label = "Work finished";
  } else if (input.paused) {
    mood = "sleeping";
    label = "Paused";
  } else {
    mood = "idle";
  }
  return {
    teammateId: input.teammateId,
    mood,
    ...(label === undefined ? {} : { label }),
    thinkingCount: thinking,
    workingCount: working,
    needsYouCount: needsYou,
  };
}
