import { ProjectId, ThreadId } from "@tabs/contracts";
import { describe, expect, it } from "vitest";

import { collectActiveTerminalThreadIds } from "./terminalStateCleanup";

const threadId = (id: string): ThreadId => ThreadId.makeUnsafe(id);
const projectId = (id: string): ProjectId => ProjectId.makeUnsafe(id);

describe("collectActiveTerminalThreadIds", () => {
  it("retains non-deleted server threads", () => {
    const activeThreadIds = collectActiveTerminalThreadIds({
      snapshotThreads: [
        { id: threadId("server-1"), deletedAt: null },
        { id: threadId("server-2"), deletedAt: null },
      ],
      draftThreadIds: [],
      projectIds: [],
    });

    expect(activeThreadIds).toEqual(new Set([threadId("server-1"), threadId("server-2")]));
  });

  it("ignores deleted server threads and keeps local draft threads", () => {
    const activeThreadIds = collectActiveTerminalThreadIds({
      snapshotThreads: [
        { id: threadId("server-active"), deletedAt: null },
        { id: threadId("server-deleted"), deletedAt: "2026-03-05T08:00:00.000Z" },
      ],
      draftThreadIds: [threadId("local-draft")],
      projectIds: [],
    });

    expect(activeThreadIds).toEqual(new Set([threadId("server-active"), threadId("local-draft")]));
  });

  it("retains synthetic server and git terminal threads for known projects", () => {
    const pid1 = projectId("proj-1");
    const pid2 = projectId("proj-2");
    const activeThreadIds = collectActiveTerminalThreadIds({
      snapshotThreads: [],
      draftThreadIds: [],
      projectIds: [pid1, pid2],
    });

    expect(activeThreadIds).toEqual(
      new Set([
        threadId(`server:${pid1}`),
        threadId(`git:${pid1}`),
        threadId(`server:${pid2}`),
        threadId(`git:${pid2}`),
      ]),
    );
  });

  it("retains custom-process terminal threads for projects that have them", () => {
    const pid = projectId("proj-a");
    const activeThreadIds = collectActiveTerminalThreadIds({
      snapshotThreads: [],
      draftThreadIds: [],
      projectIds: [pid],
      customProcessIdsByProjectId: new Map([[pid, ["process-1", "process-2"]]]),
    });

    expect(activeThreadIds).toContain(threadId(`server:${pid}:custom:process-1`));
    expect(activeThreadIds).toContain(threadId(`server:${pid}:custom:process-2`));
  });

  it("does not delete synthetic threads even when no orchestration threads exist", () => {
    // Regression: switching to a different project should not wipe server/git
    // terminal state from the first project.
    const pid = projectId("project-with-running-servers");
    const activeThreadIds = collectActiveTerminalThreadIds({
      snapshotThreads: [],
      draftThreadIds: [],
      projectIds: [pid],
    });

    expect(activeThreadIds).toContain(threadId(`server:${pid}`));
    expect(activeThreadIds).toContain(threadId(`git:${pid}`));
  });
});
