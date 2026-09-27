import { describe, expect, it } from "vitest";
import type { OrchestrationReadModel } from "@tabs/contracts";

import type { McpInvocationScope } from "./McpInvocationContext.ts";
import { resolveMcpProjectId } from "./McpProjectScope.ts";

const scope = { threadId: "thread-1" } as McpInvocationScope;

function snapshot(input: {
  readonly threadProjectId?: string;
  readonly threadDeletedAt?: string | null;
  readonly projectDeletedAt?: string | null;
}) {
  return {
    threads:
      input.threadProjectId === undefined
        ? []
        : [
            {
              id: "thread-1",
              projectId: input.threadProjectId,
              deletedAt: input.threadDeletedAt ?? null,
            },
          ],
    projects: [{ id: "project-1", deletedAt: input.projectDeletedAt ?? null }],
  } as unknown as Pick<OrchestrationReadModel, "threads" | "projects">;
}

describe("resolveMcpProjectId", () => {
  it("derives the project from the current thread projection", () => {
    expect(resolveMcpProjectId(scope, snapshot({ threadProjectId: "project-1" }))).toBe(
      "project-1",
    );
  });

  it("does not authorize missing, deleted, or orphaned threads", () => {
    expect(resolveMcpProjectId(scope, snapshot({}))).toBeUndefined();
    expect(
      resolveMcpProjectId(
        scope,
        snapshot({ threadProjectId: "project-1", threadDeletedAt: "2026-09-27T00:00:00Z" }),
      ),
    ).toBeUndefined();
    expect(resolveMcpProjectId(scope, snapshot({ threadProjectId: "project-2" }))).toBeUndefined();
    expect(
      resolveMcpProjectId(
        scope,
        snapshot({ threadProjectId: "project-1", projectDeletedAt: "2026-09-27T00:00:00Z" }),
      ),
    ).toBeUndefined();
  });
});
