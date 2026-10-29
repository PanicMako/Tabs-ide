import "../../index.css";
import {
  NodeId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@tabs/contracts";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { WorkspaceAgents, type WorkspaceAgentContext } from "./WorkspaceAgents";

const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(async (_command: unknown) => ({ sequence: 1 })),
  projection: vi.fn(),
  family: vi.fn(async (_input: unknown) => ({
    snapshotSequence: 1,
    threads: [] as OrchestrationV2ThreadShell[],
  })),
  config: vi.fn(async () => ({
    providers: [
      {
        instanceId: ProviderInstanceId.make("codex"),
        displayName: "Codex",
        status: "ready" as const,
        models: [
          { slug: "test-model", name: "Test Model" },
          { slug: "advanced-model", name: "Advanced Model" },
        ],
      },
      {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        displayName: "Claude Agent",
        status: "ready" as const,
        models: [{ slug: "claude-sonnet", name: "Claude Sonnet" }],
      },
    ],
  })),
}));

vi.mock("../../connection/environmentApiRegistry", () => ({
  environmentApi: async () => ({
    orchestration: {
      dispatchCommand: fixture.dispatch,
      getThreadProjection: fixture.projection,
      getThreadFamily: fixture.family,
    },
    server: {
      getConfig: fixture.config,
    },
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
  fixture.family.mockResolvedValueOnce({ snapshotSequence: 1, threads: [] });
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

it("delegates with provider and model chooser, preserving permissions and stopping active child", async () => {
  fixture.dispatch.mockClear();
  fixture.family.mockResolvedValue({ snapshotSequence: 1, threads: [] });
  fixture.projection.mockResolvedValue({
    runs: [{ id: RunId.make("child-run"), status: "running", ordinal: 1 }],
  });
  const view = await render(<WorkspaceAgents context={context(true)} onOpenThread={() => {}} />);
  try {
    await page.getByRole("button", { name: "Sub-agents 1 active" }).click();
    await page.getByRole("button", { name: "Delegate task", exact: true }).click();
    await page.getByRole("textbox", { name: "Task", exact: true }).fill("Check the API contract");

    // Select alternative provider and model
    const providerSelect = page.getByLabelText("Provider");
    await providerSelect.selectOptions("claudeAgent");
    const modelSelect = page.getByLabelText("Model");
    await modelSelect.selectOptions("claude-sonnet");

    await page.getByRole("button", { name: "Delegate", exact: true }).click();
    await expect.poll(() => fixture.dispatch.mock.calls.length).toBe(1);
    expect(fixture.dispatch.mock.calls[0]![0]).toMatchObject({
      type: "delegated_task.request",
      parentThreadId: parent,
      parentRunId: "run",
      parentNodeId: "root",
      task: "Check the API contract",
      modelSelection: {
        instanceId: "claudeAgent",
        model: "claude-sonnet",
      },
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
  fixture.family.mockResolvedValueOnce({
    snapshotSequence: 1,
    threads: [
      {
        id: parent,
        projectId: "proj" as any,
        title: "Parent Thread",
        status: "idle",
        activityRunStatus: null,
        latestRunId: null,
        modelSelection: null,
        lineage: { parentThreadId: null, rootThreadId: null, relationshipToParent: null },
        forkedFrom: null,
        runtimeMode: "full-access",
        interactionMode: "default",
        archivedAt: null,
        deletedAt: null,
        settledAt: null,
        createdAt: null,
        updatedAt: null,
      } as unknown as OrchestrationV2ThreadShell,
    ],
  });
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

it("displays ancestors, forks, and long family pagination with show more", async () => {
  // Create 15 sibling/child threads to trigger pagination (initial 6 + show more)
  const familyList: OrchestrationV2ThreadShell[] = Array.from({ length: 15 }, (_, i) => ({
    id: ThreadId.make(`child-${i}`),
    projectId: "proj" as any,
    title: `Subagent Worker ${i}`,
    status: "idle",
    activityRunStatus: null,
    lineage: { parentThreadId: parent, rootThreadId: parent, relationshipToParent: "subagent" },
    forkedFrom: null,
    modelSelection: { instanceId: "codex" as any, model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    archivedAt: null,
    deletedAt: null,
    settledAt: null,
    createdAt: null,
    updatedAt: null,
  })) as unknown as OrchestrationV2ThreadShell[];

  fixture.family.mockResolvedValueOnce({ snapshotSequence: 1, threads: familyList });
  const open = vi.fn();
  const view = await render(<WorkspaceAgents context={context(false)} onOpenThread={open} />);
  try {
    await page.getByRole("button", { name: /Sub-agents/ }).click();

    // Verify pagination button is shown for remaining items
    const showMoreButton = page.getByRole("button", { name: /Show \d+ more \(\d+ remaining\)/ });
    await expect.element(showMoreButton).toBeInTheDocument();

    // Clicking show more expands the rest
    await showMoreButton.click();
    await expect
      .element(page.getByRole("button", { name: "Subagent Worker 14" }))
      .toBeInTheDocument();
  } finally {
    await view.unmount();
  }
});

it("handles missing or unavailable relatives safely without crashing", async () => {
  // Family references a parent that is missing from shell
  const missingParent = ThreadId.make("missing-parent-id");
  const ctxWithMissingParent: WorkspaceAgentContext = {
    ...context(false),
    thread: {
      ...context(false).thread,
      lineage: {
        parentThreadId: missingParent,
        rootThreadId: missingParent,
        relationshipToParent: "subagent",
      },
    },
  };
  fixture.family.mockResolvedValueOnce({ snapshotSequence: 1, threads: [] });

  const view = await render(
    <WorkspaceAgents context={ctxWithMissingParent} onOpenThread={() => {}} />,
  );
  try {
    await page.getByRole("button", { name: /Sub-agents/ }).click();
    // Missing relative should be rendered with unavailable indicator and disabled button
    await expect
      .element(page.getByRole("button", { name: /Unavailable conversation/ }))
      .toBeDisabled();
  } finally {
    await view.unmount();
  }
});

it("merges a completed fork into its parent even though the parent is outside family rows", async () => {
  fixture.dispatch.mockClear();
  const target = ThreadId.make("fork-parent");
  const ctx = context(false);
  const fork: WorkspaceAgentContext = {
    ...ctx,
    thread: {
      ...ctx.thread,
      lineage: { parentThreadId: target, rootThreadId: target, relationshipToParent: "fork" },
    },
    runs: [{ ...context(true).runs[0]!, status: "completed" }],
  };
  fixture.family.mockResolvedValueOnce({
    snapshotSequence: 1,
    threads: [
      {
        ...ctx.thread,
        id: target,
        title: "Parent",
        lineage: { parentThreadId: null, rootThreadId: target, relationshipToParent: null },
      } as unknown as OrchestrationV2ThreadShell,
    ],
  });
  const open = vi.fn();
  const view = await render(<WorkspaceAgents context={fork} onOpenThread={open} />);
  try {
    await page.getByRole("button", { name: /Sub-agents/ }).click();
    const merge = page.getByRole("button", { name: "Merge result into parent", exact: true });
    await expect.element(merge).toBeEnabled();
    await merge.click();
    await expect.poll(() => open.mock.calls.length).toBe(1);
    expect(fixture.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.merge_back",
        sourceThreadId: parent,
        targetThreadId: target,
      }),
    );
    expect(open).toHaveBeenCalledWith(target);
  } finally {
    await view.unmount();
  }
});
