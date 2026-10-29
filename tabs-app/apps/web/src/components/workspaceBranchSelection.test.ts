import { beforeEach, expect, it, vi } from "vitest";
import { selectWorkspaceBranch } from "./workspaceBranchSelection";
const api = vi.hoisted(() => ({ checkout: vi.fn(), status: vi.fn(), environments: vi.fn() }));
vi.mock("../connection/environmentApiRegistry", () => ({
  environmentApi: async (environmentId: string) => {
    api.environments(environmentId);
    return { git: { checkout: api.checkout, status: api.status } };
  },
}));
beforeEach(() => {
  api.checkout.mockReset().mockResolvedValue({});
  api.status.mockReset().mockResolvedValue({ branch: "actual-local" });
  api.environments.mockClear();
});
const branch = { name: "Feature", isDefault: false, current: false, worktreePath: null };
it("prepares the owning run, checks out on the same machine, then updates thread context", async () => {
  const prepare = vi.fn(async () => true);
  const setThreadBranch = vi.fn(async () => true);
  expect(
    await selectWorkspaceBranch({
      branch,
      projectCwd: "/repo",
      activeWorktreePath: "/worktree",
      environmentId: "remote",
      prepare,
      setThreadBranch,
    }),
  ).toBe("Feature");
  expect(api.checkout).toHaveBeenCalledWith({ cwd: "/worktree", branch: "Feature" });
  expect(api.environments).toHaveBeenCalledWith("remote");
  expect(setThreadBranch).toHaveBeenCalledWith("Feature", "/worktree");
  expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(
    api.checkout.mock.invocationCallOrder[0]!,
  );
  expect(api.checkout.mock.invocationCallOrder[0]).toBeLessThan(
    setThreadBranch.mock.invocationCallOrder[0]!,
  );
});
it("reuses an existing worktree and does not switch its checkout", async () => {
  const setThreadBranch = vi.fn(async () => true);
  await selectWorkspaceBranch({
    branch: { ...branch, worktreePath: "/existing" },
    projectCwd: "/repo",
    activeWorktreePath: null,
    prepare: async () => true,
    setThreadBranch,
  });
  expect(api.checkout).not.toHaveBeenCalled();
  expect(setThreadBranch).toHaveBeenCalledWith("Feature", "/existing");
});
it("uses the actual local branch name after a remote checkout", async () => {
  const setThreadBranch = vi.fn(async () => true);
  await selectWorkspaceBranch({
    branch: { ...branch, name: "origin/Feature", isRemote: true, remoteName: "origin" },
    projectCwd: "/repo",
    activeWorktreePath: null,
    prepare: async () => true,
    setThreadBranch,
  });
  expect(setThreadBranch).toHaveBeenCalledWith("actual-local", null);
});
it("does not change Git or metadata when preparation fails, or metadata after checkout failure", async () => {
  const setThreadBranch = vi.fn(async () => true);
  expect(
    await selectWorkspaceBranch({
      branch,
      projectCwd: "/repo",
      activeWorktreePath: null,
      prepare: async () => false,
      setThreadBranch,
    }),
  ).toBeNull();
  expect(api.checkout).not.toHaveBeenCalled();
  api.checkout.mockRejectedValue(new Error("Checkout failed"));
  await expect(
    selectWorkspaceBranch({
      branch,
      projectCwd: "/repo",
      activeWorktreePath: null,
      prepare: async () => true,
      setThreadBranch,
    }),
  ).rejects.toThrow("Checkout failed");
  expect(setThreadBranch).not.toHaveBeenCalled();
});
