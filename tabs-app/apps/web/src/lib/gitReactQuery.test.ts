import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  invalidateGitQueries,
  gitMutationKeys,
  gitPreparePullRequestThreadMutationOptions,
  gitPullMutationOptions,
  gitRunStackedActionMutationOptions,
  gitStatusQueryOptions,
} from "./gitReactQuery";

describe("gitMutationKeys", () => {
  it("scopes stacked action keys by cwd", () => {
    expect(gitMutationKeys.runStackedAction("/repo/a")).not.toEqual(
      gitMutationKeys.runStackedAction("/repo/b"),
    );
  });

  it("scopes pull keys by cwd", () => {
    expect(gitMutationKeys.pull("/repo/a")).not.toEqual(gitMutationKeys.pull("/repo/b"));
  });

  it("scopes pull request thread preparation keys by cwd", () => {
    expect(gitMutationKeys.preparePullRequestThread("/repo/a")).not.toEqual(
      gitMutationKeys.preparePullRequestThread("/repo/b"),
    );
  });
});

describe("git mutation options", () => {
  const queryClient = new QueryClient();

  it("attaches cwd-scoped mutation key for runStackedAction", () => {
    const options = gitRunStackedActionMutationOptions({
      cwd: "/repo/a",
      queryClient,
    });
    expect(options.mutationKey).toEqual([
      "environment",
      "primary",
      ...gitMutationKeys.runStackedAction("/repo/a"),
    ]);
  });

  it("attaches cwd-scoped mutation key for pull", () => {
    const options = gitPullMutationOptions({ cwd: "/repo/a", queryClient });
    expect(options.mutationKey).toEqual([
      "environment",
      "primary",
      ...gitMutationKeys.pull("/repo/a"),
    ]);
  });

  it("attaches cwd-scoped mutation key for preparePullRequestThread", () => {
    const options = gitPreparePullRequestThreadMutationOptions({
      cwd: "/repo/a",
      queryClient,
    });
    expect(options.mutationKey).toEqual([
      "environment",
      "primary",
      ...gitMutationKeys.preparePullRequestThread("/repo/a"),
    ]);
  });
});

describe("git query options", () => {
  it("separates identical paths hosted by different environments", () => {
    const first = gitStatusQueryOptions("/repo/a", "environment-a");
    const second = gitStatusQueryOptions("/repo/a", "environment-b");

    expect(first.queryKey).not.toEqual(second.queryKey);
  });
});

describe("Git action refresh", () => {
  it("invalidates scoped Git data without invalidating unrelated environment data", async () => {
    const client = new QueryClient();
    const keys = [
      gitStatusQueryOptions("/repo", "desktop").queryKey,
      gitStatusQueryOptions("/repo", "remote").queryKey,
      ["environment", "desktop", "git", "history", "/repo"],
      ["git", "status", "/legacy"],
    ];
    for (const key of keys) client.setQueryData(key, {});
    const unrelated = ["environment", "desktop", "conversations"];
    client.setQueryData(unrelated, {});
    await invalidateGitQueries(client);
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
    client.clear();
  });
});
