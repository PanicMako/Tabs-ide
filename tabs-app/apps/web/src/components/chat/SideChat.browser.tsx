import "../../index.css";
import { EnvironmentId, ThreadId } from "@tabs/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), confirm: vi.fn() }));
vi.mock("~/connection/environmentApiRegistry", () => ({
  environmentApi: async () => ({ orchestration: { dispatchCommand: mocks.dispatch } }),
}));
vi.mock("~/lib/customConfirm", () => ({ showCustomConfirm: mocks.confirm }));
// The pane embeds the full chat; this test is about the pane's own chrome.
vi.mock("../ChatView", () => ({
  default: (props: { compact?: boolean; threadId: string }) => (
    <div data-testid="embedded-chat">{`${props.compact ? "compact" : "full"}:${props.threadId}`}</div>
  ),
}));

import { appAtomRegistry, AppAtomRegistryProvider } from "~/state/atomRegistry";
import { readModelStateAtom } from "~/state/readModel";
import { useCompanionSurfaceStore } from "~/stores/companionSurfaceStore";
import { useRightPanelStore } from "~/stores/rightPanelStore";
import SideChatPane from "./SideChatPane";
import { sideChatScope } from "./useSideChat";
import { WorkspaceSideChats } from "./WorkspaceSideChats";

const environmentId = EnvironmentId.make("env-1");
const parentId = ThreadId.make("parent");
const sideChatId = ThreadId.make("side-chat-1");

const thread = (overrides: Record<string, unknown>) =>
  ({
    environmentId,
    title: "Thread",
    createdAt: "2026-09-01T00:00:00.000Z",
    archivedAt: null,
    messages: [],
    queuedRuns: [],
    activeRunId: null,
    latestTurn: null,
    ...overrides,
  }) as never;

function seed(threads: ReadonlyArray<unknown>) {
  appAtomRegistry.update(readModelStateAtom, (state) => ({ ...state, threads: threads as never }));
}

beforeEach(() => {
  mocks.dispatch.mockReset().mockResolvedValue(undefined);
  mocks.confirm.mockReset().mockResolvedValue(true);
  useCompanionSurfaceStore.setState({ workspaces: {} });
  useRightPanelStore.setState({ isOpen: false });
});
afterEach(() => seed([]));

it("lists only this thread's side chats in thread details and opens one as a tab", async () => {
  seed([
    thread({ id: parentId, title: "Main" }),
    thread({ id: sideChatId, title: "Why the retry?", isSideChat: true, parentThreadId: parentId }),
    thread({
      id: ThreadId.make("other-side-chat"),
      title: "Someone else's",
      isSideChat: true,
      parentThreadId: ThreadId.make("other-parent"),
    }),
    thread({ id: ThreadId.make("plain-fork"), title: "A fork", parentThreadId: parentId }),
  ]);
  const view = await render(
    <AppAtomRegistryProvider>
      <WorkspaceSideChats threadId={parentId} environmentId={environmentId} />
    </AppAtomRegistryProvider>,
  );
  try {
    await expect.element(page.getByText("Side chats", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Why the retry?")).toBeVisible();
    expect(view.container.textContent).not.toContain("Someone else's");
    expect(view.container.textContent).not.toContain("A fork");
    await page.getByRole("button", { name: /Why the retry\?/ }).click();
    const tabs =
      useCompanionSurfaceStore.getState().workspaces[sideChatScope(environmentId, parentId)]?.tabs;
    expect(tabs).toMatchObject([{ kind: "sidechat", sideChatThreadId: sideChatId }]);
    expect(useRightPanelStore.getState().isOpen).toBe(true);
  } finally {
    await view.unmount();
  }
});

it("shows nothing in thread details when there are no side chats", async () => {
  seed([thread({ id: parentId })]);
  const view = await render(
    <AppAtomRegistryProvider>
      <WorkspaceSideChats threadId={parentId} environmentId={environmentId} />
    </AppAtomRegistryProvider>,
  );
  try {
    expect(view.container.textContent).toBe("");
  } finally {
    await view.unmount();
  }
});

const renderPane = (onDeleted = vi.fn()) =>
  render(
    <AppAtomRegistryProvider>
      <div style={{ width: 420, height: 400 }}>
        <SideChatPane
          environmentId={environmentId}
          parentThreadId={parentId}
          threadId={sideChatId}
          onDeleted={onDeleted}
        />
      </div>
    </AppAtomRegistryProvider>,
  );

it("embeds the side chat's own compact chat and hides Delete until it is used", async () => {
  seed([
    thread({ id: parentId }),
    thread({ id: sideChatId, title: "Side chat", isSideChat: true }),
  ]);
  const view = await renderPane();
  try {
    await expect
      .element(page.getByTestId("embedded-chat"))
      .toHaveTextContent(`compact:${sideChatId}`);
    expect(page.getByRole("button", { name: "Delete side chat" }).query()).toBeNull();
  } finally {
    await view.unmount();
  }
});

it("offers Delete once used, and deletes the side chat after confirming", async () => {
  seed([
    thread({ id: parentId }),
    thread({ id: sideChatId, title: "Side chat", isSideChat: true, messages: [{ id: "m" }] }),
  ]);
  const onDeleted = vi.fn();
  const view = await renderPane(onDeleted);
  try {
    await page.getByRole("button", { name: "Delete side chat" }).click();
    expect(mocks.confirm).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "thread.delete", threadId: sideChatId }),
    );
  } finally {
    await view.unmount();
  }
});

it("does not delete when the confirmation is declined", async () => {
  mocks.confirm.mockResolvedValue(false);
  seed([
    thread({ id: parentId }),
    thread({ id: sideChatId, isSideChat: true, messages: [{ id: "m" }] }),
  ]);
  const view = await renderPane();
  try {
    await page.getByRole("button", { name: "Delete side chat" }).click();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});

it("brings the side chat back only while the parent is idle and it has a reply", async () => {
  const replied = { completedAt: "2026-09-01T00:01:00.000Z" };
  // Parent still running: refused without sending anything.
  seed([
    thread({ id: parentId, activeRunId: "run-1" }),
    thread({ id: sideChatId, isSideChat: true, messages: [{ id: "m" }], latestTurn: replied }),
  ]);
  let view = await renderPane();
  try {
    await page.getByRole("button", { name: "Bring back" }).click({ force: true });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
  }

  // Idle parent and a finished reply: hands the side chat to the parent.
  seed([
    thread({ id: parentId }),
    thread({ id: sideChatId, isSideChat: true, messages: [{ id: "m" }], latestTurn: replied }),
  ]);
  view = await renderPane();
  try {
    await page.getByRole("button", { name: "Bring back" }).click();
    await vi.waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "thread.merge_back",
          sourceThreadId: sideChatId,
          targetThreadId: parentId,
        }),
      ),
    );
  } finally {
    await view.unmount();
  }
});

it("says so when the side chat was deleted elsewhere", async () => {
  seed([thread({ id: parentId })]);
  const view = await renderPane();
  try {
    await expect.element(page.getByText("This side chat was deleted.")).toBeVisible();
  } finally {
    await view.unmount();
  }
});
