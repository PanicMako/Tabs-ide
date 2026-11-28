import {
  EnvironmentId,
  PreviewTabId,
  ProjectId,
  type BrowserQuickAction,
  type BrowserQuickActionTarget,
  type DesktopBrowserAutomationInput,
  type DesktopBrowserSessionState,
} from "@tabs/contracts";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import "../../index.css";
import { useWorkspaceShellStore } from "~/workspaceShellStore";
import { BrowserQuickActionReview, saveBrowserQuickAction } from "./BrowserQuickActionReview";
import { RunBrowserQuickActionDialog } from "./RunBrowserQuickActionDialog";

const { queueThreadContinuation } = vi.hoisted(() => ({ queueThreadContinuation: vi.fn() }));
vi.mock("~/lib/queueThreadContinuation", () => ({ queueThreadContinuation }));

it("saves a CSS-only recording with the selected steps and reviewed parameter names", async () => {
  const projectId = ProjectId.makeUnsafe(crypto.randomUUID());
  const onClose = vi.fn();
  const view = await render(
    <BrowserQuickActionReview
      projectId={projectId}
      initialUrl="https://reports.example/customer-123?token=private"
      recorded={[
        { id: "incidental", action: "click", selector: "#open-help" },
        { id: "fill", action: "fill", selector: "#report-month", value: "private demo value" },
        { id: "save", action: "click", selector: "#save" },
      ]}
      onClose={onClose}
    />,
  );
  try {
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Save report");
    await page.getByRole("textbox", { name: "Expected result" }).fill("Report saved");
    await page.getByRole("textbox", { name: "Element that should be visible" }).fill("#success");
    await page.getByRole("textbox", { name: "Expected filename (optional)" }).fill("   ");
    await expect.element(page.getByRole("button", { name: "Save Quick Action" })).toBeDisabled();
    await page.getByRole("checkbox", { name: /Fill/ }).click();
    await page.getByRole("checkbox", { name: /Click #save/ }).click();
    await expect
      .element(page.getByRole("checkbox", { name: /Keep exact accessibility match/ }))
      .not.toBeInTheDocument();
    await page.getByRole("textbox", { name: "Parameter name" }).fill("month");
    await page.getByRole("button", { name: "Save Quick Action" }).click();
    expect(onClose).toHaveBeenCalledOnce();
    const saved =
      useWorkspaceShellStore.getState().projectSettingsByProjectId[projectId]?.browserQuickActions;
    expect(saved).toEqual([
      {
        id: expect.any(String),
        label: "Save report",
        origin: "https://reports.example",
        steps: [
          { action: "fill", selector: "#report-month", parameter: "month" },
          { action: "click", selector: "#save" },
        ],
        outcome: { selector: "#success", description: "Report saved" },
      },
    ]);
  } finally {
    await view.unmount();
  }
});

it("suggests separate parameters for colliding controls and honors an explicit shared name", async () => {
  const projectId = ProjectId.makeUnsafe(crypto.randomUUID());
  const onClose = vi.fn();
  const view = await render(
    <BrowserQuickActionReview
      projectId={projectId}
      initialUrl="https://reports.example/draft"
      recorded={[
        { id: "start", action: "fill", selector: "#report-month", value: "October" },
        { id: "end", action: "fill", selector: 'input[name="report_month"]', value: "December" },
        { id: "repeat", action: "fill", selector: "#report-month", value: "November" },
      ]}
      onClose={onClose}
    />,
  );
  try {
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Save report range");
    await page.getByRole("textbox", { name: "Expected result" }).fill("Range saved");
    await page.getByRole("textbox", { name: "Element that should be visible" }).fill("#success");
    const fills = page.getByRole("checkbox", { name: /^Fill / });
    await fills.nth(0).click();
    await fills.nth(1).click();
    await fills.nth(2).click();
    const parameters = page.getByRole("textbox", { name: "Parameter name" });
    await expect.element(parameters.nth(0)).toHaveValue("report_month");
    await expect.element(parameters.nth(1)).toHaveValue("report_month_2");
    await expect.element(parameters.nth(2)).toHaveValue("report_month_3");
    await parameters.nth(2).fill("report_month");
    await page.getByRole("button", { name: "Save Quick Action" }).click();
    expect(onClose).toHaveBeenCalledOnce();
    expect(
      useWorkspaceShellStore.getState().projectSettingsByProjectId[projectId]?.browserQuickActions,
    ).toEqual([
      {
        id: expect.any(String),
        label: "Save report range",
        origin: "https://reports.example",
        steps: [
          { action: "fill", selector: "#report-month", parameter: "report_month" },
          { action: "fill", selector: 'input[name="report_month"]', parameter: "report_month_2" },
          { action: "fill", selector: "#report-month", parameter: "report_month" },
        ],
        outcome: { selector: "#success", description: "Range saved" },
      },
    ]);
  } finally {
    await view.unmount();
  }
});

it("saves a reviewed filename pattern with a semantic-only step and outcome", async () => {
  const projectId = ProjectId.makeUnsafe(crypto.randomUUID());
  const onClose = vi.fn();
  const stepMatch = { role: "textbox", name: "Report month", group: "Monthly reports" } as const;
  const resultMatch = { role: "link", name: "Download report" } as const;
  const runBrowserAutomation = vi.fn(async () => ({
    selector: "",
    tag: "a",
    semantic: resultMatch,
    href: "https://reports.example/private/report-june.csv?token=private",
  }));
  const originalBridge = window.desktopBridge;
  window.desktopBridge = { runBrowserAutomation } as unknown as NonNullable<
    Window["desktopBridge"]
  >;
  const view = await render(
    <BrowserQuickActionReview
      projectId={projectId}
      sessionId="report-tab"
      initialUrl="https://reports.example/draft"
      recorded={[
        { id: "fill", action: "fill", selector: "", semantic: stepMatch, value: "June" },
        { id: "skip", action: "fill", selector: "#month", value: "July" },
      ]}
      onClose={onClose}
    />,
  );
  try {
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Save report");
    await page.getByRole("textbox", { name: "Expected result" }).fill("A report link appears");
    await page.getByRole("checkbox", { name: /Fill Report month/ }).click();
    const stepCheckbox = page.getByRole("checkbox", {
      name: /Keep exact accessibility match.*Role textbox.*Name “Report month”.*Group “Monthly reports”/,
    });
    await expect.element(stepCheckbox).toBeChecked();
    await expect
      .element(page.getByRole("textbox", { name: "Control CSS selector (optional)" }))
      .toHaveValue("");
    await expect
      .element(page.getByRole("textbox", { name: "Parameter name" }))
      .toHaveValue("report_month");
    await page.getByRole("button", { name: "Pick on page" }).click();
    expect(runBrowserAutomation).toHaveBeenCalledWith({
      source: "human",
      projectId,
      sessionId: "report-tab",
      operation: "pickQuickActionOutcome",
      input: { origin: "https://reports.example" },
    });
    const resultCheckbox = page.getByRole("checkbox", {
      name: /Keep exact accessibility match.*Role link.*Name “Download report”/,
    });
    await expect.element(resultCheckbox).toBeChecked();
    await expect
      .element(page.getByRole("textbox", { name: "Result CSS selector (optional)" }))
      .toHaveValue("");
    const filename = page.getByRole("textbox", { name: "Expected filename (optional)" });
    await expect.element(filename).toHaveValue("");
    const saveButton = page.getByRole("button", { name: "Save Quick Action" });
    await resultCheckbox.click();
    await expect.element(saveButton).toBeDisabled();
    await resultCheckbox.click();
    await filename.fill("qa-report-{month}.csv");
    await saveButton.click();
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Use only parameters from the selected input steps");
    expect(onClose).not.toHaveBeenCalled();
    await filename.fill("  qa-report-{report_month}.csv  ");
    await saveButton.click();
    expect(onClose).toHaveBeenCalledOnce();
    expect(
      useWorkspaceShellStore.getState().projectSettingsByProjectId[projectId]?.browserQuickActions,
    ).toEqual([
      {
        id: expect.any(String),
        label: "Save report",
        origin: "https://reports.example",
        steps: [{ action: "fill", selector: "", semantic: stepMatch, parameter: "report_month" }],
        outcome: {
          selector: "",
          semantic: resultMatch,
          description: "A report link appears",
          filenamePattern: "qa-report-{report_month}.csv",
        },
      },
    ]);
  } finally {
    await view.unmount();
    if (originalBridge) window.desktopBridge = originalBridge;
    else delete window.desktopBridge;
  }
});

it("discards an unchecked match and clears captured evidence when replacing CSS", async () => {
  const projectId = ProjectId.makeUnsafe(crypto.randomUUID());
  const runBrowserAutomation = vi.fn(async () => ({
    selector: "#success",
    semantic: { role: "status", name: "Report saved" },
  }));
  const originalBridge = window.desktopBridge;
  window.desktopBridge = { runBrowserAutomation } as unknown as NonNullable<
    Window["desktopBridge"]
  >;
  const view = await render(
    <BrowserQuickActionReview
      projectId={projectId}
      sessionId="report-tab"
      initialUrl="https://reports.example/draft"
      recorded={[
        {
          id: "save",
          action: "click",
          selector: "#save",
          semantic: { role: "button", name: "Save report" },
        },
      ]}
      onClose={vi.fn()}
    />,
  );
  try {
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Save report");
    await page.getByRole("textbox", { name: "Expected result" }).fill("A confirmation appears");
    await page.getByRole("checkbox", { name: /Click #save/ }).click();
    await page
      .getByRole("checkbox", { name: /Keep exact accessibility match.*Role button/ })
      .click();
    await expect
      .element(page.getByRole("textbox", { name: "Control selector" }))
      .toHaveValue("#save");
    await page.getByRole("button", { name: "Pick on page" }).click();
    await page
      .getByRole("textbox", { name: "Result CSS selector (optional)" })
      .fill("#confirmation");
    await expect
      .element(page.getByRole("checkbox", { name: /Keep exact accessibility match.*Role status/ }))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: "Save Quick Action" }).click();
    expect(
      useWorkspaceShellStore.getState().projectSettingsByProjectId[projectId]?.browserQuickActions,
    ).toEqual([
      {
        id: expect.any(String),
        label: "Save report",
        origin: "https://reports.example",
        steps: [{ action: "click", selector: "#save" }],
        outcome: { selector: "#confirmation", description: "A confirmation appears" },
      },
    ]);
  } finally {
    await view.unmount();
    if (originalBridge) window.desktopBridge = originalBridge;
    else delete window.desktopBridge;
  }
});

it("requires selecting a concrete tab and grants a single run to the chosen conversation", async () => {
  const action: BrowserQuickAction = {
    id: crypto.randomUUID(),
    label: "Save report",
    origin: "https://reports.example",
    steps: [{ action: "fill", selector: "#month", parameter: "month" }],
    outcome: { selector: "#success", description: "Report saved" },
  };
  const originalBridge = window.desktopBridge;
  const runBrowserAutomation = vi.fn(async ({ operation }: { operation: string }) => {
    if (operation === "listQuickActionTargets")
      return [
        {
          sessionId: "tab-work",
          profileId: "Work",
          page: "https://reports.example/draft",
          token: "exact-tab",
          assignedTaskId: null,
          visible: true,
        },
        {
          sessionId: "tab-personal",
          profileId: "Personal",
          page: "https://reports.example/draft",
          token: "personal-tab",
          assignedTaskId: null,
          visible: false,
        },
      ];
    return { id: "one-use" };
  });
  window.desktopBridge = {
    runBrowserAutomation,
    onBrowserSessionState: () => () => undefined,
  } as unknown as NonNullable<Window["desktopBridge"]>;
  const view = await render(
    <RunBrowserQuickActionDialog
      projectId="project"
      initialAction={action}
      threads={[{ id: "work-thread", title: "Work conversation" }]}
      currentThreadId="work-thread"
      onClose={() => undefined}
    />,
  );
  try {
    await expect.element(page.getByRole("button", { name: "Run in selected tab" })).toBeDisabled();
    await page.getByRole("combobox", { name: "Browser tab and profile" }).click();
    await page.getByRole("option", { name: /Work · / }).click();
    await page.getByRole("textbox", { name: "month" }).fill("November");
    await page.getByRole("button", { name: "Approve once" }).click();
    expect(runBrowserAutomation).toHaveBeenCalledWith({
      source: "human",
      operation: "authorizeQuickAction",
      projectId: "project",
      sessionId: "tab-work",
      taskId: "work-thread",
      input: { action, token: "exact-tab", resume: false, values: { month: "November" } },
    });
    expect(
      runBrowserAutomation.mock.calls.some(([call]) => call.operation === "runQuickAction"),
    ).toBe(false);
  } finally {
    await view.unmount();
    if (originalBridge) window.desktopBridge = originalBridge;
    else delete window.desktopBridge;
  }
});

it("shows the verified filename and size after running in the reviewed tab", async () => {
  const action: BrowserQuickAction = {
    id: crypto.randomUUID(),
    label: "Save report",
    origin: "https://reports.example",
    steps: [{ action: "click", selector: "#save" }],
    outcome: {
      selector: "#receipt",
      description: "Report attached",
      filenamePattern: "report.csv",
    },
  };
  const runBrowserAutomation = vi.fn(async ({ operation }: { operation: string }) => {
    if (operation === "listQuickActionTargets") {
      return [
        {
          sessionId: "work-tab",
          profileId: "Work",
          page: "https://reports.example/draft",
          token: "work-token",
          assignedTaskId: null,
          visible: true,
        },
      ];
    }
    if (operation !== "runQuickAction") throw new Error("Unexpected browser operation");
    return {
      status: "pass",
      completedSteps: 1,
      message: "Report attached",
      fileReceipt: { filename: "report.csv", byteLength: 16, sha256: "a".repeat(64) },
    };
  });
  const originalBridge = window.desktopBridge;
  window.desktopBridge = {
    runBrowserAutomation,
    onBrowserSessionState: () => () => undefined,
  } as unknown as NonNullable<Window["desktopBridge"]>;
  const view = await render(
    <RunBrowserQuickActionDialog
      projectId="project"
      initialAction={action}
      threads={[]}
      currentThreadId={null}
      onClose={() => undefined}
    />,
  );
  try {
    await page.getByRole("combobox", { name: "Browser tab and profile" }).click();
    await page.getByRole("option", { name: /Work · / }).click();
    await page.getByRole("button", { name: "Run in selected tab" }).click();
    await expect
      .element(page.getByRole("status").filter({ hasText: "report.csv (16 bytes)" }))
      .toBeVisible();
  } finally {
    await view.unmount();
    if (originalBridge) window.desktopBridge = originalBridge;
    else delete window.desktopBridge;
  }
});

it("queues only the exact approved run into the requesting conversation", async () => {
  const action: BrowserQuickAction = {
    id: crypto.randomUUID(),
    label: "Save report",
    origin: "https://reports.example",
    steps: [{ action: "fill", selector: "#month", parameter: "month" }],
    outcome: { selector: "#success", description: "Report saved" },
  };
  const environmentId = EnvironmentId.make("local");
  const approvalId = crypto.randomUUID();
  let approved = false;
  const runBrowserAutomation = vi.fn(async ({ operation }: { operation: string }) => {
    if (operation === "listQuickActionTargets")
      return [
        {
          sessionId: "tab-work",
          profileId: "Work",
          page: "https://reports.example/draft",
          token: "exact-tab",
          assignedTaskId: "work-thread",
          visible: true,
          ...(approved ? { approval: { id: approvalId, taskId: "work-thread" } } : {}),
        },
      ];
    if (operation !== "authorizeQuickAction") throw new Error("Unexpected browser operation");
    approved = true;
    return { id: approvalId };
  });
  const originalBridge = window.desktopBridge;
  window.desktopBridge = {
    runBrowserAutomation,
    onBrowserSessionState: () => () => undefined,
  } as unknown as NonNullable<Window["desktopBridge"]>;
  const onClose = vi.fn();
  const view = await render(
    <RunBrowserQuickActionDialog
      projectId="project"
      initialAction={action}
      threads={[{ id: "work-thread", title: "Work conversation" }]}
      currentThreadId="work-thread"
      requestEnvironmentId={environmentId}
      onClose={onClose}
    />,
  );
  try {
    queueThreadContinuation.mockClear();
    expect(queueThreadContinuation).not.toHaveBeenCalled();
    await page.getByRole("combobox", { name: "Browser tab and profile" }).click();
    await page.getByRole("option", { name: /Work · / }).click();
    await page.getByRole("textbox", { name: "month" }).fill("December");
    await page.getByRole("button", { name: "Approve once" }).click();
    await expect.poll(() => queueThreadContinuation.mock.calls.length).toBe(1);
    const [continuation] = queueThreadContinuation.mock.calls[0]!;
    expect(continuation).toMatchObject({
      id: approvalId,
      threadId: "work-thread",
      environmentId,
      text: expect.stringContaining(
        JSON.stringify({ tabId: "tab-work", actionId: action.id, approvalId }),
      ),
    });
    expect(continuation.text).not.toContain("December");
    await expect(continuation.verify()).resolves.toBe(true);
    approved = false;
    await expect(continuation.verify()).resolves.toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    await view.unmount();
    if (originalBridge) window.desktopBridge = originalBridge;
    else delete window.desktopBridge;
  }
});

it("requires a fresh tab selection and inputs when the page changes during agent review", async () => {
  const action: BrowserQuickAction = {
    id: crypto.randomUUID(),
    label: "Save report",
    origin: "https://reports.example",
    steps: [{ action: "fill", selector: "#month", parameter: "month" }],
    outcome: { selector: "#success", description: "Report saved" },
  };
  let target = {
    sessionId: "work-tab",
    profileId: "Work",
    page: "https://reports.example/draft",
    token: "original-page",
    assignedTaskId: "work-thread",
    visible: true,
  };
  const runBrowserAutomation = vi.fn(async ({ operation }: { operation: string }) => {
    if (operation !== "listQuickActionTargets") throw new Error("Unexpected browser operation");
    return [target];
  });
  const onBrowserSessionState = vi.fn<
    (listener: (state: DesktopBrowserSessionState) => void) => () => void
  >(() => () => undefined);
  const originalBridge = window.desktopBridge;
  window.desktopBridge = { runBrowserAutomation, onBrowserSessionState } as unknown as NonNullable<
    Window["desktopBridge"]
  >;
  const view = await render(
    <RunBrowserQuickActionDialog
      projectId="project"
      initialAction={action}
      threads={[{ id: "work-thread", title: "Work conversation" }]}
      currentThreadId="work-thread"
      requestEnvironmentId={EnvironmentId.make("local")}
      onClose={vi.fn()}
    />,
  );
  try {
    const tabs = page.getByRole("combobox", { name: "Browser tab and profile" });
    const approve = page.getByRole("button", { name: "Approve once" });
    const month = page.getByRole("textbox", { name: "month" });
    await tabs.click();
    await page.getByRole("option", { name: /Work · .*\/draft/ }).click();
    await expect.element(tabs).toHaveTextContent("Work · https://reports.example/draft");
    await month.fill("December");
    await expect.element(approve).toBeEnabled();

    target = { ...target, page: "https://reports.example/another-draft", token: "new-page" };
    onBrowserSessionState.mock.calls[0]![0]({
      projectId: "project",
      sessionId: target.sessionId,
      currentUrl: target.page,
      pageTitle: "Another draft",
      loading: false,
      canGoBack: true,
      canGoForward: false,
      devToolsOpen: false,
      zoomFactor: 1,
      audioMuted: false,
      pictureInPicture: false,
      colorScheme: "system",
      lastError: null,
      transientError: null,
    });

    await expect.element(tabs).toHaveTextContent("Choose an open tab");
    await expect.element(page.getByRole("status")).toHaveTextContent(/tab changed/i);
    await expect.element(approve).not.toBeInTheDocument();
    await tabs.click();
    await page.getByRole("option", { name: /Work · .*\/another-draft/ }).click();
    await expect.element(tabs).toHaveTextContent("Work · https://reports.example/another-draft");
    await expect.element(month).toHaveValue("");
    await expect.element(approve).toBeDisabled();
    await month.fill("January");
    await expect.element(approve).toBeEnabled();
  } finally {
    await view.unmount();
    if (originalBridge) window.desktopBridge = originalBridge;
    else delete window.desktopBridge;
  }
});

it("reuses locked inputs when approving a paused agent Quick Action", async () => {
  const action: BrowserQuickAction = {
    id: crypto.randomUUID(),
    label: "Save report",
    origin: "https://reports.example",
    steps: [
      { action: "fill", selector: "#month", parameter: "month" },
      { action: "fill", selector: "#confirm-month", parameter: "month" },
      { action: "fill", selector: "#report-title", parameter: "title" },
    ],
    outcome: { selector: "#success", description: "Report saved" },
  };
  const environmentId = EnvironmentId.make("local");
  const approvalId = crypto.randomUUID();
  const pauseRequest = {
    pauseId: crypto.randomUUID(),
    tabId: PreviewTabId.make("work-tab"),
    profileId: "work",
  };
  const target = {
    sessionId: pauseRequest.tabId,
    profileId: pauseRequest.profileId,
    page: "https://reports.example/draft",
    token: "exact-tab",
    assignedTaskId: "work-thread",
    visible: true,
    pausedAt: 1,
    pauseOwner: { pauseId: pauseRequest.pauseId, taskId: "work-thread" },
    lockedParameters: ["month"],
  };
  const runBrowserAutomation = vi.fn(async ({ operation }: { operation: string }) => {
    if (operation === "listQuickActionTargets") return [target];
    if (operation === "authorizeQuickAction") return { id: approvalId };
    throw new Error("Unexpected browser operation");
  });
  const originalBridge = window.desktopBridge;
  window.desktopBridge = {
    runBrowserAutomation,
    onBrowserSessionState: () => () => undefined,
  } as unknown as NonNullable<Window["desktopBridge"]>;
  queueThreadContinuation.mockClear();
  const onClose = vi.fn();
  const view = await render(
    <RunBrowserQuickActionDialog
      projectId="project"
      initialAction={action}
      threads={[{ id: "work-thread", title: "Work conversation" }]}
      currentThreadId="work-thread"
      requestEnvironmentId={environmentId}
      pauseRequest={pauseRequest}
      onClose={onClose}
    />,
  );
  try {
    const title = page.getByRole("textbox", { name: "title" });
    const approve = page.getByRole("button", { name: "Approve once" });
    await expect.element(title).toHaveValue("");
    await expect.element(page.getByRole("textbox", { name: "month" })).not.toBeInTheDocument();
    await expect
      .element(page.getByText("Previously approved inputs will be reused."))
      .toBeVisible();
    await expect.element(approve).toBeDisabled();
    await title.fill("Quarterly report");
    await expect.element(approve).toBeEnabled();
    await approve.click();

    expect(
      runBrowserAutomation.mock.calls
        .map(([request]) => request)
        .filter((request) => request.operation === "authorizeQuickAction"),
    ).toStrictEqual([
      {
        source: "human",
        operation: "authorizeQuickAction",
        projectId: "project",
        sessionId: pauseRequest.tabId,
        taskId: "work-thread",
        input: {
          action,
          token: target.token,
          resume: true,
          pauseId: pauseRequest.pauseId,
          values: { title: "Quarterly report" },
        },
      },
    ]);
    await expect.poll(() => queueThreadContinuation.mock.calls.length).toBe(1);
    const [continuation] = queueThreadContinuation.mock.calls[0]!;
    expect(continuation).toMatchObject({
      id: approvalId,
      threadId: "work-thread",
      environmentId,
      text: expect.stringContaining(
        JSON.stringify({ tabId: pauseRequest.tabId, actionId: action.id, approvalId }),
      ),
    });
    expect(continuation.text).not.toContain("Quarterly report");
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    await view.unmount();
    if (originalBridge) window.desktopBridge = originalBridge;
    else delete window.desktopBridge;
  }
});

it.each([
  { choice: "It took effect", applied: true },
  { choice: "It did not take effect", applied: false },
])(
  "records '$choice' before allowing reapproval in the original conversation",
  async ({ choice, applied }) => {
    const action: BrowserQuickAction = {
      id: crypto.randomUUID(),
      label: "Save report",
      origin: "https://reports.example",
      steps: [
        { action: "click", selector: "#review" },
        { action: "click", selector: "#save" },
      ],
      outcome: { selector: "#success", description: "Report saved" },
    };
    const environmentId = EnvironmentId.make("local");
    const approvalId = crypto.randomUUID();
    const pauseRequest = {
      pauseId: crypto.randomUUID(),
      tabId: PreviewTabId.make("work-tab"),
      profileId: "work",
    };
    const pausedTarget = {
      sessionId: pauseRequest.tabId,
      profileId: pauseRequest.profileId,
      page: "https://reports.example/draft",
      token: "original-token",
      assignedTaskId: "work-thread",
      visible: true,
      pausedAt: 1,
      repairAt: 1,
      pauseOwner: { pauseId: pauseRequest.pauseId, taskId: "work-thread" },
    } satisfies BrowserQuickActionTarget;
    const unconfirmedStepId = crypto.randomUUID();
    const resumedAt = pausedTarget.pausedAt + Number(applied);
    const resolvedTarget = {
      ...pausedTarget,
      token: "refreshed-token",
      pausedAt: resumedAt,
      repairAt: resumedAt,
    };
    let decisionRecorded = false;
    let finishRefresh!: (targets: BrowserQuickActionTarget[]) => void;
    const refreshedTargets = new Promise<BrowserQuickActionTarget[]>((resolve) => {
      finishRefresh = resolve;
    });
    const runBrowserAutomation = vi.fn(async ({ operation }: DesktopBrowserAutomationInput) => {
      if (operation === "listQuickActionTargets")
        return decisionRecorded ? refreshedTargets : [{ ...pausedTarget, unconfirmedStepId }];
      if (operation === "resolveQuickActionStep") {
        decisionRecorded = true;
        return;
      }
      if (operation === "authorizeQuickAction") return { id: approvalId };
      throw new Error("Unexpected browser operation");
    });
    const originalBridge = window.desktopBridge;
    window.desktopBridge = {
      runBrowserAutomation,
      onBrowserSessionState: () => () => undefined,
    } as unknown as NonNullable<Window["desktopBridge"]>;
    queueThreadContinuation.mockClear();
    const onClose = vi.fn();
    const view = await render(
      <RunBrowserQuickActionDialog
        projectId="project"
        initialAction={action}
        threads={[{ id: "work-thread", title: "Work conversation" }]}
        currentThreadId="work-thread"
        requestEnvironmentId={environmentId}
        pauseRequest={pauseRequest}
        onClose={onClose}
      />,
    );
    try {
      const approve = page.getByRole("button", { name: "Approve once" });
      const confirm = page.getByRole("button", { name: choice, exact: true });
      const scope = {
        source: "human",
        projectId: "project",
        sessionId: "work-tab",
        taskId: "work-thread",
      };
      const resolveRequest = {
        ...scope,
        operation: "resolveQuickActionStep",
        input: {
          action,
          token: pausedTarget.token,
          pauseId: pauseRequest.pauseId,
          unconfirmedStepId,
          applied,
        },
      };
      const mutations = () =>
        runBrowserAutomation.mock.calls
          .map(([request]) => request)
          .filter((request) => request.operation !== "listQuickActionTargets");

      await expect.element(page.getByText(/Step 2 needs checking\./)).toBeVisible();
      await expect.element(approve).toBeDisabled();
      await expect
        .element(page.getByRole("button", { name: "Pick replacement on page" }))
        .not.toBeInTheDocument();
      expect(mutations()).toStrictEqual([]);

      await confirm.click();
      await expect.poll(() => runBrowserAutomation.mock.calls.length).toBe(3);
      await expect.element(confirm).toBeDisabled();
      await expect.element(approve).toBeDisabled();
      expect(mutations()).toStrictEqual([resolveRequest]);
      expect(queueThreadContinuation).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();

      finishRefresh([resolvedTarget]);
      await expect.element(approve).toBeEnabled();
      await expect.element(confirm).not.toBeInTheDocument();
      expect(mutations()).toStrictEqual([resolveRequest]);
      await approve.click();
      expect(mutations()).toStrictEqual([
        resolveRequest,
        {
          ...scope,
          operation: "authorizeQuickAction",
          input: {
            action,
            token: resolvedTarget.token,
            pauseId: pauseRequest.pauseId,
            resume: true,
            values: {},
          },
        },
      ]);
      expect(queueThreadContinuation).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          id: approvalId,
          threadId: "work-thread",
          environmentId,
          text: expect.stringContaining(
            JSON.stringify({ tabId: pauseRequest.tabId, actionId: action.id, approvalId }),
          ),
        }),
      );
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      finishRefresh([resolvedTarget]);
      await view.unmount();
      if (originalBridge) window.desktopBridge = originalBridge;
      else delete window.desktopBridge;
    }
  },
);

it("repairs and reapproves only the exact paused Quick Action", async () => {
  const projectId = ProjectId.makeUnsafe(crypto.randomUUID());
  const action: BrowserQuickAction = {
    id: crypto.randomUUID(),
    label: "Attach report",
    origin: "https://reports.example",
    steps: [{ action: "fill", selector: "#month", parameter: "month" }],
    outcome: {
      selector: "#receipt",
      description: "Report attached",
      filenamePattern: "report.csv",
    },
  };
  saveBrowserQuickAction(projectId, action);
  const saved = () =>
    useWorkspaceShellStore.getState().projectSettingsByProjectId[projectId]?.browserQuickActions;
  const repaired = { ...action, outcome: { ...action.outcome, selector: "#moved-receipt" } };
  const approvalId = crypto.randomUUID();
  const pauseRequest = {
    pauseId: crypto.randomUUID(),
    tabId: PreviewTabId.make("work-tab"),
    profileId: "work",
  };
  const target = {
    sessionId: pauseRequest.tabId,
    profileId: pauseRequest.profileId,
    token: "exact-tab",
    page: "https://reports.example/draft",
    assignedTaskId: "work-thread",
    visible: true,
    pausedAt: 1,
    repairAt: 1,
    pauseOwner: { pauseId: pauseRequest.pauseId, taskId: "work-thread" },
  };
  let picks = 0;
  const runBrowserAutomation = vi.fn(async ({ operation }: { operation: string }) => {
    if (operation === "listQuickActionTargets")
      return [{ ...target, sessionId: "personal-tab", profileId: "personal" }, target];
    if (operation === "repairQuickAction") {
      picks++;
      if (picks === 1)
        throw new Error("This file matches a download that was available before this run.");
      return { action: repaired, pendingFileVerification: false };
    }
    if (operation === "authorizeQuickAction") return { id: approvalId };
    throw new Error("Unexpected browser operation");
  });
  const originalBridge = window.desktopBridge;
  window.desktopBridge = {
    runBrowserAutomation,
    onBrowserSessionState: () => () => undefined,
  } as unknown as NonNullable<Window["desktopBridge"]>;
  queueThreadContinuation.mockClear();
  const view = await render(
    <RunBrowserQuickActionDialog
      projectId={projectId}
      initialAction={action}
      threads={[{ id: "work-thread", title: "Work conversation" }]}
      currentThreadId="work-thread"
      requestEnvironmentId={EnvironmentId.make("local")}
      pauseRequest={pauseRequest}
      onClose={vi.fn()}
    />,
  );
  try {
    const expected = {
      source: "human",
      taskId: "work-thread",
      projectId,
      sessionId: "work-tab",
    };
    await page.getByRole("button", { name: "Pick replacement on page" }).click();
    expect(runBrowserAutomation).toHaveBeenCalledWith({
      ...expected,
      operation: "repairQuickAction",
      input: { action, token: "exact-tab", pauseId: pauseRequest.pauseId },
    });
    await expect.element(page.getByRole("alert")).toHaveTextContent("available before this run");
    expect(saved()).toEqual([action]);
    await page.getByRole("button", { name: "Pick replacement on page" }).click();
    await expect.poll(saved).toEqual([repaired]);
    await page.getByRole("button", { name: "Approve once" }).click();
    expect(runBrowserAutomation).toHaveBeenCalledWith({
      ...expected,
      operation: "authorizeQuickAction",
      input: {
        action: repaired,
        token: "exact-tab",
        pauseId: pauseRequest.pauseId,
        resume: true,
        values: {},
      },
    });
    expect(queueThreadContinuation).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: approvalId, threadId: "work-thread" }),
    );
  } finally {
    await view.unmount();
    if (originalBridge) window.desktopBridge = originalBridge;
    else delete window.desktopBridge;
  }
});

it("keeps a preflight file replacement out of project settings until replay verifies it", async () => {
  const projectId = ProjectId.makeUnsafe(crypto.randomUUID());
  const action: BrowserQuickAction = {
    id: crypto.randomUUID(),
    label: "Export report",
    origin: "https://reports.example",
    steps: [{ action: "click", selector: "#export" }],
    outcome: { selector: ".receipt", description: "Report ready", filenamePattern: "report.csv" },
  };
  saveBrowserQuickAction(projectId, action);
  const saved = () =>
    useWorkspaceShellStore.getState().projectSettingsByProjectId[projectId]?.browserQuickActions;
  const repaired = { ...action, outcome: { ...action.outcome, selector: "#result" } };
  const target = {
    sessionId: "work-tab",
    profileId: "work",
    token: "exact-tab",
    page: "https://reports.example/export",
    assignedTaskId: null,
    visible: true,
    pausedAt: 0,
    repairAt: 1,
  };
  const bridge = window.desktopBridge;
  window.desktopBridge = {
    runBrowserAutomation: vi.fn(async ({ operation }: { operation: string }) => {
      if (operation === "listQuickActionTargets") return [target];
      if (operation === "repairQuickAction")
        return { action: repaired, pendingFileVerification: true };
      if (operation === "runQuickAction")
        return {
          status: "pass",
          completedSteps: 1,
          message: "Report ready",
          fileReceipt: { filename: "report.csv", byteLength: 16, sha256: "a".repeat(64) },
          verifiedRepair: { previous: action, replacement: repaired },
        };
      throw new Error("Unexpected browser operation");
    }),
    onBrowserSessionState: () => () => undefined,
  } as unknown as NonNullable<Window["desktopBridge"]>;
  const view = await render(
    <RunBrowserQuickActionDialog
      projectId={projectId}
      initialAction={action}
      threads={[]}
      currentThreadId={null}
      onClose={() => undefined}
    />,
  );
  try {
    await page.getByRole("combobox", { name: "Browser tab and profile" }).click();
    await page.getByRole("option", { name: /work · / }).click();
    await page.getByRole("button", { name: "Pick replacement on page" }).click();
    await expect.element(page.getByRole("button", { name: "Continue from pause" })).toBeEnabled();
    expect(saved()).toEqual([action]);
    await page.getByRole("button", { name: "Continue from pause" }).click();
    await expect.poll(saved).toEqual([repaired]);
  } finally {
    await view.unmount();
    if (bridge) window.desktopBridge = bridge;
    else delete window.desktopBridge;
  }
});
