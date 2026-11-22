import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WORKSPACE_CLEANUP_RULES,
  type WorkspaceCleanupItem,
  type WorkspaceCleanupScanResult,
} from "@tabs/contracts";
import {
  defaultSelection,
  formatAge,
  loadCleanupRules,
  saveCleanupRules,
  scanInPages,
  summarizeScan,
} from "./workspaceCleanupModel";

const item = (
  id: string,
  verdict: WorkspaceCleanupItem["verdict"],
  diskBytes: number | null = null,
): WorkspaceCleanupItem =>
  ({
    id,
    path: `/w/${id}`,
    branch: id,
    head: "h",
    verdict,
    reasons: [],
    evidence: { diskBytes },
  }) as unknown as WorkspaceCleanupItem;

describe("workspace cleanup model", () => {
  it("selects only safe items by default", () => {
    const items = [item("a", "safe"), item("b", "confirm"), item("c", "keep")];
    expect([...defaultSelection(items)]).toEqual(["a"]);
  });

  it("summarizes verdicts and reclaimable size", () => {
    expect(
      summarizeScan([item("a", "safe", 10), item("b", "confirm", 5), item("c", "keep", 100)]),
    ).toEqual({ safe: 1, confirm: 1, keep: 1, reclaimable: 15 });
  });

  it("formats ages", () => {
    const now = Date.UTC(2026, 5, 1);
    expect(formatAge(null, now)).toBe("unknown");
    expect(formatAge(now - 3_600_000, now)).toBe("today");
    expect(formatAge(now - 3 * 86_400_000, now)).toBe("3 days ago");
    expect(formatAge(now - 120 * 86_400_000, now)).toBe("4 months ago");
  });

  it("round-trips rules and ignores corrupt storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    saveCleanupRules(storage, { ...DEFAULT_WORKSPACE_CLEANUP_RULES, staleAfterDays: 30 });
    expect(loadCleanupRules(storage).staleAfterDays).toBe(30);
    store.set([...store.keys()][0]!, "{not json");
    expect(loadCleanupRules(storage)).toEqual(DEFAULT_WORKSPACE_CLEANUP_RULES);
    store.set([...store.keys()][0]!, JSON.stringify({ staleAfterDays: "x", keepIfDirty: false }));
    const loaded = loadCleanupRules(storage);
    expect(loaded.staleAfterDays).toBe(14);
    expect(loaded.keepIfDirty).toBe(false);
    expect(loadCleanupRules(null)).toEqual(DEFAULT_WORKSPACE_CLEANUP_RULES);
  });

  it("pages until the last page and stops when stale", async () => {
    const pages: WorkspaceCleanupScanResult[] = [
      { items: [item("a", "safe")], total: 2, nextOffset: 1, scannedAt: 1 },
      { items: [item("b", "keep")], total: 2, nextOffset: null, scannedAt: 1 },
    ];
    const cleanupScan = vi.fn(async (input: { offset: number }) => pages[input.offset]!);
    const seen: string[] = [];
    await scanInPages(
      { cleanupScan },
      { cwd: "/r", rules: DEFAULT_WORKSPACE_CLEANUP_RULES, includePullRequests: true },
      (page) => seen.push(...page.items.map((i) => i.id)),
      () => false,
    );
    expect(seen).toEqual(["a", "b"]);
    expect(cleanupScan).toHaveBeenCalledTimes(2);

    cleanupScan.mockClear();
    await scanInPages(
      { cleanupScan },
      { cwd: "/r", rules: DEFAULT_WORKSPACE_CLEANUP_RULES, includePullRequests: true },
      () => {},
      () => true,
    );
    expect(cleanupScan).not.toHaveBeenCalled();
  });
});

describe("cleanup presentation helpers", () => {
  it("groups reasons and totals selected bytes", async () => {
    const m = await import("./workspaceCleanupModel");
    const base = item("a", "confirm", 100);
    const withReasons = {
      ...base,
      reasons: [
        { code: "branch-merged", kind: "remove", detail: "Merged into main" },
        { code: "dirty", kind: "risk", detail: "3 changed files" },
      ],
    } as WorkspaceCleanupItem;
    expect(m.groupReasons(withReasons)).toEqual({
      why: ["Merged into main"],
      risks: ["3 changed files"],
      kept: [],
    });
    expect(m.selectedReclaimBytes([withReasons, item("b", "safe", 50)], new Set(["a"]))).toBe(100);
    expect(m.removableIds([withReasons, item("k", "keep")])).toEqual(["a"]);
  });
  it("describes rules and parses day input", async () => {
    const m = await import("./workspaceCleanupModel");
    expect(m.describeRules(DEFAULT_WORKSPACE_CLEANUP_RULES)).toContain("idle 14 days");
    expect(m.parseStaleDays("9x9")).toBe(99);
    expect(m.parseStaleDays("99999")).toBe(3650);
    expect(m.parseStaleDays("")).toBe(0);
  });
});
