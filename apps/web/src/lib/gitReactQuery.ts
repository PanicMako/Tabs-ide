import { type GitStackedAction } from "@tabs/contracts";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { environmentApi } from "../connection/environmentApiRegistry";
import { readPullRequestSnapshot, writePullRequestSnapshot } from "./pullRequestSnapshot";

const GIT_ENVIRONMENT_STALE_TIME_MS = 30_000;
const GIT_STATUS_STALE_TIME_MS = 5_000;
const GIT_STATUS_REFETCH_INTERVAL_MS = 15_000;
const GIT_BRANCHES_STALE_TIME_MS = 15_000;
const GIT_BRANCHES_REFETCH_INTERVAL_MS = 60_000;
const GIT_HISTORY_STALE_TIME_MS = 15_000;
const GIT_HISTORY_REFETCH_INTERVAL_MS = 30_000;
const GIT_WORKING_TREE_DIFF_STALE_TIME_MS = 5_000;
const GIT_WORKING_TREE_DIFF_REFETCH_INTERVAL_MS = 15_000;

export const gitQueryKeys = {
  all: ["git"] as const,
  environment: (cwd: string | null) => ["git", "environment", cwd] as const,
  status: (cwd: string | null) => ["git", "status", cwd] as const,
  branches: (cwd: string | null) => ["git", "branches", cwd] as const,
  history: (cwd: string | null, limit: number) => ["git", "history", cwd, limit] as const,
  stashes: (cwd: string | null) => ["git", "stashes", cwd] as const,
  workflowRuns: (cwd: string | null, branch: string | null) =>
    ["git", "workflowRuns", cwd, branch] as const,
  conflictSnapshot: (cwd: string | null, path: string | null) =>
    ["git", "conflict-snapshot", cwd, path] as const,
  diff: (input: { cwd: string | null; path?: string | null; commit?: string | null }) =>
    ["git", "diff", input.cwd, input.path ?? null, input.commit ?? null] as const,
  watchedBranches: (cwd: string | null, excluded: string[]) =>
    ["git", "watchedBranches", cwd, excluded.join(",")] as const,
};

export const gitMutationKeys = {
  init: (cwd: string | null) => ["git", "mutation", "init", cwd] as const,
  checkout: (cwd: string | null) => ["git", "mutation", "checkout", cwd] as const,
  runStackedAction: (cwd: string | null) => ["git", "mutation", "run-stacked-action", cwd] as const,
  pull: (cwd: string | null) => ["git", "mutation", "pull", cwd] as const,
  preparePullRequestThread: (cwd: string | null) =>
    ["git", "mutation", "prepare-pull-request-thread", cwd] as const,
};

const scopedGitKey = (environmentId: string | undefined, key: readonly unknown[]) =>
  ["environment", environmentId ?? "primary", ...key] as const;

export function invalidateGitQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: gitQueryKeys.all });
}

export function gitEnvironmentQueryOptions(cwd: string | null, environmentId?: string) {
  return queryOptions({
    queryKey: scopedGitKey(environmentId, gitQueryKeys.environment(cwd)),
    queryFn: async () => {
      const api = await environmentApi(environmentId);
      if (!cwd) throw new Error("Git environment is unavailable.");
      return api.git.environment({ cwd });
    },
    enabled: cwd !== null,
    staleTime: GIT_ENVIRONMENT_STALE_TIME_MS,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
}

export function gitHubSwitchAccountMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
  environmentId?: string | undefined;
}) {
  return mutationOptions({
    mutationKey: scopedGitKey(input.environmentId, [
      "git",
      "mutation",
      "github-switch-account",
      input.cwd,
    ]),
    mutationFn: async (account: { host: string; login: string }) => {
      const api = await environmentApi(input.environmentId);
      return api.git.gitHubSwitchAccount(account);
    },
    onSuccess: async () => {
      await invalidateGitQueries(input.queryClient);
    },
  });
}

export function gitHubLogoutMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
  environmentId?: string | undefined;
}) {
  return mutationOptions({
    mutationKey: scopedGitKey(input.environmentId, ["git", "mutation", "github-logout", input.cwd]),
    mutationFn: async (account: { host: string; login: string }) => {
      const api = await environmentApi(input.environmentId);
      return api.git.gitHubLogout(account);
    },
    onSuccess: async () => {
      await invalidateGitQueries(input.queryClient);
    },
  });
}

export function gitStatusQueryOptions(cwd: string | null, environmentId?: string) {
  return queryOptions({
    queryKey: scopedGitKey(environmentId, gitQueryKeys.status(cwd)),
    queryFn: async () => {
      const api = await environmentApi(environmentId);
      if (!cwd) throw new Error("Git status is unavailable.");
      return api.git.status({ cwd });
    },
    enabled: cwd !== null,
    staleTime: GIT_STATUS_STALE_TIME_MS,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: GIT_STATUS_REFETCH_INTERVAL_MS,
  });
}

export function gitBranchesQueryOptions(cwd: string | null, environmentId?: string) {
  return queryOptions({
    queryKey: scopedGitKey(environmentId, gitQueryKeys.branches(cwd)),
    queryFn: async () => {
      const api = await environmentApi(environmentId);
      if (!cwd) throw new Error("Git branches are unavailable.");
      return api.git.listBranches({ cwd });
    },
    enabled: cwd !== null,
    staleTime: GIT_BRANCHES_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: GIT_BRANCHES_REFETCH_INTERVAL_MS,
  });
}

export function gitHistoryQueryOptions(input: {
  cwd: string | null;
  limit?: number;
  environmentId?: string | undefined;
}) {
  const limit = input.limit ?? 40;
  return queryOptions({
    queryKey: scopedGitKey(input.environmentId, gitQueryKeys.history(input.cwd, limit)),
    queryFn: async () => {
      const api = await environmentApi(input.environmentId);
      if (!input.cwd) throw new Error("Git history is unavailable.");
      return api.git.history({ cwd: input.cwd, limit });
    },
    enabled: input.cwd !== null,
    staleTime: GIT_HISTORY_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: GIT_HISTORY_REFETCH_INTERVAL_MS,
  });
}

export function gitDiffQueryOptions(input: {
  cwd: string | null;
  path?: string | null;
  commit?: string | null;
  environmentId?: string | undefined;
}) {
  const isWorkingTreeDiff = !input.commit;
  const hasTarget = Boolean(input.path) || Boolean(input.commit);
  return queryOptions({
    queryKey: scopedGitKey(input.environmentId, gitQueryKeys.diff(input)),
    queryFn: async () => {
      const api = await environmentApi(input.environmentId);
      if (!input.cwd) throw new Error("Git diff is unavailable.");
      if (!input.path && !input.commit) {
        throw new Error("Git diff needs a file path or commit.");
      }
      return api.git.diff({
        cwd: input.cwd,
        ...(input.path ? { path: input.path } : {}),
        ...(input.commit ? { commit: input.commit } : {}),
      });
    },
    enabled: input.cwd !== null && hasTarget,
    staleTime: isWorkingTreeDiff ? GIT_WORKING_TREE_DIFF_STALE_TIME_MS : Infinity,
    refetchOnWindowFocus: isWorkingTreeDiff,
    refetchOnReconnect: isWorkingTreeDiff,
    refetchInterval: isWorkingTreeDiff ? GIT_WORKING_TREE_DIFF_REFETCH_INTERVAL_MS : false,
  });
}

export function gitConflictSnapshotQueryOptions(input: {
  cwd: string | null;
  path: string | null;
  enabled?: boolean;
  environmentId?: string | undefined;
}) {
  return queryOptions({
    queryKey: scopedGitKey(
      input.environmentId,
      gitQueryKeys.conflictSnapshot(input.cwd, input.path),
    ),
    queryFn: async () => {
      const api = await environmentApi(input.environmentId);
      if (!input.cwd || !input.path) {
        throw new Error("Git conflict snapshot is unavailable.");
      }
      return api.git.readConflictSnapshot({ cwd: input.cwd, path: input.path });
    },
    enabled: input.cwd !== null && input.path !== null && (input.enabled ?? true),
    staleTime: GIT_WORKING_TREE_DIFF_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: GIT_WORKING_TREE_DIFF_REFETCH_INTERVAL_MS,
  });
}

export function gitStashListQueryOptions(cwd: string | null, environmentId?: string) {
  return queryOptions({
    queryKey: scopedGitKey(environmentId, gitQueryKeys.stashes(cwd)),
    queryFn: async () => {
      const api = await environmentApi(environmentId);
      if (!cwd) throw new Error("Git stashes are unavailable.");
      return api.git.listStashes({ cwd });
    },
    enabled: cwd !== null,
    staleTime: GIT_STATUS_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: GIT_STATUS_REFETCH_INTERVAL_MS,
  });
}

export function gitResolvePullRequestQueryOptions(input: {
  cwd: string | null;
  reference: string | null;
  environmentId?: string | undefined;
}) {
  return queryOptions({
    queryKey: scopedGitKey(input.environmentId, [
      "git",
      "pull-request",
      input.cwd,
      input.reference,
    ]),
    queryFn: async () => {
      const api = await environmentApi(input.environmentId);
      if (!input.cwd || !input.reference) {
        throw new Error("Pull request lookup is unavailable.");
      }
      const result = await api.git.resolvePullRequest({
        cwd: input.cwd,
        reference: input.reference,
      });
      writePullRequestSnapshot(input, result);
      return result;
    },
    placeholderData: () => readPullRequestSnapshot(input) ?? undefined,
    enabled: input.cwd !== null && input.reference !== null,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function gitAllPullRequestsQueryOptions(
  cwd: string | null,
  state: "open" | "closed" | "merged" | "all" = "all",
  environmentId?: string,
  limit = 50,
  search = "",
) {
  return queryOptions({
    queryKey: scopedGitKey(environmentId, ["git", "all-pull-requests", cwd, state, limit, search]),
    queryFn: async () => {
      const api = await environmentApi(environmentId);
      if (!cwd) {
        throw new Error("Pull requests lookup is unavailable.");
      }
      return api.git.listPullRequests({
        cwd,
        state,
        limit,
        ...(search ? { query: search } : {}),
      });
    },
    enabled: cwd !== null,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function gitInitMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
  environmentId?: string | undefined;
}) {
  return mutationOptions({
    mutationKey: scopedGitKey(input.environmentId, gitMutationKeys.init(input.cwd)),
    mutationFn: async () => {
      const api = await environmentApi(input.environmentId);
      if (!input.cwd) throw new Error("Git init is unavailable.");
      return api.git.init({ cwd: input.cwd });
    },
    onSuccess: async () => {
      await invalidateGitQueries(input.queryClient);
    },
  });
}

export function gitCheckoutMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
  environmentId?: string | undefined;
}) {
  return mutationOptions({
    mutationKey: scopedGitKey(input.environmentId, gitMutationKeys.checkout(input.cwd)),
    mutationFn: async (branch: string) => {
      const api = await environmentApi(input.environmentId);
      if (!input.cwd) throw new Error("Git checkout is unavailable.");
      return api.git.checkout({ cwd: input.cwd, branch });
    },
    onSuccess: async () => {
      await invalidateGitQueries(input.queryClient);
    },
  });
}

export function gitRunStackedActionMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
  environmentId?: string | undefined;
}) {
  return mutationOptions({
    mutationKey: scopedGitKey(input.environmentId, gitMutationKeys.runStackedAction(input.cwd)),
    mutationFn: async ({
      actionId,
      action,
      commitMessage,
      featureBranch,
      filePaths,
    }: {
      actionId: string;
      action: GitStackedAction;
      commitMessage?: string;
      featureBranch?: boolean;
      filePaths?: string[];
    }) => {
      const api = await environmentApi(input.environmentId);
      if (!input.cwd) throw new Error("Git action is unavailable.");
      return api.git.runStackedAction({
        actionId,
        cwd: input.cwd,
        action,
        ...(commitMessage ? { commitMessage } : {}),
        ...(featureBranch ? { featureBranch } : {}),
        ...(filePaths ? { filePaths } : {}),
      });
    },
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient);
    },
  });
}

export function gitPullMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
  environmentId?: string | undefined;
}) {
  return mutationOptions({
    mutationKey: scopedGitKey(input.environmentId, gitMutationKeys.pull(input.cwd)),
    mutationFn: async () => {
      const api = await environmentApi(input.environmentId);
      if (!input.cwd) throw new Error("Git pull is unavailable.");
      return api.git.pull({ cwd: input.cwd });
    },
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient);
    },
  });
}

export function gitCreateWorktreeMutationOptions(input: {
  queryClient: QueryClient;
  environmentId?: string | undefined;
}) {
  return mutationOptions({
    mutationFn: async ({
      cwd,
      branch,
      newBranch,
      path,
      environmentId,
    }: {
      cwd: string;
      branch: string;
      newBranch: string;
      path?: string | null;
      environmentId?: string | undefined;
    }) => {
      const api = await environmentApi(environmentId ?? input.environmentId);
      if (!cwd) throw new Error("Git worktree creation is unavailable.");
      return api.git.createWorktree({ cwd, branch, newBranch, path: path ?? null });
    },
    mutationKey: scopedGitKey(input.environmentId, ["git", "mutation", "create-worktree"]),
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient);
    },
  });
}

export function gitRemoveWorktreeMutationOptions(input: {
  queryClient: QueryClient;
  environmentId?: string | undefined;
}) {
  return mutationOptions({
    mutationFn: async ({
      cwd,
      path,
      force,
      environmentId,
    }: {
      cwd: string;
      path: string;
      force?: boolean;
      environmentId?: string | undefined;
    }) => {
      const api = await environmentApi(environmentId ?? input.environmentId);
      if (!cwd) throw new Error("Git worktree removal is unavailable.");
      return api.git.removeWorktree({ cwd, path, force });
    },
    mutationKey: scopedGitKey(input.environmentId, ["git", "mutation", "remove-worktree"]),
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient);
    },
  });
}

export function gitPreparePullRequestThreadMutationOptions(input: {
  cwd: string | null;
  queryClient: QueryClient;
  environmentId?: string | undefined;
}) {
  return mutationOptions({
    mutationFn: async ({ reference, mode }: { reference: string; mode: "local" | "worktree" }) => {
      const api = await environmentApi(input.environmentId);
      if (!input.cwd) throw new Error("Pull request thread preparation is unavailable.");
      return api.git.preparePullRequestThread({
        cwd: input.cwd,
        reference,
        mode,
      });
    },
    mutationKey: scopedGitKey(
      input.environmentId,
      gitMutationKeys.preparePullRequestThread(input.cwd),
    ),
    onSettled: async () => {
      await invalidateGitQueries(input.queryClient);
    },
  });
}

const GIT_WORKFLOW_RUNS_STALE_TIME_MS = 60_000;
const GIT_WORKFLOW_RUNS_NORMAL_INTERVAL_MS = 120_000;
const GIT_WORKFLOW_RUNS_POST_PUSH_INTERVAL_MS = 10_000;

export function gitWorkflowRunsQueryOptions(
  cwd: string | null,
  branch: string | null,
  lastPushedAt: number | null,
  environmentId?: string,
) {
  const isPostPushWindow = lastPushedAt !== null && Date.now() - lastPushedAt < 60_000;
  return queryOptions({
    queryKey: scopedGitKey(environmentId, gitQueryKeys.workflowRuns(cwd, branch)),
    queryFn: async () => {
      const api = await environmentApi(environmentId);
      if (!cwd || !branch) throw new Error("Branch workflow runs are unavailable.");
      return api.git.listWorkflowRuns({ cwd, branch, limit: 5 });
    },
    enabled: Boolean(cwd && branch),
    staleTime: GIT_WORKFLOW_RUNS_STALE_TIME_MS,
    refetchInterval: isPostPushWindow
      ? GIT_WORKFLOW_RUNS_POST_PUSH_INTERVAL_MS
      : GIT_WORKFLOW_RUNS_NORMAL_INTERVAL_MS,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
}

export function gitWatchedBranchesQueryOptions(
  cwd: string | null,
  excludedBranches: string[] = [],
  environmentId?: string,
) {
  return queryOptions({
    queryKey: scopedGitKey(environmentId, gitQueryKeys.watchedBranches(cwd, excludedBranches)),
    queryFn: async () => {
      const api = await environmentApi(environmentId);
      if (!cwd) {
        return { branches: [] };
      }
      return await api.git.watchedBranchStatuses({ cwd, excludedBranches });
    },
    enabled: Boolean(cwd),
    refetchInterval: 15_000,
    refetchOnWindowFocus: "always",
  });
}
