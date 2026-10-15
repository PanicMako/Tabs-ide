import { describe, it, expect, beforeEach } from "vitest";
import {
  MAX_PINNED_BRANCHES,
  loadPinnedBranches,
  savePinnedBranches,
  togglePinnedBranch,
  unpinAllBranches,
} from "./pinnedBranches";

describe("pinnedBranches", () => {
  const scope = "test-scope";
  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};
    const mockStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
      length: 0,
      key: () => null,
    };
    Object.defineProperty(globalThis, "localStorage", {
      value: mockStorage,
      writable: true,
      configurable: true,
    });
  });

  it("defaults to ['main'] if nothing is stored", () => {
    expect(loadPinnedBranches(scope)).toEqual(["main"]);
  });

  it("loads empty array if user explicitly unpinned all branches", () => {
    store[`tabs_pinned_branches_${scope}`] = "[]";
    expect(loadPinnedBranches(scope)).toEqual([]);
  });

  it("loads legacy single target branch if pinned branches not stored", () => {
    store[`tabs_target_branch_${scope}`] = "staging";
    expect(loadPinnedBranches(scope)).toEqual(["staging"]);
  });

  it("loads stored JSON array of pinned branches up to MAX_PINNED_BRANCHES", () => {
    store[`tabs_pinned_branches_${scope}`] = JSON.stringify(["b1", "b2", "b3", "b4", "b5"]);
    expect(loadPinnedBranches(scope)).toEqual(["b1", "b2", "b3", "b4"]);
  });

  it("saves pinned branches and syncs storage", () => {
    const saved = savePinnedBranches(scope, ["main", "feature-x"]);
    expect(saved).toEqual(["main", "feature-x"]);
    expect(store[`tabs_target_branch_${scope}`]).toBe("main");
    expect(JSON.parse(store[`tabs_pinned_branches_${scope}`] ?? "[]")).toEqual([
      "main",
      "feature-x",
    ]);
  });

  it("can unpin all branches down to empty array []", () => {
    const res1 = togglePinnedBranch(scope, ["main"], "main");
    expect(res1.action).toBe("unpinned");
    expect(res1.branches).toEqual([]);
    expect(loadPinnedBranches(scope)).toEqual([]);

    const unpinned = unpinAllBranches(scope);
    expect(unpinned).toEqual([]);
    expect(loadPinnedBranches(scope)).toEqual([]);
  });

  it("enforces MAX_PINNED_BRANCHES (limit_reached)", () => {
    const initial = ["b1", "b2", "b3", "b4"];
    const res = togglePinnedBranch(scope, initial, "b5");
    expect(res.action).toBe("limit_reached");
    expect(res.branches).toEqual(initial);
  });
});
