import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_WORKSPACE_CLEANUP_RULES, type WorkspaceCleanupRules } from "@tabs/contracts";
import { parseWorktrees } from "../workspaceMaintenance.ts";
import { runGit } from "./gitEvidence.ts";
import { listRuns } from "./history.ts";
import { applyCleanup, scanWorktrees, type WorkspaceCleanupDeps } from "./service.ts";
import { EMPTY_USAGE, type WorkspaceUsageIndex } from "./usage.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf8",
  });

async function fixture() {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "tabs-cleanup-")));
  directories.push(base);
  const repo = path.join(base, "repo");
  const trees = path.join(base, "trees");
  await fs.mkdir(repo);
  git(repo, "init", "-b", "main");
  await fs.writeFile(path.join(repo, "a.txt"), "a");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "init");
  const addTree = (name: string) => {
    const dir = path.join(trees, name);
    git(repo, "worktree", "add", "-b", name, dir);
    return dir;
  };
  let usage: WorkspaceUsageIndex = EMPTY_USAGE;
  const removed: Array<{ path: string; force: boolean }> = [];
  const deps = (): WorkspaceCleanupDeps => ({
    listWorktrees: async (cwd) =>
      parseWorktrees((await runGit(cwd, ["worktree", "list", "--porcelain", "-z"])).stdout),
    readUsage: async () => usage,
    managedRoots: [trees],
    lookupPullRequest: async () => null,
    removeWorktree: async ({ cwd, path: target, force }) => {
      removed.push({ path: target, force });
      git(cwd, "worktree", "remove", ...(force ? ["--force"] : []), "--", target);
    },
    historyFile: path.join(base, "history.json"),
    now: () => Date.now(),
  });
  return {
    repo,
    base,
    addTree,
    removed,
    deps,
    setUsage: (next: WorkspaceUsageIndex) => (usage = next),
  };
}

const scanInput = (cwd: string, rules: Partial<WorkspaceCleanupRules> = {}) => ({
  cwd,
  rules: { ...DEFAULT_WORKSPACE_CLEANUP_RULES, ...rules },
  offset: 0,
  limit: 50,
  includePullRequests: false,
});

describe("workspace cleanup against real git", () => {
  it("classifies merged, dirty, unpushed and unmanaged worktrees with evidence", async () => {
    const f = await fixture();
    const merged = f.addTree("merged");
    const dirty = f.addTree("dirty");
    await fs.writeFile(path.join(dirty, "scratch.txt"), "wip");
    const ahead = f.addTree("ahead");
    await fs.writeFile(path.join(ahead, "b.txt"), "b");
    git(ahead, "add", ".");
    git(ahead, "commit", "-m", "work");
    const outside = path.join(f.base, "outside");
    git(f.repo, "worktree", "add", "-b", "outside", outside);

    const result = await scanWorktrees(f.deps(), scanInput(f.repo));
    const byBranch = Object.fromEntries(result.items.map((item) => [item.branch, item]));
    expect(result.total).toBe(4);
    expect(result.nextOffset).toBeNull();
    expect(byBranch.merged!.verdict).toBe("safe");
    expect(byBranch.merged!.path).toBe(merged);
    expect(byBranch.dirty!.verdict).toBe("keep");
    expect(byBranch.dirty!.evidence.dirtyFileCount).toBe(1);
    expect(byBranch.ahead!.verdict).toBe("keep");
    expect(byBranch.ahead!.evidence.unpushedCommits).toBe(1);
    expect(byBranch.outside!.verdict).toBe("keep");
    expect(byBranch.outside!.reasons.map((r: { code: string }) => r.code)).toContain("not-managed");
    expect(byBranch.merged!.evidence.diskBytes ?? 1).toBeGreaterThan(0);
  });

  it("pages results", async () => {
    const f = await fixture();
    for (const name of ["a", "b", "c"]) f.addTree(name);
    const first = await scanWorktrees(f.deps(), { ...scanInput(f.repo), limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextOffset).toBe(2);
    const second = await scanWorktrees(f.deps(), { ...scanInput(f.repo), limit: 2, offset: 2 });
    expect(second.items).toHaveLength(1);
    expect(second.nextOffset).toBeNull();
  });

  it("removes safe worktrees, records history, and supports dry run", async () => {
    const f = await fixture();
    const merged = f.addTree("merged");
    const scan = await scanWorktrees(f.deps(), scanInput(f.repo));
    const item = scan.items[0]!;
    const selection = [{ id: item.id, path: item.path, confirmed: false }];
    const rules = DEFAULT_WORKSPACE_CLEANUP_RULES;

    const dry = await applyCleanup(f.deps(), {
      cwd: f.repo,
      rules,
      selections: selection,
      dryRun: true,
    });
    expect(dry.outcomes[0]!.status).toBe("would-remove");
    await expect(fs.stat(merged)).resolves.toBeTruthy();

    const run = await applyCleanup(f.deps(), {
      cwd: f.repo,
      rules,
      selections: selection,
      dryRun: false,
    });
    expect(run.outcomes[0]).toMatchObject({ status: "removed", forced: false });
    await expect(fs.stat(merged)).rejects.toThrow();
    expect((await listRuns(f.deps().historyFile))[0]!.id).toBe(run.id);
  });

  it("refuses kept items, stale previews and unconfirmed risky items", async () => {
    const f = await fixture();
    const dirty = f.addTree("dirty");
    await fs.writeFile(path.join(dirty, "scratch.txt"), "wip");
    const safe = f.addTree("safe");
    const rulesOff = { ...DEFAULT_WORKSPACE_CLEANUP_RULES, keepIfDirty: false };

    // Dirty is kept outright under the default rules, even if the client asks.
    const strict = await scanWorktrees(f.deps(), scanInput(f.repo));
    const dirtyItem = strict.items.find((i) => i.branch === "dirty")!;
    const kept = await applyCleanup(f.deps(), {
      cwd: f.repo,
      rules: DEFAULT_WORKSPACE_CLEANUP_RULES,
      selections: [{ id: dirtyItem.id, path: dirtyItem.path, confirmed: true }],
      dryRun: false,
    });
    expect(kept.outcomes[0]!.status).toBe("skipped");

    // With the rule off it still needs a per-item confirm, and only then is forced.
    const relaxed = await scanWorktrees(f.deps(), scanInput(f.repo, { keepIfDirty: false }));
    const relaxedItem = relaxed.items.find((i) => i.branch === "dirty")!;
    expect(relaxedItem.verdict).toBe("confirm");
    const unconfirmed = await applyCleanup(f.deps(), {
      cwd: f.repo,
      rules: rulesOff,
      selections: [{ id: relaxedItem.id, path: relaxedItem.path, confirmed: false }],
      dryRun: false,
    });
    expect(unconfirmed.outcomes[0]!.status).toBe("skipped");
    await expect(fs.stat(dirty)).resolves.toBeTruthy();
    const confirmed = await applyCleanup(f.deps(), {
      cwd: f.repo,
      rules: rulesOff,
      selections: [{ id: relaxedItem.id, path: relaxedItem.path, confirmed: true }],
      dryRun: false,
    });
    expect(confirmed.outcomes[0]).toMatchObject({ status: "removed", forced: true });

    // HEAD moved after the preview: skipped, never removed.
    const item = relaxed.items.find((i) => i.branch === "safe")!;
    await fs.writeFile(path.join(safe, "n.txt"), "n");
    git(safe, "add", ".");
    git(safe, "commit", "-m", "later");
    const stale = await applyCleanup(f.deps(), {
      cwd: f.repo,
      rules: rulesOff,
      selections: [{ id: item.id, path: item.path, confirmed: true }],
      dryRun: false,
    });
    expect(stale.outcomes[0]!.status).toBe("skipped");
    await expect(fs.stat(safe)).resolves.toBeTruthy();
  });

  it("skips a worktree an open thread started using after the preview", async () => {
    const f = await fixture();
    const tree = f.addTree("busy");
    const scan = await scanWorktrees(f.deps(), scanInput(f.repo));
    const item = scan.items[0]!;
    f.setUsage({
      ...EMPTY_USAGE,
      threads: [{ path: tree, settled: false, activityAt: Date.now() }],
    });
    const run = await applyCleanup(f.deps(), {
      cwd: f.repo,
      rules: DEFAULT_WORKSPACE_CLEANUP_RULES,
      selections: [{ id: item.id, path: item.path, confirmed: true }],
      dryRun: false,
    });
    expect(run.outcomes[0]!.status).toBe("skipped");
    expect(f.removed).toHaveLength(0);
  });
});
