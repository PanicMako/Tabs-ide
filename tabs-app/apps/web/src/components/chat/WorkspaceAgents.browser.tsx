import "../../index.css";
import { NodeId, ProviderInstanceId, RunId, ThreadId } from "@tabs/contracts";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { WorkspaceAgents, type WorkspaceAgentContext } from "./WorkspaceAgents";

const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(async (_command: unknown) => ({ sequence: 1 })),
  projection: vi.fn(),
}));
vi.mock("../../connection/environmentApiRegistry", () => ({
  environmentApi: async () => ({
    orchestration: { dispatchCommand: fixture.dispatch, getThreadProjection: fixture.projection },
  }),
}));
const parent = ThreadId.make("parent");
const child = ThreadId.make("child");
const context = (active: boolean): WorkspaceAgentContext =>
  ({
    thread: {
      id: parent,
      modelSelection: { instanceId: "codex", model: "test-model" },
      runtimeMode: "approval-required",
      interactionMode: "default",
      lineage: { parentThreadId: null, rootThreadId: parent, relationshipToParent: null },
    },
    runs: active
      ? [
          {
            id: RunId.make("run"),
            rootNodeId: NodeId.make("root"),
            ordinal: 1,
            status: "running",
            modelSelection: { instanceId: "codex", model: "test-model" },
            providerInstanceId: ProviderInstanceId.make("codex"),
          },
        ]
      : [],
    subagents: [
      {
        id: NodeId.make("task"),
        childThreadId: child,
        origin: "app_owned",
        title: "Review the change",
        prompt: "Review",
        result: "Looks good",
        status: active ? "running" : "completed",
        model: "test-model",
      },
    ],
  }) as unknown as WorkspaceAgentContext;

it("shows actual child status and opens the child; idle parents cannot delegate", async () => {
  const open = vi.fn();
  const view = await render(<WorkspaceAgents context={context(false)} onOpenThread={open} />);
  try {
    await page.getByRole("button", { name: "Sub-agents 1" }).click();
    await expect.element(page.getByRole("status")).toHaveTextContent("completed");
    await page.getByRole("button", { name: /Review the change/ }).click();
    expect(open).toHaveBeenCalledWith(child);
    await expect
      .element(page.getByRole("button", { name: "Delegate task", exact: true }))
      .toBeDisabled();
  } finally {
    await view.unmount();
  }
});
it("delegates with inherited permissions and supports stopping a child", async () => {
  fixture.dispatch.mockClear();
  fixture.projection.mockResolvedValue({
    runs: [{ id: RunId.make("child-run"), status: "running", ordinal: 1 }],
  });
  const view = await render(<WorkspaceAgents context={context(true)} onOpenThread={() => {}} />);
  try {
    await page.getByRole("button", { name: "Sub-agents 1 active" }).click();
    await page.getByRole("button", { name: "Delegate task", exact: true }).click();
    await page.getByRole("textbox", { name: "Task", exact: true }).fill("Check the API contract");
    await page.getByRole("button", { name: "Delegate", exact: true }).click();
    await expect.poll(() => fixture.dispatch.mock.calls.length).toBe(1);
    expect(fixture.dispatch.mock.calls[0]![0]).toMatchObject({
      type: "delegated_task.request",
      parentThreadId: parent,
      parentRunId: "run",
      parentNodeId: "root",
      task: "Check the API contract",
      runtimeMode: "approval-required",
      interactionMode: "default",
      createdBy: "user",
      creationSource: "web",
      completionWake: "always",
    });
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect.poll(() => fixture.dispatch.mock.calls.length).toBe(2);
    expect(fixture.dispatch.mock.calls[1]![0]).toMatchObject({
      type: "run.interrupt",
      threadId: child,
      runId: "child-run",
      holdQueue: true,
    });
  } finally {
    await view.unmount();
  }
});

it("keeps provider-owned child controls read-only and routes delegation to the parent", async () => {
  const base = context(true);
  const native = {
    ...base,
    thread: {
      ...base.thread,
      creationSource: "provider" as const,
      lineage: {
        ...base.thread.lineage,
        parentThreadId: parent,
        relationshipToParent: "subagent" as const,
      },
    },
  };
  const open = vi.fn();
  const view = await render(<WorkspaceAgents context={native} onOpenThread={open} />);
  try {
    await page.getByRole("button", { name: "Sub-agents 1 active" }).click();
    await expect
      .element(page.getByRole("button", { name: "Delegate task", exact: true }))
      .toBeDisabled();
    await expect
      .element(page.getByRole("button", { name: "Automations", exact: true }))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: "Open parent conversation", exact: true }).click();
    expect(open).toHaveBeenCalledWith(parent);
  } finally {
    await view.unmount();
  }
});
