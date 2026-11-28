import {
  EnvironmentId,
  ThreadId,
  type TerminalAgentInputReview,
  type TerminalAgentInputReviewCommand,
} from "@tabs/contracts";
import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import "../../index.css";
import { deriveTimelineEntries, deriveWorkLogEntries } from "~/session-logic";
import { activitiesFromTurnItems } from "~/state/turnItemActivities";
import { MessagesTimeline } from "./MessagesTimeline";
import { TerminalAgentInputButton } from "./TerminalAgentInputButton";

const { reviewAgentInput, dispatchCommand, readEnvironment } = vi.hoisted(() => ({
  reviewAgentInput:
    vi.fn<(command: TerminalAgentInputReviewCommand) => Promise<TerminalAgentInputReview>>(),
  dispatchCommand: vi.fn(async (_command: unknown) => ({})),
  readEnvironment: vi.fn((_id: string) => {}),
}));
vi.mock("~/connection/environmentApiRegistry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/connection/environmentApiRegistry")>()),
  environmentApi: async (environmentId: string) => {
    readEnvironment(environmentId);
    return { orchestration: { dispatchCommand }, terminal: { reviewAgentInput } };
  },
}));

const environmentId = EnvironmentId.make("remote-fixture");
const threadId = ThreadId.make("terminal-approval-fixture");
const requestId = "890a6a1f-d885-46cf-a648-7e0653d85477";
const pending: TerminalAgentInputReview = {
  requestId,
  status: "pending",
  terminalId: "term-2",
  instanceId: "ecf7bbee-f0cd-47ad-89a9-ea0f83c4ced0",
  cwd: "/disposable/qa",
  text: "printf '%s\\n' 'approved fixture'",
  pressEnter: true,
};
const { text: _text, ...reviewed } = pending;

beforeEach(() => {
  reviewAgentInput.mockReset();
  dispatchCommand.mockClear();
  readEnvironment.mockClear();
});

async function showReview() {
  await render(
    <TerminalAgentInputButton
      environmentId={environmentId}
      threadId={threadId}
      request={{ requestId }}
    />,
  );
  await page.getByRole("button", { name: "Review terminal input" }).click();
  return page.getByRole("dialog");
}

it("shows the exact session and Enter before approving and continues the owning thread", async () => {
  reviewAgentInput
    .mockResolvedValueOnce(pending)
    .mockResolvedValueOnce({ ...reviewed, status: "delivered" });
  const nowIso = "2026-11-25T12:00:00Z";
  const activities = activitiesFromTurnItems(
    [1, 2].map((ordinal) => ({
      id: `terminal-input-${ordinal}`,
      ordinal,
      type: "dynamic_tool",
      status: "completed",
      toolName: "t3-code.terminal_input",
      updatedAt: nowIso,
      outputOmitted: true,
      output: { terminalAgentInput: { requestId } },
    })),
  );
  await render(
    <MessagesTimeline
      hasMessages
      isWorking={false}
      activeTurnInProgress={false}
      activeTurnStartedAt={null}
      scrollContainer={null}
      timelineEntries={deriveTimelineEntries([], [], deriveWorkLogEntries(activities, undefined))}
      completionDividerBeforeEntryId={null}
      completionSummary={null}
      turnDiffSummaryByAssistantMessageId={new Map()}
      nowIso={nowIso}
      expandedWorkGroups={{}}
      onToggleWorkGroup={() => {}}
      onOpenTurnDiff={() => {}}
      revertTurnCountByUserMessageId={new Map()}
      onRevertUserMessage={() => {}}
      isRevertingCheckpoint={false}
      onImageExpand={() => {}}
      markdownCwd={undefined}
      resolvedTheme="light"
      timestampFormat="locale"
      workspaceRoot={undefined}
      latestTaskDescription={null}
      threadId={threadId}
      terminalInputEnvironmentId={environmentId}
    />,
  );
  const reviewButton = page.getByRole("button", { name: "Review terminal input" });
  expect(reviewButton.elements()).toHaveLength(1);
  await reviewButton.click();
  const dialog = page.getByRole("dialog");
  await expect.element(dialog.getByText("Terminal 2 · /disposable/qa")).toBeVisible();
  await expect.element(dialog.getByText(pending.text!, { exact: true })).toBeVisible();
  expect(reviewAgentInput.mock.calls).toEqual([[{ action: "review", threadId, requestId }]]);
  expect(dispatchCommand).not.toHaveBeenCalled();
  await dialog.getByRole("button", { name: "Send input and press Enter" }).click();
  await expect.element(dialog.getByRole("status")).toHaveTextContent("Input reached the terminal");
  await expect.element(dialog.getByText(pending.text!, { exact: true })).not.toBeInTheDocument();
  expect(reviewAgentInput).toHaveBeenLastCalledWith({ action: "approve", threadId, requestId });
  await vi.waitFor(() =>
    expect(dispatchCommand).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: "message.dispatch",
        threadId,
        commandId: requestId,
        messageId: requestId,
        dispatchMode: { type: "queue_after_active" },
      }),
    ),
  );
  expect(JSON.stringify(dispatchCommand.mock.calls)).not.toContain("approved fixture");
  expect(readEnvironment.mock.calls.every(([id]) => id === environmentId)).toBe(true);
});

it("declines the exact request without sending input or queuing a continuation", async () => {
  reviewAgentInput
    .mockResolvedValueOnce(pending)
    .mockResolvedValueOnce({ ...reviewed, status: "declined" });
  const dialog = await showReview();
  await dialog.getByRole("button", { name: "Decline" }).click();
  await expect.element(dialog.getByText("You declined this request.")).toBeVisible();
  expect(reviewAgentInput.mock.calls).toEqual([
    [{ action: "review", threadId, requestId }],
    [{ action: "decline", threadId, requestId }],
  ]);
  expect(dispatchCommand).not.toHaveBeenCalled();
});

it("retries the same approval if its response is lost", async () => {
  reviewAgentInput
    .mockResolvedValueOnce(pending)
    .mockRejectedValueOnce(new Error("Reply unavailable"))
    .mockResolvedValueOnce({ ...reviewed, status: "delivered" });
  const dialog = await showReview();
  const approve = dialog.getByRole("button", { name: "Send input and press Enter" });
  await approve.click();
  await expect.element(dialog.getByRole("alert")).toHaveTextContent("Reply unavailable");
  expect(dispatchCommand).not.toHaveBeenCalled();
  await approve.click();
  await expect.element(dialog.getByRole("status")).toHaveTextContent("Input reached the terminal");
  expect(reviewAgentInput.mock.calls[1]).toEqual(reviewAgentInput.mock.calls[2]);
  await vi.waitFor(() => expect(dispatchCommand).toHaveBeenCalledTimes(1));
});
