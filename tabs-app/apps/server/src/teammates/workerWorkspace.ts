import * as Effect from "effect/Effect";

import type { ThreadLaunchWorkspaceStrategy } from "../orchestration-v2/ThreadLaunchService.ts";

/** What choosing a worker's workspace needs from git; kept small so it is easy to fake. */
export interface WorkerGit {
  readonly isRepository: (cwd: string) => Effect.Effect<boolean>;
  /** The repository's own default branch (remote HEAD), else the checked-out branch; null if neither. */
  readonly defaultBranch: (cwd: string) => Effect.Effect<string | null>;
}

/**
 * Orca's worker model: a worker gets its own new worktree whenever its project is a git repo,
 * based on the repo's real default branch, unless the agent says otherwise. A project that is not
 * a repo, or a repo with no resolvable branch, runs in place.
 */
export const chooseWorkerWorkspace = (
  git: WorkerGit,
  projectRoot: string,
  input: { readonly newWorktree?: boolean | undefined; readonly baseRef?: string | undefined },
): Effect.Effect<ThreadLaunchWorkspaceStrategy> =>
  Effect.gen(function* () {
    if (input.newWorktree === false) return { type: "root" } as const;
    if (!(yield* git.isRepository(projectRoot))) return { type: "root" } as const;
    const baseRef = input.baseRef?.trim() || (yield* git.defaultBranch(projectRoot));
    if (baseRef === null || baseRef === undefined || baseRef === "")
      return { type: "root" } as const;
    // The launcher falls back to the local branch when the repo has no origin remote.
    return { type: "worktree", baseRef, startFromOrigin: true } as const;
  });
