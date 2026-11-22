import {
  DEFAULT_WORKSPACE_CLEANUP_RULES,
  type WorkspaceCleanupItem,
  type WorkspaceCleanupRules,
  type WorkspaceCleanupScanInput,
  type WorkspaceCleanupScanResult,
} from "@tabs/contracts";

const RULES_KEY = "tabs.workspaceCleanup.rules";
export const CLEANUP_PAGE_SIZE = 8;

/** Rules are a per-viewer convenience; the server re-checks them on every request. */
export function loadCleanupRules(storage: Pick<Storage, "getItem"> | null): WorkspaceCleanupRules {
  try {
    const raw = storage?.getItem(RULES_KEY);
    if (!raw) return DEFAULT_WORKSPACE_CLEANUP_RULES;
    const parsed = JSON.parse(raw) as Partial<Record<keyof WorkspaceCleanupRules, unknown>>;
    const next = { ...DEFAULT_WORKSPACE_CLEANUP_RULES };
    for (const key of Object.keys(next) as Array<keyof WorkspaceCleanupRules>) {
      const value = parsed[key];
      if (typeof value === typeof next[key]) (next as Record<string, unknown>)[key] = value;
    }
    next.staleAfterDays = Math.min(3650, Math.max(0, Math.trunc(next.staleAfterDays)));
    return next;
  } catch {
    return DEFAULT_WORKSPACE_CLEANUP_RULES;
  }
}

export function saveCleanupRules(
  storage: Pick<Storage, "setItem"> | null,
  rules: WorkspaceCleanupRules,
): void {
  try {
    storage?.setItem(RULES_KEY, JSON.stringify(rules));
  } catch {
    // Storage can be blocked; the rules still apply for this session.
  }
}

export const VERDICT_LABEL = {
  safe: "Safe to remove",
  confirm: "Needs confirmation",
  keep: "Kept",
} as const;

export function summarizeScan(items: ReadonlyArray<WorkspaceCleanupItem>) {
  const count = (verdict: WorkspaceCleanupItem["verdict"]) =>
    items.filter((item) => item.verdict === verdict).length;
  const reclaimable = items
    .filter((item) => item.verdict !== "keep")
    .reduce((total, item) => total + (item.evidence.diskBytes ?? 0), 0);
  return { safe: count("safe"), confirm: count("confirm"), keep: count("keep"), reclaimable };
}

/** Everything safe starts selected; risky items never do. */
export const defaultSelection = (items: ReadonlyArray<WorkspaceCleanupItem>): Set<string> =>
  new Set(items.filter((item) => item.verdict === "safe").map((item) => item.id));

export function formatAge(timestamp: number | null, now: number): string {
  if (timestamp === null) return "unknown";
  const days = Math.floor((now - timestamp) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 60) return `${days} days ago`;
  return `${Math.floor(days / 30)} months ago`;
}

export function confirmationMessage(item: WorkspaceCleanupItem): string {
  const risks = item.reasons
    .filter((reason) => reason.kind === "risk")
    .map((reason) => `- ${reason.detail}`)
    .join("\n");
  return `Remove ${item.branch ?? item.path}?\n\n${risks}\n\nThis worktree has work that exists nowhere else. Its branch is kept, but uncommitted changes and ignored files will be deleted. This cannot be undone.`;
}

export interface CleanupScanApi {
  cleanupScan: (input: WorkspaceCleanupScanInput) => Promise<WorkspaceCleanupScanResult>;
}

/** Pages through the scan so the list fills in as results arrive. Stops when `isStale` says so. */
export async function scanInPages(
  api: CleanupScanApi,
  base: Pick<WorkspaceCleanupScanInput, "cwd" | "rules" | "includePullRequests">,
  onPage: (page: WorkspaceCleanupScanResult) => void,
  isStale: () => boolean,
): Promise<void> {
  let offset = 0;
  while (!isStale()) {
    const page = await api.cleanupScan({ ...base, offset, limit: CLEANUP_PAGE_SIZE });
    if (isStale()) return;
    onPage(page);
    if (page.nextOffset === null) return;
    offset = page.nextOffset;
  }
}

export interface GroupedReasons {
  /** Why the rules say this worktree can go. */
  readonly why: ReadonlyArray<string>;
  /** Things to know before removing it. */
  readonly risks: ReadonlyArray<string>;
  /** Why it is being kept. */
  readonly kept: ReadonlyArray<string>;
}

/** Splits an item's reasons into the three plain-language groups the row shows. */
export function groupReasons(item: WorkspaceCleanupItem): GroupedReasons {
  const pick = (kinds: ReadonlyArray<string>) =>
    item.reasons.filter((reason) => kinds.includes(reason.kind)).map((reason) => reason.detail);
  return { why: pick(["remove"]), risks: pick(["risk"]), kept: pick(["block", "keep"]) };
}

/** Ids a person can tick: everything the scan did not mark as kept. */
export const removableIds = (items: ReadonlyArray<WorkspaceCleanupItem>): string[] =>
  items.filter((item) => item.verdict !== "keep").map((item) => item.id);

export function selectedReclaimBytes(
  items: ReadonlyArray<WorkspaceCleanupItem>,
  selected: ReadonlySet<string>,
): number {
  return items
    .filter((item) => selected.has(item.id))
    .reduce((total, item) => total + (item.evidence.diskBytes ?? 0), 0);
}

export const RULE_SUMMARY_PARTS = {
  removeWhenBranchMerged: "branch merged",
  removeWhenPullRequestMerged: "PR merged",
  removeWhenPullRequestClosed: "PR closed",
} as const;

/** One line describing the active rules, shown while the rules editor is collapsed. */
export function describeRules(rules: WorkspaceCleanupRules): string {
  const removes: string[] = [];
  for (const [key, label] of Object.entries(RULE_SUMMARY_PARTS)) {
    if (rules[key as keyof typeof RULE_SUMMARY_PARTS]) removes.push(label);
  }
  if (rules.removeWhenStale) removes.push(`idle ${rules.staleAfterDays} days`);
  const keeps: string[] = [];
  if (rules.keepIfDirty) keeps.push("uncommitted changes");
  if (rules.keepIfUnpushed) keeps.push("unpushed commits");
  const remove =
    removes.length > 0
      ? `Removes worktrees when: ${removes.join(", ")}.`
      : "No removal rules are on.";
  return keeps.length > 0 ? `${remove} Keeps any with ${keeps.join(" or ")}.` : remove;
}

/** Digits only, clamped to the 0..3650 days the server accepts. */
export function parseStaleDays(raw: string): number {
  const digits = raw.replace(/\D/g, "");
  return Math.min(3650, Math.max(0, Number(digits || 0)));
}
