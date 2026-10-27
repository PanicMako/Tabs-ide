import { QueryClient } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { gitCreateWorktreeMutationOptions } from "./gitReactQuery";
const calls = vi.hoisted(() => ({ fetch: vi.fn(), create: vi.fn() }));
vi.mock("../connection/environmentApiRegistry", () => ({
  environmentApi: async () => ({ git: { fetch: calls.fetch, createWorktree: calls.create } }),
}));
beforeEach(() => {
  vi.resetAllMocks();
  calls.fetch.mockResolvedValue(undefined);
  calls.create.mockResolvedValue({ worktree: { path: "/worktree", branch: "new" } });
});
const create = (branch: string) =>
  gitCreateWorktreeMutationOptions({ queryClient: new QueryClient() }).mutationFn!(
    { cwd: "/repo", branch, newBranch: "new" },
    {} as never,
  );
it("fetches an explicit remote ref before creating a worktree", async () => {
  await create("refs/remotes/origin/main");
  expect(calls.fetch).toHaveBeenCalledWith({ cwd: "/repo" });
  expect(calls.fetch.mock.invocationCallOrder[0]).toBeLessThan(
    calls.create.mock.invocationCallOrder[0]!,
  );
  expect(calls.create).toHaveBeenCalledWith({
    cwd: "/repo",
    branch: "refs/remotes/origin/main",
    newBranch: "new",
    path: null,
  });
});
it("does not create a worktree when fetching fails", async () => {
  calls.fetch.mockRejectedValue(new Error("Remote unavailable"));
  await expect(create("refs/remotes/origin/main")).rejects.toThrow("Remote unavailable");
  expect(calls.create).not.toHaveBeenCalled();
});
it("does not require a network for a local base", async () => {
  await create("main");
  expect(calls.fetch).not.toHaveBeenCalled();
  expect(calls.create).toHaveBeenCalledOnce();
});
