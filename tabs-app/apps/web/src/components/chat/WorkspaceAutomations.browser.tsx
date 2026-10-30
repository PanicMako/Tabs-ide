import { useWorkspaceActionsState } from "./workspaceActionsState";
import "../../index.css";
import { ThreadId, type ScheduledTask, type ScheduledTaskListResult } from "@tabs/contracts";
import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { WorkspaceAutomations } from "./WorkspaceAutomations";
import type { WorkspaceAgentContext } from "./WorkspaceAgents";
const calls = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  upsert: vi.fn(async (_input: unknown) => ({})),
  enabled: vi.fn(async (_input: unknown) => ({})),
  run: vi.fn(async (_input: unknown) => ({})),
}));
beforeEach(() => {
  useWorkspaceActionsState.setState({ entries: {} });
});

vi.mock("../../connection/environmentApiRegistry", () => ({
  environmentApi: async () => ({
    scheduledTasks: {
      subscribe: calls.subscribe,
      upsert: calls.upsert,
      setEnabled: calls.enabled,
      runNow: calls.run,
    },
  }),
}));
const threadId = ThreadId.make("thread:automation");
const context = {
  thread: {
    id: threadId,
    projectId: "project",
    modelSelection: { instanceId: "codex", model: "test" },
    runtimeMode: "approval-required",
    interactionMode: "default",
    worktreePath: null,
  },
} as unknown as WorkspaceAgentContext;
it("subscribes only when expanded, scopes tasks to the thread, and saves an inherited recurring task", async () => {
  const task = {
    id: "schedule:1",
    title: "Daily review",
    threadId,
    enabled: true,
    schedule: { type: "interval", everyMs: 60000 },
    lastRunStatus: "never",
    nextRunAt: null,
  } as ScheduledTask;
  calls.subscribe.mockImplementation((receive: (value: ScheduledTaskListResult) => void) => {
    receive({
      tasks: [
        task,
        {
          ...task,
          id: "other" as ScheduledTask["id"],
          threadId: ThreadId.make("other-thread"),
          title: "Private other task",
        },
      ],
    });
    return calls.unsubscribe;
  });
  const view = await render(<WorkspaceAutomations context={context} />);
  try {
    expect(calls.subscribe).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Automations", exact: true }).click();
    await expect.element(page.getByText("Daily review", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Private other task", { exact: true }))
      .not.toBeInTheDocument();
    await page.getByRole("switch", { name: "Enable Daily review" }).click();
    await expect.poll(() => calls.enabled.mock.calls.length).toBe(1);
    expect(calls.enabled.mock.calls[0]![0]).toEqual({ id: task.id, enabled: false });
    await page.getByRole("button", { name: "Run now", exact: true }).click();
    await expect.poll(() => calls.run.mock.calls.length).toBe(1);
    await page.getByRole("button", { name: "Add automation", exact: true }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Check tests");
    await page
      .getByRole("textbox", { name: "Prompt", exact: true })
      .fill("Run the test suite and report failures");
    await page.getByRole("button", { name: "Save automation", exact: true }).click();
    await expect.poll(() => calls.upsert.mock.calls.length).toBe(1);
    expect(calls.upsert.mock.calls[0]![0]).toMatchObject({
      title: "Check tests",
      threadId,
      projectId: "project",
      runtimeMode: "approval-required",
      schedule: { type: "interval", everyMs: 3600000 },
      workspaceStrategy: { type: "root" },
      createdBy: "user",
    });
  } finally {
    await view.unmount();
  }
  expect(calls.unsubscribe).toHaveBeenCalledOnce();
});
