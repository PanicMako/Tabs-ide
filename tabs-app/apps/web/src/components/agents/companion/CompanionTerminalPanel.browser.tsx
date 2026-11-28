import "../../../index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ThreadId,
  EnvironmentId,
  type TerminalMetadataStreamEvent,
  type TerminalOpenInput,
  type TerminalSessionSnapshot,
} from "@tabs/contracts";
import type { Terminal } from "@xterm/xterm";
import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useComposerDraftStore } from "~/composerDraftStore";
import { scopedComposerThreadId } from "~/state/composerDrafts";
import { CompanionTerminalPanel } from "./CompanionTerminalPanel";
import { useTerminalAttachmentTargets } from "~/lib/terminalAttachmentTargets";
import { appendTerminalContextsToPrompt } from "~/lib/terminalContext";
import { ContextMenuHost } from "~/components/ui/ContextMenuHost";
import { showContextMenuFallback } from "~/contextMenuFallback";

const environmentId = EnvironmentId.makeUnsafe("environment");
const threadId = ThreadId.makeUnsafe("thread");
const storageId = scopedComposerThreadId(environmentId, threadId);
const fixture = vi.hoisted(() => ({
  viewport: null as Terminal | null,
  instanceId: "running-terminal",
  deferMetadata: false,
  deliverMetadata: undefined as (() => void) | undefined,
  openedWith: undefined as TerminalOpenInput | undefined,
}));
vi.mock("@xterm/xterm", async (importOriginal) => {
  const xterm = await importOriginal<typeof import("@xterm/xterm")>();
  return {
    ...xterm,
    Terminal: class extends xterm.Terminal {
      constructor(options?: ConstructorParameters<typeof xterm.Terminal>[0]) {
        super(options);
        fixture.viewport = this;
      }
    },
  };
});

function terminalSnapshot(): TerminalSessionSnapshot {
  return {
    threadId,
    terminalId: "terminal",
    cwd: "/worktree",
    worktreePath: null,
    status: "running",
    pid: 123,
    instanceId: "running-terminal",
    history: "PRIVATE-SCROLLBACK\r\nbuild failed",
    exitCode: null,
    exitSignal: null,
    label: "command --token PRIVATE-ARG",
    updatedAt: "2026-11-25T00:00:00Z",
  };
}

vi.mock("~/connection/environmentApiRegistry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/connection/environmentApiRegistry")>()),
  environmentApi: async () => ({
    contextMenu: { show: showContextMenuFallback },
    terminal: {
      open: async (input: TerminalOpenInput) => {
        fixture.openedWith = input;
        return terminalSnapshot();
      },
      onEvent: () => () => {},
      resize: async () => {},
      onMetadata: (callback: (event: TerminalMetadataStreamEvent) => void) => {
        const deliver = () =>
          callback({
            type: "snapshot",
            terminals: [
              {
                ...terminalSnapshot(),
                instanceId: fixture.instanceId,
                hasRunningSubprocess: true,
              },
            ],
          });
        if (fixture.deferMetadata) fixture.deliverMetadata = deliver;
        else deliver();
        return () => {};
      },
    },
  }),
}));
vi.mock("~/hooks/useActiveProjectTarget", () => ({
  useActiveProjectTarget: () => ({
    projectId: "project",
    projectName: "Project",
    cwd: "/worktree",
    projectCwd: "/workspace",
    environmentId: "environment",
    threadId: "thread",
  }),
}));
vi.mock("~/state/terminal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/state/terminal")>()),
  useThreadTerminalState: () => ({
    terminalIds: ["terminal"],
    activeTerminalId: "terminal",
    terminalGroups: [],
    activeTerminalGroupId: null,
    terminalLabels: { terminal: "command --token PRIVATE-ARG" },
  }),
}));

beforeEach(() => {
  fixture.viewport = null;
  fixture.instanceId = "running-terminal";
  fixture.deferMetadata = false;
  fixture.deliverMetadata = undefined;
  fixture.openedWith = undefined;
  useComposerDraftStore.setState({ draftsByThreadId: {} });
});

function renderTerminal(withAttachments = false) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ContextMenuHost />
      {withAttachments ? (
        <TerminalWithAttachmentTargets />
      ) : (
        <CompanionTerminalPanel threadId={threadId} />
      )}
    </QueryClientProvider>,
  );
}

async function reviewSelectedOutput() {
  await expect
    .poll(() => fixture.viewport?.buffer.active.getLine(1)?.translateToString(true))
    .toBe("build failed");
  const terminal = fixture.viewport!;
  terminal.element!.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
  terminal.select(0, 1, "build failed".length);
  window.dispatchEvent(new MouseEvent("mouseup", { button: 0 }));
  await page.getByRole("menuitem", { name: "Review selection for chat" }).click();
  await expect.element(page.getByRole("dialog")).toBeVisible();
}

it("puts only the reviewed excerpt and its exact PTY identity into the provider prompt", async () => {
  const view = await renderTerminal();
  try {
    await reviewSelectedOutput();
    expect(fixture.openedWith).toMatchObject({
      threadId,
      cwd: "/worktree",
      env: { TABS_PROJECT_ROOT: "/workspace", TABS_WORKTREE_PATH: "/worktree" },
    });
    await expect
      .element(page.getByLabelText("Selected terminal text"))
      .toHaveTextContent("build failed");
    expect(useComposerDraftStore.getState().draftsByThreadId[storageId]).toBeUndefined();
    await page.getByRole("button", { name: "Add to draft" }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    const draft = useComposerDraftStore.getState().draftsByThreadId[storageId];
    expect(draft?.terminalContexts).toHaveLength(1);
    const providerPrompt = appendTerminalContextsToPrompt(
      "Explain this result",
      draft!.terminalContexts,
    );
    expect(providerPrompt).toContain("  2 | build failed");
    expect(providerPrompt).toContain(
      '{"environmentId":"environment","threadId":"thread","instanceId":"running-terminal","terminalId":"terminal"}',
    );
    expect(providerPrompt).not.toContain("PRIVATE");
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
    useComposerDraftStore
      .getState()
      .removeTerminalContext(storageId, draft!.terminalContexts[0]!.id);
    expect(
      useComposerDraftStore.getState().draftsByThreadId[storageId]?.terminalContexts ?? [],
    ).toEqual([]);
  } finally {
    await view.unmount();
  }
});

it("rejects approval after the backend replaces the PTY under the same terminal ID and PID", async () => {
  const view = await renderTerminal();
  try {
    await reviewSelectedOutput();
    fixture.instanceId = "restarted-terminal";
    await page.getByRole("button", { name: "Add to draft" }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("terminal session changed");
    expect(useComposerDraftStore.getState().draftsByThreadId[storageId]).toBeUndefined();
  } finally {
    await view.unmount();
  }
});

it("revokes approval when the user cancels during the session check", async () => {
  const view = await renderTerminal();
  try {
    await reviewSelectedOutput();
    fixture.deferMetadata = true;
    await page.getByRole("button", { name: "Add to draft" }).click();
    await expect.element(page.getByRole("button", { name: "Checking session…" })).toBeDisabled();
    await page.getByRole("button", { name: "Cancel" }).click();
    fixture.deliverMetadata?.();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(useComposerDraftStore.getState().draftsByThreadId[storageId]).toBeUndefined();
  } finally {
    await view.unmount();
  }
});

function TerminalWithAttachmentTargets() {
  useTerminalAttachmentTargets(environmentId);
  return (
    <CompanionTerminalPanel
      threadId={ThreadId.makeUnsafe("thread")}
      environmentId={environmentId}
    />
  );
}

it("drags a real file from the terminal session tab", async () => {
  const view = await renderTerminal(true);
  try {
    const tab = page.getByRole("tab", { name: "command --token PRIVATE-ARG" });
    await expect.element(tab).toHaveAttribute("draggable", "true");
    await expect
      .poll(async () => {
        const transfer = new DataTransfer();
        tab
          .element()
          .dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
        const file = transfer.files[0];
        if (!file) return null;
        return { name: file.name, type: file.type, reference: JSON.parse(await file.text()) };
      })
      .toMatchObject({
        name: "Terminal.tabs.json",
        type: "application/vnd.tabs.surface+json",
        reference: {
          environmentId: "environment",
          projectId: "project",
          threadId: "thread",
          target: { kind: "terminal", terminalId: "terminal", instanceId: "running-terminal" },
        },
      });
  } finally {
    await view.unmount();
  }
});
