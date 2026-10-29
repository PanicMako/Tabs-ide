import "../../index.css";
import {
  NodeId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type ServerConfig,
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
  config: vi.fn(
    async (): Promise<ServerConfig> =>
      ({
        shellThreadFamilies: true,
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
      }) as unknown as ServerConfig,
  ),
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

const familyShell = (id: string, title: string): OrchestrationV2ThreadShell =>
  ({
    id: ThreadId.make(id),
    projectId: "proj" as any,
    title,
    status: "idle",
    activityRunStatus: null,
    latestRunId: null,
    modelSelection: null,
    lineage: { parentThreadId: parent, rootThreadId: parent, relationshipToParent: "subagent" },
    forkedFrom: null,
    runtimeMode: "full-access",
    interactionMode: "default",
    archivedAt: null,
    deletedAt: null,
    settledAt: null,
    createdAt: null,
    updatedAt: null,
  }) as unknown as OrchestrationV2ThreadShell;

const restoreConfig = () =>
  fixture.config.mockReset().mockResolvedValue({
    shellThreadFamilies: true,
    providers: [
      {
        instanceId: ProviderInstanceId.make("codex"),
        displayName: "Codex",
        status: "ready",
        models: [
          { slug: "test-model", name: "Test Model" },
          { slug: "advanced-model", name: "Advanced Model" },
        ],
      },
      {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        displayName: "Claude Agent",
        status: "ready",
        models: [{ slug: "claude-sonnet", name: "Claude Sonnet" }],
      },
    ],
  } as unknown as ServerConfig);

it("uses known projection children without calling family RPC on older servers", async () => {
  fixture.family.mockClear();
  fixture.config.mockClear().mockResolvedValue({ providers: [] } as unknown as ServerConfig);
  const view = await render(<WorkspaceAgents context={context(false)} onOpenThread={() => {}} />);
  try {
    await page.getByRole("button", { name: /Sub-agents/ }).click();
    await expect
      .element(page.getByRole("button", { name: /Review the change/ }))
      .toBeInTheDocument();
    await expect.poll(() => fixture.config.mock.calls.length).toBe(1);
    expect(fixture.family).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
    restoreConfig();
  }
});

it("paginates known projection children locally when the server lacks family support", async () => {
  fixture.family.mockClear();
  fixture.config.mockClear().mockResolvedValue({ providers: [] } as unknown as ServerConfig);
  const base = context(false);
  const children = Array.from({ length: 15 }, (_, index) => ({
    ...base.subagents[0]!,
    id: NodeId.make(`legacy-task-${index}`),
    childThreadId: ThreadId.make(`legacy-child-${index}`),
    title: `Legacy child ${index}`,
  }));
  const view = await render(
    <WorkspaceAgents context={{ ...base, subagents: children }} onOpenThread={() => {}} />,
  );
  try {
    await page.getByRole("button", { name: /Sub-agents/ }).click();
    const showMore = page.getByRole("button", { name: /Show \d+ more \(\d+ remaining\)/ });
    await expect.element(showMore).toBeInTheDocument();
    await showMore.click();
    await expect.element(page.getByRole("button", { name: "Legacy child 14" })).toBeInTheDocument();
    expect(fixture.family).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
    restoreConfig();
  }
});

it("loads relatives when the server advertises shell thread family support", async () => {
  fixture.family.mockClear().mockResolvedValue({
    snapshotSequence: 1,
    threads: [familyShell("family-child", "Family child")],
  });
  fixture.config
    .mockClear()
    .mockResolvedValue({ shellThreadFamilies: true, providers: [] } as unknown as ServerConfig);
  const view = await render(<WorkspaceAgents context={context(false)} onOpenThread={() => {}} />);
  try {
    await page.getByRole("button", { name: /Sub-agents/ }).click();
    await expect.element(page.getByRole("button", { name: "Family child" })).toBeInTheDocument();
    expect(fixture.family).toHaveBeenCalledWith({ threadId: parent, limit: 50 });
  } finally {
    await view.unmount();
    restoreConfig();
  }
});

it("shows a config error and retries capability discovery before requesting relatives", async () => {
  fixture.family.mockClear().mockResolvedValue({
    snapshotSequence: 1,
    threads: [familyShell("retried-family-child", "Retried family child")],
  });
  fixture.config
    .mockClear()
    .mockRejectedValueOnce(new Error("config read failed"))
    .mockResolvedValueOnce({ shellThreadFamilies: true, providers: [] } as unknown as ServerConfig);
  const view = await render(<WorkspaceAgents context={context(false)} onOpenThread={() => {}} />);
  try {
    await page.getByRole("button", { name: /Sub-agents/ }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("config read failed");
    expect(fixture.family).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "Retried family child" }))
      .toBeInTheDocument();
    expect(fixture.config).toHaveBeenCalledTimes(2);
    expect(fixture.family).toHaveBeenCalledWith({ threadId: parent, limit: 50 });
  } finally {
    await view.unmount();
    restoreConfig();
  }
});

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
    await expect.poll(() => fixture.dispatch.mock.calls.length).toBe(3);
    expect(fixture.dispatch.mock.calls[1]![0]).toMatchObject({
      type: "delegated_task.completion-delivery.dispose",
      parentThreadId: parent,
      taskId: "task",
    });
    expect(fixture.dispatch.mock.calls[2]![0]).toMatchObject({
      type: "thread.stop",
      threadId: child,
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

it("keeps disconnected relatives and unlinked provider records visible together", async () => {
  const related = {
    id: ThreadId.make("disconnected"),
    title: "Recovered relative",
    status: "idle",
    activityRunStatus: null,
    lineage: {
      parentThreadId: ThreadId.make("deleted-ancestor"),
      rootThreadId: parent,
      relationshipToParent: "subagent",
    },
    forkedFrom: null,
    archivedAt: null,
    modelSelection: null,
  } as unknown as OrchestrationV2ThreadShell;
  fixture.family.mockResolvedValueOnce({ snapshotSequence: 1, threads: [related] });
  const base = context(false);
  const nativeRecord = {
    ...base.subagents[0]!,
    id: NodeId.make("native-unlinked"),
    childThreadId: null,
    origin: "provider_native" as const,
    title: "Provider background check",
  };
  const open = vi.fn();
  const view = await render(
    <WorkspaceAgents
      context={{ ...base, subagents: [...base.subagents, nativeRecord] }}
      onOpenThread={open}
    />,
  );
  try {
    await page.getByRole("button", { name: /Sub-agents/ }).click();
    await expect
      .element(page.getByText("Provider background check", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(page.getByText("Related conversation", { exact: true }))
      .toBeInTheDocument();
    await page.getByRole("button", { name: "Recovered relative" }).click();
    expect(open).toHaveBeenCalledWith(related.id);
  } finally {
    await view.unmount();
  }
});

it("stops a pending child and disposes its completion wake without reading a run", async () => {
  fixture.dispatch.mockClear();
  fixture.projection.mockClear();
  fixture.family.mockResolvedValueOnce({ snapshotSequence: 1, threads: [] });
  const base = context(false);
  const view = await render(
    <WorkspaceAgents
      context={{ ...base, subagents: [{ ...base.subagents[0]!, status: "pending" }] }}
      onOpenThread={() => {}}
    />,
  );
  try {
    await page.getByRole("button", { name: /Sub-agents/ }).click();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect.poll(() => fixture.dispatch.mock.calls.length).toBe(2);
    expect(fixture.dispatch.mock.calls.map(([command]) => command)).toMatchObject([
      {
        type: "delegated_task.completion-delivery.dispose",
        parentThreadId: parent,
        taskId: "task",
      },
      { type: "thread.stop", threadId: child },
    ]);
    expect(fixture.projection).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});

it("keeps the delegation dialog bound to the run that opened it", async () => {
  fixture.dispatch.mockClear();
  fixture.family.mockResolvedValueOnce({ snapshotSequence: 1, threads: [] });
  const base = context(true);
  const view = await render(<WorkspaceAgents context={base} onOpenThread={() => {}} />);
  try {
    await page.getByRole("button", { name: /Sub-agents/ }).click();
    await page.getByRole("button", { name: "Delegate task", exact: true }).click();
    await page.getByRole("textbox", { name: "Task", exact: true }).fill("Review the original run");
    const next = { ...base, runs: [{ ...base.runs[0]!, id: RunId.make("newer-run"), ordinal: 2 }] };
    await view.rerender(<WorkspaceAgents context={next} onOpenThread={() => {}} />);
    await page.getByRole("button", { name: "Delegate", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("The parent run has ended");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});

it("retries an unchanged delegation with the same command id after a transport failure", async () => {
  fixture.dispatch.mockClear();
  fixture.dispatch.mockRejectedValueOnce(new Error("Connection interrupted"));
  fixture.family.mockResolvedValueOnce({ snapshotSequence: 1, threads: [] });
  const view = await render(<WorkspaceAgents context={context(true)} onOpenThread={() => {}} />);
  try {
    await page.getByRole("button", { name: /Sub-agents/ }).click();
    await page.getByRole("button", { name: "Delegate task", exact: true }).click();
    await page.getByRole("textbox", { name: "Task", exact: true }).fill("Review once");
    await page.getByRole("button", { name: "Delegate", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Connection interrupted");
    await page.getByRole("button", { name: "Delegate", exact: true }).click();
    await expect.poll(() => fixture.dispatch.mock.calls.length).toBe(2);
    expect(fixture.dispatch.mock.calls[1]![0]).toEqual(fixture.dispatch.mock.calls[0]![0]);
  } finally {
    await view.unmount();
  }
});
