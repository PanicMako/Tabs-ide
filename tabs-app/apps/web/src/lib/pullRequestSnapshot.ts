import {
  type GitResolvedPullRequest,
  type GitResolvePullRequestResult,
  GitResolvePullRequestResult as GitResolvePullRequestResultSchema,
} from "@tabs/contracts";
import * as Schema from "effect/Schema";

export interface PullRequestSnapshotRef {
  readonly environmentId?: string | null | undefined;
  readonly cwd: string | null | undefined;
  readonly reference: string | null | undefined;
  readonly host?: string | null | undefined;
}

const SNAPSHOT_KEY_PREFIX = "tabs.pr.snapshot:";
const MAX_SNAPSHOTS = 50;

export function pullRequestSnapshotKey(ref: PullRequestSnapshotRef): string {
  const env = ref.environmentId ?? "local";
  const cwd = (ref.cwd ?? "").trim().toLowerCase();
  const reference = (ref.reference ?? "").trim().toLowerCase().replace(/^#/, "");
  const host = (ref.host ?? "").trim().toLowerCase();
  return `${SNAPSHOT_KEY_PREFIX}${JSON.stringify([env, cwd, reference, host])}`;
}

const decodePullRequestResult = Schema.decodeUnknownOption(GitResolvePullRequestResultSchema);

function getStorage(customStorage?: Storage): Storage | undefined {
  if (customStorage !== undefined) return customStorage;
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return undefined;
}

/**
 * Reads a cached pull request resolution snapshot from storage across restarts/reloads.
 * Returns null if no snapshot exists, if storage is unavailable, or if schema is invalid.
 */
export function readPullRequestSnapshot(
  ref: PullRequestSnapshotRef,
  storage?: Storage,
): GitResolvePullRequestResult | null {
  const s = getStorage(storage);
  if (!s || !ref.cwd || !ref.reference) return null;

  try {
    const raw = s.getItem(pullRequestSnapshotKey(ref));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const decoded = decodePullRequestResult(parsed);
    if (decoded._tag === "Some") {
      return decoded.value;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Writes a pull request resolution snapshot to persistent storage.
 */
export function writePullRequestSnapshot(
  ref: PullRequestSnapshotRef,
  data: GitResolvePullRequestResult,
  storage?: Storage,
): void {
  const s = getStorage(storage);
  if (!s || !ref.cwd || !ref.reference) return;

  try {
    const key = pullRequestSnapshotKey(ref);
    s.setItem(key, JSON.stringify(data));
    prunePullRequestSnapshots(MAX_SNAPSHOTS, s);
  } catch {
    // Shrug off quota errors or private-mode restrictions
  }
}

/**
 * Resolves the displayed PR result: live result always wins; cached snapshot is displayed
 * while the live query is loading to avoid blank or ghost tabs.
 */
export function resolveDisplayedPullRequestResult(input: {
  readonly live: GitResolvePullRequestResult | null | undefined;
  readonly cached: GitResolvePullRequestResult | null | undefined;
  readonly ref: PullRequestSnapshotRef;
}): GitResolvePullRequestResult | null {
  if (input.live) return input.live;
  if (!input.cached || !input.cached.pullRequest) return null;

  const pr = input.cached.pullRequest;
  const targetRef = (input.ref.reference ?? "").toLowerCase().replace(/^#/, "");
  const targetNum = Number(targetRef);

  const matchesNumber = !Number.isNaN(targetNum) && pr.number === targetNum;
  const matchesBranch = pr.headBranch.toLowerCase() === targetRef;
  const matchesRef = matchesNumber || matchesBranch || String(pr.number) === targetRef;

  if (matchesRef) {
    if (input.ref.host) {
      const urlHost = pr.url ? new URL(pr.url).hostname.toLowerCase() : null;
      if (urlHost && urlHost !== input.ref.host.toLowerCase()) {
        return null;
      }
    }
    return input.cached;
  }

  return null;
}

/**
 * Prunes stored snapshots when exceeding the maximum allowed capacity.
 */
export function prunePullRequestSnapshots(maxCapacity = MAX_SNAPSHOTS, storage?: Storage): void {
  const s = getStorage(storage);
  if (!s) return;

  try {
    const snapshotKeys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (key && key.startsWith(SNAPSHOT_KEY_PREFIX)) {
        snapshotKeys.push(key);
      }
    }

    if (snapshotKeys.length > maxCapacity) {
      // Evict oldest beyond capacity
      const toRemove = snapshotKeys.slice(0, snapshotKeys.length - maxCapacity);
      for (const key of toRemove) {
        s.removeItem(key);
      }
    }
  } catch {
    // Ignore storage iteration errors
  }
}
