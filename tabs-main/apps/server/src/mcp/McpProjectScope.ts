import type { OrchestrationReadModel, ProjectId } from "@tabs/contracts";

import type { McpInvocationScope } from "./McpInvocationContext.ts";

/**
 * MCP credentials identify a provider thread, not a client-supplied project.
 * Resolve the project from the current server projection on every request so a
 * deleted or moved thread cannot keep using a stale project authorization.
 */
export function resolveMcpProjectId(
  scope: McpInvocationScope,
  snapshot: Pick<OrchestrationReadModel, "threads" | "projects">,
): ProjectId | undefined {
  const thread = snapshot.threads.find(
    (candidate) => candidate.id === scope.threadId && candidate.deletedAt === null,
  );
  if (!thread) return undefined;
  const project = snapshot.projects.find(
    (candidate) => candidate.id === thread.projectId && candidate.deletedAt === null,
  );
  return project?.id;
}
