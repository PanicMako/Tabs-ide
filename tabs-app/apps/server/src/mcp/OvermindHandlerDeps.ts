import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { join } from "node:path";

import * as ServerConfig from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
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
/**
 * The user's sub-agent models, read fresh on every call so a change in
 * settings applies to the next sub-agent. Unreadable settings mean "the lead
 * chooses" rather than a failed delegation.
 */
export const loadSubagentModels = Effect.gen(function* () {
  const service = yield* Effect.serviceOption(ServerSettingsService);
  if (Option.isNone(service)) return undefined;
  return yield* service.value.getSettings.pipe(
    Effect.map((value) => value.subagentModels),
    Effect.catch(() => Effect.succeed(undefined)),
  );
});

export const resolveOvermindDeps = (scope: McpInvocationScope) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const store = makeFileOvermindPlanStore(join(config.stateDir, "overmind"));
    if (scope.thread === undefined) return { store } satisfies OvermindDriverDeps;
    const resolved = yield* Effect.gen(function* () {
      const { projection } = yield* readThread(scope.thread!.threadId);
      const settings = yield* loadSubagentModels;
      const projects = yield* ProjectService.ProjectService;
      const project = yield* projects.getById(projection.thread.projectId);
      const git = yield* GitWorkflowService.GitWorkflowService;
      const leadCwd =
        projection.thread.worktreePath ??
        (Option.isSome(project) ? project.value.workspaceRoot : null);
      if (leadCwd === null) return { store, settings } satisfies OvermindDriverDeps;
      const isRepository = yield* git.isRepository(leadCwd);
      return {
        store,
        leadCwd,
        settings,
        ...(isRepository ? { host: makeOvermindWorkspaceHost({ leadCwd, git }) } : {}),
      } satisfies OvermindDriverDeps;
    }).pipe(Effect.catch(() => Effect.succeed({ store } satisfies OvermindDriverDeps)));
    return resolved;
  });
