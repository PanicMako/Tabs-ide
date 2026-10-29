import "../../index.css";
import {
  ThreadId,
  ScheduledTaskId,
  ScheduledTaskWebhookDeliveryId,
  type ScheduledTask,
  type ScheduledTaskListResult,
} from "@tabs/contracts";
import { expect, it, vi } from "vitest";
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
  delete: vi.fn(async (_input: unknown) => ({})),
  rotateToken: vi.fn(async (_input: unknown) => ({})),
  listDeliveries: vi.fn(async (_input: unknown) => ({
    deliveries: [
      {
        id: "del:1" as ScheduledTaskWebhookDeliveryId,
        taskId: "schedule:webhook" as ScheduledTaskId,
        receivedAt: "2026-10-27T10:00:00.000Z",
        method: "POST",
        contentType: "application/json",
        bodyBytes: 42,
        outcome: "accepted",
        signatureVerified: true,
        missingFields: [],
        error: null,
      },
    ],
  })),
  getDelivery: vi.fn(async (_input: unknown) => ({
    delivery: {
      id: "del:1" as ScheduledTaskWebhookDeliveryId,
      taskId: "schedule:webhook" as ScheduledTaskId,
      receivedAt: "2026-10-27T10:00:00.000Z",
      method: "POST",
      contentType: "application/json",
      bodyBytes: 42,
      outcome: "accepted",
      signatureVerified: true,
      missingFields: [],
      error: null,
      query: "branch=main",
      headers: { "x-hub-signature-256": "sha256=test" },
      body: '{"action":"opened"}',
      bodyTruncated: false,
      renderedPrompt: "PR action opened on main",
    },
  })),
}));

vi.mock("../../connection/environmentApiRegistry", () => ({
  environmentApi: async () => ({
    scheduledTasks: {
      subscribe: calls.subscribe,
      upsert: calls.upsert,
      setEnabled: calls.enabled,
      runNow: calls.run,
      delete: calls.delete,
      rotateWebhookToken: calls.rotateToken,
      listWebhookDeliveries: calls.listDeliveries,
      getWebhookDelivery: calls.getDelivery,
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
    id: "schedule:1" as ScheduledTaskId,
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
          id: "other" as ScheduledTaskId,
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

it("enforces interval minimum validation and supports weekday selection", async () => {
  calls.subscribe.mockImplementation((receive: (value: ScheduledTaskListResult) => void) => {
    receive({ tasks: [] });
    return calls.unsubscribe;
  });

  const view = await render(<WorkspaceAutomations context={context} />);
  try {
    await page.getByRole("button", { name: "Automations", exact: true }).click();
    await page.getByRole("button", { name: "Add automation", exact: true }).click();

    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Daily backup");
    await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Create a backup");

    // Interval minimum validation (< 1 min disables button and shows error)
    const minutesInput = page.getByRole("spinbutton", { name: "Minutes" });
    await minutesInput.fill("0");
    await expect.element(page.getByText("Interval must be at least 1 minute.")).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Save automation" })).toBeDisabled();

    // Select daily / fixed time and choose Monday and Friday
    const scheduleSelect = page.getByRole("combobox", { name: "Schedule type" });
    await scheduleSelect.selectOptions("fixed_time");
    await page.getByRole("button", { name: "Mon", exact: true }).click();
    await page.getByRole("button", { name: "Fri", exact: true }).click();

    await page.getByRole("button", { name: "Save automation", exact: true }).click();
    await expect.poll(() => calls.upsert.mock.calls.length).toBe(2);
    expect(calls.upsert.mock.calls[1]![0]).toMatchObject({
      title: "Daily backup",
      schedule: {
        type: "fixed_time",
        weekdays: [1, 5],
      },
    });
  } finally {
    await view.unmount();
  }
});

it("deletes automations with custom confirmation and supports canceling deletion", async () => {
  const task = {
    id: "schedule:to-delete" as ScheduledTaskId,
    title: "Obsolete task",
    threadId,
    enabled: true,
    schedule: { type: "interval", everyMs: 60000 },
    lastRunStatus: "never",
    nextRunAt: null,
  } as ScheduledTask;

  calls.subscribe.mockImplementation((receive: (value: ScheduledTaskListResult) => void) => {
    receive({ tasks: [task] });
    return calls.unsubscribe;
  });

  const view = await render(<WorkspaceAutomations context={context} />);
  try {
    await page.getByRole("button", { name: "Automations", exact: true }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    // Custom confirm dialog appears
    await expect
      .element(page.getByText('Delete automation "Obsolete task"? This cannot be undone.'))
      .toBeInTheDocument();

    // Cancel first
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(calls.delete).not.toHaveBeenCalled();

    // Click delete again and confirm
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.poll(() => calls.delete.mock.calls.length).toBe(1);
    expect(calls.delete.mock.calls[0]![0]).toEqual({ id: task.id });
  } finally {
    await view.unmount();
  }
});

it("handles webhook token rotation, delivery inspection, and deliberate credential copy", async () => {
  const webhookTask = {
    id: "schedule:webhook" as ScheduledTaskId,
    title: "CI Webhook",
    threadId,
    enabled: true,
    schedule: {
      type: "webhook",
      signature: { header: "x-hub-signature-256", encoding: "hex", prefix: "sha256=" },
      maxDeliveryAgeMinutes: 60,
    },
    webhook: {
      path: "/api/webhooks/schedule:webhook?token=secret123",
      url: "https://connect.tabs.example/api/webhooks/schedule:webhook?token=secret123",
      hasSecret: true,
    },
    lastRunStatus: "succeeded",
    nextRunAt: null,
  } as ScheduledTask;

  calls.subscribe.mockImplementation((receive: (value: ScheduledTaskListResult) => void) => {
    receive({ tasks: [webhookTask] });
    return calls.unsubscribe;
  });

  // Mock clipboard
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

  const view = await render(<WorkspaceAutomations context={context} />);
  try {
    await page.getByRole("button", { name: "Automations", exact: true }).click();

    // Webhooks do not show "Run now"
    await expect.element(page.getByRole("button", { name: "Run now" })).not.toBeInTheDocument();

    // URL is masked by default
    await expect.element(page.getByText("••••••••••••••••••••••••••••••••")).toBeInTheDocument();

    // Reveal toggle reveals URL
    await page.getByRole("button", { name: "Reveal URL" }).click();
    await expect.element(page.getByText(webhookTask.webhook!.url!)).toBeInTheDocument();

    // Copy URL copies to clipboard
    await page.getByRole("button", { name: "Copy webhook URL" }).click();
    expect(writeText).toHaveBeenCalledWith(webhookTask.webhook!.url!);

    // Rotate token with custom confirmation
    await page.getByRole("button", { name: "Rotate token", exact: true }).click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.poll(() => calls.rotateToken.mock.calls.length).toBe(1);
    expect(calls.rotateToken.mock.calls[0]![0]).toEqual({ id: webhookTask.id });

    // Inspect deliveries
    await page.getByRole("button", { name: "Deliveries", exact: true }).click();
    await expect.element(page.getByText("Webhook deliveries")).toBeInTheDocument();
    await expect.element(page.getByText("42 bytes")).toBeInTheDocument();

    // Click delivery to view detail
    await page.getByText("POST").click();
    await expect.element(page.getByText("PR action opened on main")).toBeInTheDocument();

    await page.getByRole("button", { name: "Close" }).first().click();
  } finally {
    await view.unmount();
  }
});

it("rejects stale edits with requireExisting and preserves fields without conversion", async () => {
  const existingTask = {
    id: "schedule:stale" as ScheduledTaskId,
    title: "Existing Task",
    prompt: "Existing prompt",
    threadId,
    enabled: true,
    schedule: { type: "interval", everyMs: 120000 },
    workspaceStrategy: { type: "root" },
    modelSelection: { instanceId: "codex", model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    lastRunStatus: "never",
    nextRunAt: null,
  } as ScheduledTask;

  calls.subscribe.mockImplementation((receive: (value: ScheduledTaskListResult) => void) => {
    receive({ tasks: [existingTask] });
    return calls.unsubscribe;
  });

  const view = await render(<WorkspaceAutomations context={context} />);
  try {
    await page.getByRole("button", { name: "Automations", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();

    // Edit title
    const nameInput = page.getByRole("textbox", { name: "Name", exact: true });
    await nameInput.clear();
    await nameInput.fill("Updated Title");

    await page.getByRole("button", { name: "Save automation", exact: true }).click();
    await expect.poll(() => calls.upsert.mock.calls.length).toBe(3);

    // Verified: requireExisting is true and IDs and strategies are preserved
    expect(calls.upsert.mock.calls[2]![0]).toMatchObject({
      id: "schedule:stale",
      requireExisting: true,
      title: "Updated Title",
      prompt: "Existing prompt",
      workspaceStrategy: { type: "root" },
      modelSelection: { instanceId: "codex", model: "gpt-5" },
      runtimeMode: "full-access",
    });
  } finally {
    await view.unmount();
  }
});

it("disables mutation controls for readonly users", async () => {
  const task = {
    id: "schedule:ro" as ScheduledTaskId,
    title: "Readonly inspection",
    threadId,
    enabled: true,
    schedule: { type: "interval", everyMs: 60000 },
    lastRunStatus: "never",
    nextRunAt: null,
  } as ScheduledTask;

  calls.subscribe.mockImplementation((receive: (value: ScheduledTaskListResult) => void) => {
    receive({ tasks: [task] });
    return calls.unsubscribe;
  });

  const view = await render(<WorkspaceAutomations context={context} readonly={true} />);
  try {
    await page.getByRole("button", { name: "Automations", exact: true }).click();
    await expect.element(page.getByText("Readonly inspection")).toBeInTheDocument();

    // Mutate buttons are disabled or omitted
    await expect
      .element(page.getByRole("switch", { name: "Enable Readonly inspection" }))
      .toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Run now" })).toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Add automation" }))
      .not.toBeInTheDocument();
  } finally {
    await view.unmount();
  }
});

it("preserves a fractional-minute interval when editing the title", async () => {
  calls.upsert.mockClear();
  const task = {
    id: "schedule:fractional" as ScheduledTaskId,
    title: "Fractional interval",
    prompt: "Check",
    threadId,
    enabled: true,
    schedule: { type: "interval", everyMs: 90000 },
    lastRunStatus: "never",
    nextRunAt: null,
  } as ScheduledTask;
  calls.subscribe.mockImplementation((receive: (value: ScheduledTaskListResult) => void) => {
    receive({ tasks: [task] });
    return calls.unsubscribe;
  });
  const view = await render(<WorkspaceAutomations context={context} />);
  try {
    await page.getByRole("button", { name: "Automations", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Renamed interval");
    await page.getByRole("button", { name: "Save automation", exact: true }).click();
    await expect.poll(() => calls.upsert.mock.calls.length).toBe(1);
    expect(calls.upsert.mock.calls[0]![0]).toMatchObject({
      schedule: { type: "interval", everyMs: 90000 },
    });
  } finally {
    await view.unmount();
  }
});
