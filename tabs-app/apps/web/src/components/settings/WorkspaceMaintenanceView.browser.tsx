import "../../index.css";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { ManagedWorktree, StorageInventory } from "@tabs/contracts";
import { WorkspaceMaintenanceView } from "./WorkspaceMaintenanceView";

const tree = (patch: Partial<ManagedWorktree>): ManagedWorktree => ({
  path: "/projects/tabs",
  branch: "main",
  head: "abcdef012345",
  main: false,
  locked: false,
  prunable: false,
  dirty: false,
  ignored: false,
  protected: false,
  threadCount: 0,
  settledThreadCount: 0,
  error: null,
  ...patch,
});
const storage: StorageInventory = {
  totalBytes: 4096,
  reclaimableBytes: 1024,
  candidates: [
    {
      id: "old-log",
      name: "server.log.1",
      category: "logs",
      bytes: 1024,
      modifiedAt: 1700000000000,
    },
  ],
  categories: [
    { id: "logs", bytes: 2048, reclaimableBytes: 1024 },
    { id: "browser-artifacts", bytes: 2048, reclaimableBytes: 0 },
  ],
  warnings: [],
};
const fixture = (patch: Partial<Parameters<typeof WorkspaceMaintenanceView>[0]> = {}) => ({
  projects: [{ id: "tabs", name: "Tabs" }],
  projectId: "tabs",
  onProjectChange: vi.fn(),
  hasProject: true,
  worktrees: [
    tree({ main: true }),
    tree({ branch: "feature/search", path: "/projects/search" }),
    tree({ branch: "feature/review", path: "/projects/review", error: "Git inspection timed out" }),
  ],
  storage,
  busy: false,
  branch: "",
  base: "HEAD",
  onBranchChange: vi.fn(),
  onBaseChange: vi.fn(),
  onCreate: vi.fn(),
  onOpen: vi.fn(),
  onStart: vi.fn(),
  onRemove: vi.fn(),
  onClean: vi.fn(),
  retentionDays: null,
  onRetentionChange: vi.fn(),
  ...patch,
});

it("filters worktrees and keeps protected or uninspected removals disabled", async () => {
  await page.viewport(1100, 850);
  const props = fixture();
  const view = await render(
    <div className="workspace-maintenance">
      <WorkspaceMaintenanceView {...props} />
    </div>,
  );
  await expect
    .element(page.getByRole("button", { name: "Remove worktree main", exact: true }))
    .toBeDisabled();
  await expect
    .element(page.getByRole("button", { name: "Remove worktree feature/review", exact: true }))
    .toBeDisabled();
  await page.getByRole("textbox", { name: "Filter worktrees" }).fill("feature/search");
  await expect.element(page.getByText("feature/search", { exact: true })).toBeVisible();
  await expect.element(page.getByText("feature/review", { exact: true })).not.toBeInTheDocument();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  expect(props.onOpen).toHaveBeenCalledWith(props.worktrees[1]);
  await view.unmount();
});

it("reveals creation on demand, preserves cleanup controls and fits a narrow screen", async () => {
  await page.viewport(390, 850);
  const props = fixture({ branch: "feature/test" });
  const view = await render(
    <div className="workspace-maintenance">
      <WorkspaceMaintenanceView {...props} />
    </div>,
  );
  await expect
    .element(page.getByRole("textbox", { name: "New worktree branch" }))
    .not.toBeInTheDocument();
  await page.getByRole("button", { name: "New worktree", exact: true }).click();
  await page.getByRole("button", { name: "Create worktree", exact: true }).click();
  expect(props.onCreate).toHaveBeenCalledOnce();
  await page.getByRole("button", { name: "Close worktree form" }).click();
  await page.getByRole("combobox", { name: "Automatic log retention" }).click();
  await page.getByRole("option", { name: "14 days", exact: true }).click();
  expect(props.onRetentionChange).toHaveBeenCalledWith(14);
  expect(page.getByRole("combobox", { name: "Repository" }).element().tagName).toBe("BUTTON");
  await page.getByRole("button", { name: "Clean eligible logs…" }).click();
  expect(props.onClean).toHaveBeenCalledOnce();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  await view.unmount();
});

it("keeps zero storage honest and cleanup unavailable without candidates", async () => {
  const props = fixture({
    storage: { ...storage, totalBytes: 0, reclaimableBytes: 0, candidates: [], categories: [] },
    worktrees: [],
  });
  const view = await render(
    <div className="workspace-maintenance">
      <WorkspaceMaintenanceView {...props} />
    </div>,
  );
  await expect.element(page.getByRole("button", { name: "Clean eligible logs…" })).toBeDisabled();
  await expect.element(page.getByText("0 B").first()).toBeVisible();
  await view.unmount();
});
