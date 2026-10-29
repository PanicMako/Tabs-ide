export const MAX_PINNED_BRANCHES = 4;

function getStorage(): Storage | null {
  try {
    if (typeof globalThis !== "undefined" && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {}
  return null;
}

export function loadPinnedBranches(gitScopeKey: string): string[] {
  if (!gitScopeKey) return ["main"];
  const storage = getStorage();
  if (storage) {
    try {
      const raw = storage.getItem(`tabs_pinned_branches_${gitScopeKey}`);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed
            .map((s) => String(s).trim())
            .filter(Boolean)
            .slice(0, MAX_PINNED_BRANCHES);
        }
      }
      const legacy = storage.getItem(`tabs_target_branch_${gitScopeKey}`);
      if (legacy !== null) {
        const trimmed = legacy.trim();
        return trimmed ? [trimmed] : [];
      }
    } catch {}
  }
  return ["main"];
}

export function savePinnedBranches(gitScopeKey: string, branches: string[]): string[] {
  if (!gitScopeKey) return branches;
  const clamped = Array.from(new Set(branches.map((b) => b.trim()).filter(Boolean))).slice(
    0,
    MAX_PINNED_BRANCHES,
  );
  const result = clamped;
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(`tabs_pinned_branches_${gitScopeKey}`, JSON.stringify(result));
      if (result.length > 0 && result[0]) {
        storage.setItem(`tabs_target_branch_${gitScopeKey}`, result[0]);
      } else {
        storage.removeItem(`tabs_target_branch_${gitScopeKey}`);
      }
    } catch {}
  }

  if (typeof globalThis !== "undefined" && typeof globalThis.dispatchEvent === "function") {
    try {
      globalThis.dispatchEvent(
        new CustomEvent("tabs:pinned-branches-changed", {
          detail: { gitScopeKey, branches: result },
        }),
      );
      globalThis.dispatchEvent(
        new CustomEvent("tabs:pinned-branch-changed", {
          detail: { gitScopeKey, branch: result[0] ?? "" },
        }),
      );
    } catch {}
  }

  return result;
}

export function unpinAllBranches(gitScopeKey: string): string[] {
  return savePinnedBranches(gitScopeKey, []);
}

export function togglePinnedBranch(
  gitScopeKey: string,
  current: string[],
  branchName: string,
): { branches: string[]; action: "pinned" | "unpinned" | "limit_reached" } {
  const trimmed = branchName.trim();
  if (!trimmed) return { branches: current, action: "unpinned" };
  const norm = trimmed;
  const exists = current.some((b) => b === norm);
  if (exists) {
    const next = current.filter((b) => b !== norm);
    savePinnedBranches(gitScopeKey, next);
    return { branches: next, action: "unpinned" };
  }
  if (current.length >= MAX_PINNED_BRANCHES) {
    return { branches: current, action: "limit_reached" };
  }
  const next = [...current, trimmed];
  savePinnedBranches(gitScopeKey, next);
  return { branches: next, action: "pinned" };
}
