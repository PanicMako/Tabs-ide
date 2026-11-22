import "../../index.css";
import type { WorkspaceCleanupEvidence, WorkspaceCleanupItem } from "@tabs/contracts";
import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { shootAll } from "../session-search/uxShots";

const evidence = (patch: Partial<WorkspaceCleanupEvidence> = {}): WorkspaceCleanupEvidence => ({
  managed: true,
  main: false,
  locked: false,
  missing: false,
  projectRoot: false,
  detached: false,
  error: null,
  branchMerged: true,
  pullRequest: "merged",
  lastCommitAt: Date.now() - 20 * 86_400_000,
  lastThreadActivityAt: null,
  dirty: false,
  dirtyFileCount: 0,
  ignoredFiles: false,
  unpushedCommits: 0,
  openThreads: 0,
  settledThreads: 1,
  liveSessions: 0,
  runningTerminals: 0,
  lastTerminalActivityAt: null,
  diskBytes: 480_000_000,
  ...patch,
});
const items: WorkspaceCleanupItem[] = [
  {
    id: "1",
    path: "/Users/dev/.tabs/worktrees/tabs/fix-search",
    branch: "fix/search-debounce",
    head: "abc",
    verdict: "safe",
    reasons: [
      { code: "branch-merged", kind: "remove", detail: "Branch is merged into main" },
      { code: "pull-request-merged", kind: "remove", detail: "Pull request #412 was merged" },
    ],
    evidence: evidence(),
  },
  {
    id: "2",
    path: "/Users/dev/.tabs/worktrees/tabs/old-spike",
    branch: "spike/terminal",
    head: "def",
    verdict: "confirm",
    reasons: [
      { code: "stale", kind: "remove", detail: "No activity for 41 days" },
      { code: "dirty", kind: "risk", detail: "4 files have uncommitted changes" },
    ],
    evidence: evidence({ dirty: true, dirtyFileCount: 4, pullRequest: null, branchMerged: false }),
  },
  {
    id: "3",
    path: "/Users/dev/.tabs/worktrees/tabs/wip",
    branch: "wip/teammates",
    head: "ghi",
    verdict: "keep",
    reasons: [{ code: "live-session", kind: "block", detail: "An agent is running here" }],
    evidence: evidence({ liveSessions: 1, pullRequest: "open", branchMerged: false }),
  },
];
const maintenance = {
  cleanupScan: vi.fn(async () => ({
    items,
    total: items.length,
    nextOffset: null,
    scannedAt: Date.now(),
  })),
  cleanupApply: vi.fn(async () => ({
    outcomes: [{ id: "1", path: items[0]!.path, branch: "fix/search-debounce", status: "removed" }],
    reclaimedBytes: 480_000_000,
  })),
  cleanupHistory: vi.fn(async () => []),
};
vi.mock("~/nativeApi", () => ({ ensureNativeApi: () => ({ maintenance }) }));

import { WorkspaceCleanupSection } from "./WorkspaceCleanupSection";

beforeEach(() => {
  maintenance.cleanupScan.mockClear();
  maintenance.cleanupApply.mockClear();
});

it("shows evidence, selects, previews and removes with confirmation", async () => {
  const view = await render(
    <div className="mx-auto max-w-3xl p-8 text-foreground">
      <WorkspaceCleanupSection cwd="/Users/dev/projects/tabs" />
    </div>,
  );
  await shootAll("closed", "workspace-cleanup");
  await page.getByRole("button", { name: "Review worktrees" }).click();
  await expect.element(page.getByText("Pull request #412 was merged")).toBeVisible();
  await expect.element(page.getByText("4 files have uncommitted changes")).toBeVisible();
  await expect.element(page.getByText("An agent is running here")).toBeVisible();
  // Only the safe item starts selected.
  await expect.element(page.getByText("1 selected")).toBeVisible();
  await shootAll("review", "workspace-cleanup");
  // Clicking the row toggles its checkbox.
  await page.getByText("No activity for 41 days").click();
  await expect.element(page.getByText("2 selected")).toBeVisible();
  await page.getByText("No activity for 41 days").click();
  await page.getByRole("button", { name: "Preview" }).click();
  await vi.waitFor(() =>
    expect(maintenance.cleanupApply).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
    ),
  );
  await page.getByRole("button", { name: /^Remove 1/ }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await vi.waitFor(() =>
    expect(maintenance.cleanupApply).toHaveBeenLastCalledWith(
      expect.objectContaining({
        dryRun: false,
        selections: [expect.objectContaining({ id: "1" })],
      }),
    ),
  );
  await expect.element(page.getByText(/Removed 1/)).toBeVisible();
  await view.unmount();
});

it("edits rules and shows an error with retry", async () => {
  maintenance.cleanupScan.mockRejectedValueOnce(new Error("git worktree list failed"));
  const view = await render(
    <div className="mx-auto max-w-3xl p-8 text-foreground">
      <WorkspaceCleanupSection cwd="/Users/dev/projects/tabs" />
    </div>,
  );
  await page.getByRole("button", { name: "Review worktrees" }).click();
  await expect.element(page.getByText("git worktree list failed")).toBeVisible();
  await page.getByRole("button", { name: "Edit rules" }).click();
  await page.getByRole("textbox", { name: "Stale after days" }).fill("30");
  await expect.element(page.getByText(/idle 30 days/).first()).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect.element(page.getByText("fix/search-debounce")).toBeVisible();
  await view.unmount();
});
