import { describe, expect, it } from "vitest";
import type { ProjectId, ThreadId } from "@tabs/contracts";
import { rememberThreadTarget, rememberedThreadTarget } from "./useActiveProjectTarget";

describe("thread targets for side-panel surfaces", () => {
  it("remembers where an open thread last lived, so it survives leaving the thread list", () => {
    const threadId = "thread-remembered" as ThreadId;
    expect(rememberedThreadTarget(threadId)).toBeNull();
    const target = {
      environmentId: null,
      projectId: "project-1" as ProjectId,
      cwd: "/work/tree",
      projectCwd: "/work",
      projectName: "Work",
      threadId,
    };
    rememberThreadTarget(target);
    expect(rememberedThreadTarget(threadId)).toEqual(target);
  });

  it("ignores targets without a thread", () => {
    rememberThreadTarget({
      environmentId: null,
      projectId: "project-2" as ProjectId,
      cwd: "/p",
      projectCwd: "/p",
      projectName: "P",
      threadId: null,
    });
    rememberThreadTarget(null);
    expect(rememberedThreadTarget("thread-none" as ThreadId)).toBeNull();
  });
});
