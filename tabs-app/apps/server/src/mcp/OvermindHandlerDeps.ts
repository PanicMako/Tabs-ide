import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { join } from "node:path";

import * as ServerConfig from "../config.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import type { OvermindDriverDeps } from "./OvermindMcp.ts";
import { makeFileOvermindPlanStore, makeOvermindWorkspaceHost } from "./OvermindWorkspace.ts";
import { readThread } from "./threadAccess.ts";

/**
 * The lead's checkout, a worktree-capable git host and an on-disk plan store.
 * Anything unavailable degrades gracefully: without a git host sub-threads
 * share the lead's checkout, without the store plans live in memory only.
 */
export const resolveOvermindDeps = (scope: McpInvocationScope) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const store = makeFileOvermindPlanStore(join(config.stateDir, "overmind"));
    if (scope.thread === undefined) return { store } satisfies OvermindDriverDeps;
    const resolved = yield* Effect.gen(function* () {
      const { projection } = yield* readThread(scope.thread!.threadId);
      const projects = yield* ProjectService.ProjectService;
      const project = yield* projects.getById(projection.thread.projectId);
      const git = yield* GitWorkflowService.GitWorkflowService;
      const leadCwd =
        projection.thread.worktreePath ??
        (Option.isSome(project) ? project.value.workspaceRoot : null);
      if (leadCwd === null) return { store } satisfies OvermindDriverDeps;
      const isRepository = yield* git.isRepository(leadCwd);
      return {
        store,
        leadCwd,
        ...(isRepository ? { host: makeOvermindWorkspaceHost({ leadCwd, git }) } : {}),
      } satisfies OvermindDriverDeps;
    }).pipe(Effect.catch(() => Effect.succeed({ store } satisfies OvermindDriverDeps)));
    return resolved;
  });
