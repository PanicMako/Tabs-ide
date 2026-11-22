import {
  TEAMMATE_DEFAULT_NAME,
  TEAMMATE_NAME_MAX_LENGTH,
  type Teammate,
  type TeammateActivity,
  type TeammateFinish,
  type TeammateItem,
  type TeammateItemStatus,
  type TeammateLookAroundPreset,
  type TeammateMood,
  type TeammateNotice,
  type TeammateSuggestion,
  type TeammatesSnapshot,
} from "@tabs/contracts";

/** The next free "Notch", "Notch 2", "Notch 3"... name (case-insensitive). */
export function defaultTeammateName(existing: ReadonlyArray<{ readonly name: string }>): string {
  const taken = new Set(existing.map((teammate) => teammate.name.trim().toLowerCase()));
  if (!taken.has(TEAMMATE_DEFAULT_NAME.toLowerCase())) return TEAMMATE_DEFAULT_NAME;
  for (let n = 2; ; n += 1) {
    const candidate = `${TEAMMATE_DEFAULT_NAME} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Trims a typed name; null when it is empty, too long or unchanged. */
export function normalizeTeammateName(input: string, current?: string): string | null {
  const name = input.trim();
  if (name.length === 0 || name.length > TEAMMATE_NAME_MAX_LENGTH) return null;
  return name === current ? null : name;
}

const ITEM_ORDER: Record<TeammateItemStatus, number> = {
  needsYou: 0,
  working: 1,
  todo: 2,
  done: 3,
  dropped: 4,
};

export const ITEM_GROUP_LABELS: Record<TeammateItemStatus, string> = {
  needsYou: "Needs you",
  working: "Working",
  todo: "To do",
  done: "Done",
  dropped: "Dropped",
};

export interface ItemGroup {
  readonly status: TeammateItemStatus;
  readonly label: string;
  readonly items: ReadonlyArray<TeammateItem>;
}

/** Items for one teammate grouped by status, "Needs you" first, newest first inside a group. */
export function groupItems(
  items: ReadonlyArray<TeammateItem>,
  teammateId: string,
  options: { readonly includeClosed?: boolean } = {},
): ItemGroup[] {
  const groups = new Map<TeammateItemStatus, TeammateItem[]>();
  for (const item of items) {
    if (item.teammateId !== teammateId) continue;
    if (!options.includeClosed && (item.status === "done" || item.status === "dropped")) continue;
    const list = groups.get(item.status) ?? [];
    list.push(item);
    groups.set(item.status, list);
  }
  return [...groups.entries()]
    .toSorted(([a], [b]) => ITEM_ORDER[a] - ITEM_ORDER[b])
    .map(([status, list]) => ({
      status,
      label: ITEM_GROUP_LABELS[status],
      items: list.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    }));
}

/** Open suggestions first (newest first), then ones already started. */
export function sortSuggestions(
  suggestions: ReadonlyArray<TeammateSuggestion>,
  teammateId: string,
): TeammateSuggestion[] {
  return suggestions
    .filter(
      (suggestion) => suggestion.teammateId === teammateId && suggestion.status !== "dismissed",
    )
    .toSorted((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
}

export function openSuggestionCount(
  suggestions: ReadonlyArray<TeammateSuggestion>,
  teammateId: string,
): number {
  return suggestions.filter((s) => s.teammateId === teammateId && s.status === "open").length;
}

/** The activity row for a teammate, or a calm default when the server has not sent one yet. */
export function activityFor(
  activity: ReadonlyArray<TeammateActivity>,
  teammateId: string,
): Pick<TeammateActivity, "mood" | "needsYouCount" | "workingCount" | "thinkingCount"> & {
  label?: string | undefined;
} {
  const found = activity.find((entry) => entry.teammateId === teammateId);
  return (
    found ?? { mood: "idle", needsYouCount: 0, workingCount: 0, thinkingCount: 0, label: undefined }
  );
}

/** What the corner avatar shows: waiting-on-you work first, then suggestions to look at. */
export function badgeCount(
  activity: Pick<TeammateActivity, "needsYouCount">,
  openSuggestions: number,
): number {
  return activity.needsYouCount > 0 ? activity.needsYouCount : openSuggestions;
}

export function formatBadge(count: number): string {
  return count > 9 ? "9+" : String(count);
}

export function moodLabel(mood: TeammateMood, label?: string): string {
  if (label) return label;
  switch (mood) {
    case "thinking":
      return "Thinking";
    case "working":
      return "Working";
    case "needsYou":
      return "Needs you";
    case "happy":
      return "Finished something";
    case "error":
      return "Ran into a problem";
    case "sleeping":
      return "Paused";
    default:
      return "Idle";
  }
}

/** The teammate the UI is focused on: the remembered one if it still exists, else the first. */
export function resolveActiveTeammate<T extends { readonly id: string }>(
  teammates: ReadonlyArray<T>,
  preferredId: string | null,
): T | null {
  return teammates.find((teammate) => teammate.id === preferredId) ?? teammates[0] ?? null;
}

// ---------------------------------------------------------------- notices

export interface NoticeToast {
  readonly id: string;
  readonly type: "info" | "warning" | "error" | "success";
  readonly title: string;
  readonly description: string;
  readonly teammateId: string;
  readonly threadId: string | null;
}

export function noticeToToast(
  notice: TeammateNotice,
  teammates: ReadonlyArray<Pick<Teammate, "id" | "name">>,
): NoticeToast {
  const name = teammates.find((teammate) => teammate.id === notice.teammateId)?.name ?? "Notch";
  switch (notice.kind) {
    case "needsYou":
      return toast(notice, "warning", `${name} needs you`, notice.title);
    case "workDone":
      return toast(notice, "success", `${name} finished something`, notice.title);
    default:
      return toast(notice, "error", `${name} couldn't finish`, notice.title);
  }
}

function toast(
  notice: TeammateNotice,
  type: NoticeToast["type"],
  title: string,
  description: string,
): NoticeToast {
  return {
    id: notice.id,
    type,
    title,
    description,
    teammateId: notice.teammateId,
    threadId: notice.threadId,
  };
}

/**
 * Tracks which notice ids a client session already showed. The first snapshot only seeds the set
 * so old notices never toast; later snapshots return each unseen notice exactly once.
 */
export function createNoticeTracker() {
  const seen = new Set<string>();
  let seeded = false;
  return {
    next(notices: ReadonlyArray<TeammateNotice>): TeammateNotice[] {
      const fresh = notices.filter((notice) => !seen.has(notice.id));
      for (const notice of fresh) seen.add(notice.id);
      if (!seeded) {
        seeded = true;
        return [];
      }
      return fresh;
    },
    reset() {
      seen.clear();
      seeded = false;
    },
  };
}

// ---------------------------------------------------------------- labels

export const FINISH_OPTIONS: ReadonlyArray<{ id: TeammateFinish; name: string }> = [
  { id: "signature", name: "Blueprint" },
  { id: "blue-white", name: "Daybreak" },
  { id: "mono", name: "Carbon Copy" },
  { id: "ivory-ink", name: "Moonstone" },
  { id: "blue-ink", name: "Afterglow" },
  { id: "ember", name: "Ember" },
  { id: "brass", name: "Brass" },
  { id: "moss", name: "Moss" },
  { id: "tide", name: "Tide" },
  { id: "orchid", name: "Orchid" },
  { id: "rose", name: "Rosewood" },
  { id: "graphite", name: "Graphite" },
  { id: "sand", name: "Dune" },
];

/** The name of a finish; a colour picked on the dial is just "Custom". */
export function finishName(finish: TeammateFinish): string {
  return FINISH_OPTIONS.find((option) => option.id === finish)?.name ?? "Custom";
}

export const LOOK_AROUND_PRESET_LABELS: Record<TeammateLookAroundPreset, string> = {
  every4h: "Every 4 hours",
  every2h: "Every 2 hours",
  twiceDaily: "Twice a day",
  mornings: "Weekday mornings",
};

export function hiddenThreadSet(snapshot: Pick<TeammatesSnapshot, "hiddenThreadIds"> | null) {
  return new Set<string>(snapshot?.hiddenThreadIds ?? []);
}

// ---------------------------------------------------------------- plain-language status

type ActivityLike = Pick<
  TeammateActivity,
  "mood" | "needsYouCount" | "workingCount" | "thinkingCount"
>;

function things(count: number): string {
  return count === 1 ? "1 thing" : `${count} things`;
}

/** The one line under a teammate's name in the rail. */
export function railStatus(
  activity: ActivityLike,
  openSuggestions: number,
  paused: boolean,
): string {
  if (activity.needsYouCount > 0) return `Needs you on ${things(activity.needsYouCount)}`;
  if (activity.mood === "error") return "Ran into a problem";
  if (activity.workingCount > 0) return `Working on ${things(activity.workingCount)}`;
  if (activity.mood === "thinking") return "Thinking";
  if (paused) return "Paused";
  if (openSuggestions > 0)
    return `${openSuggestions} idea${openSuggestions === 1 ? "" : "s"} for you`;
  return "Free to help";
}

/** The sentence in the main header, written the way a person would say it. */
export function statusSentence(
  name: string,
  activity: ActivityLike,
  openSuggestions: number,
  paused: boolean,
): string {
  if (activity.needsYouCount > 0)
    return `${name} needs you on ${things(activity.needsYouCount)}. Start there.`;
  if (activity.mood === "error")
    return `${name} hit a problem in the last chat. Open it to see what happened.`;
  if (activity.workingCount > 0)
    return `${name} is working on ${things(activity.workingCount)} and will tell you when it is done.`;
  if (activity.mood === "thinking") return `${name} is thinking about your last message.`;
  if (activity.mood === "happy") return `${name} just finished something.`;
  if (paused) return `${name} is paused. It will not look around or start work until you resume.`;
  if (openSuggestions > 0)
    return `${name} has ${openSuggestions} idea${openSuggestions === 1 ? "" : "s"} for what to do next.`;
  return `${name} is free. Ask for something, or let it look around for work.`;
}

/** Needs-you count across every teammate, for the avatar badge when several exist. */
export function totalNeedsYou(activity: ReadonlyArray<Pick<TeammateActivity, "needsYouCount">>) {
  return activity.reduce((sum, entry) => sum + entry.needsYouCount, 0);
}

export interface WorkerState {
  readonly title: string;
  readonly running: boolean;
  readonly failed: boolean;
}

/** One line for an item's worker, from the state of its latest worker thread. */
export function workerStatusLine(worker: WorkerState | null, workerCount: number): string {
  if (workerCount === 0) return "Not started yet";
  if (worker === null) return workerCount > 1 ? `${workerCount} workers started` : "Worker started";
  if (worker.failed) return "Worker stopped with an error";
  if (worker.running) return workerCount > 1 ? `${workerCount} workers running` : "Worker running";
  return workerCount > 1 ? `${workerCount} workers, all idle` : "Worker finished its turn";
}

/** Splits closed items for the "Finished" fold: most recently touched first, capped. */
export function recentlyFinished(
  items: ReadonlyArray<TeammateItem>,
  teammateId: string,
  limit = 5,
): TeammateItem[] {
  return items
    .filter((item) => item.teammateId === teammateId && item.status === "done")
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

export function itemsWithStatus(
  items: ReadonlyArray<TeammateItem>,
  teammateId: string,
  statuses: ReadonlyArray<TeammateItemStatus>,
): TeammateItem[] {
  return items
    .filter((item) => item.teammateId === teammateId && statuses.includes(item.status))
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** `base`, or `base 2`, `base 3`... when taken (case-insensitive). */
export function uniqueTeammateName(
  base: string,
  existing: ReadonlyArray<{ readonly name: string }>,
): string {
  const taken = new Set(existing.map((teammate) => teammate.name.trim().toLowerCase()));
  if (!taken.has(base.trim().toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Plain words for where a remembered fact came from. */
export function memorySourceLabel(source: string): string {
  switch (source) {
    case "owner":
      return "You told it";
    case "teammate":
      return "It noticed";
    case "look-around":
      return "From looking around";
    default:
      return source;
  }
}

interface MemoryFactLike {
  readonly text: string;
  readonly topic: string | null;
  readonly source: string;
}

/** Facts whose text, topic or source contain the query (case-insensitive). Empty query keeps all. */
export function filterMemoryFacts<T extends MemoryFactLike>(
  facts: ReadonlyArray<T>,
  query: string,
): ReadonlyArray<T> {
  const needle = query.trim().toLowerCase();
  if (needle === "") return facts;
  return facts.filter((fact) =>
    [fact.text, fact.topic ?? "", memorySourceLabel(fact.source)].some((part) =>
      part.toLowerCase().includes(needle),
    ),
  );
}

/** Facts grouped by topic in first-seen order, with topic-less facts last under a null topic. */
export function groupMemoryFacts<T extends MemoryFactLike>(
  facts: ReadonlyArray<T>,
): ReadonlyArray<{ topic: string | null; facts: ReadonlyArray<T> }> {
  const byTopic = new Map<string, T[]>();
  const loose: T[] = [];
  for (const fact of facts) {
    const topic = fact.topic?.trim();
    if (!topic) loose.push(fact);
    else byTopic.set(topic, [...(byTopic.get(topic) ?? []), fact]);
  }
  const groups: Array<{ topic: string | null; facts: ReadonlyArray<T> }> = [...byTopic].map(
    ([topic, grouped]) => ({ topic, facts: grouped }),
  );
  if (loose.length > 0) groups.push({ topic: null, facts: loose });
  return groups;
}
