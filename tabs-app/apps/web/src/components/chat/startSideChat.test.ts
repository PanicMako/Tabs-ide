import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnvironmentId, ThreadId } from "@tabs/contracts";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("~/connection/environmentApiRegistry", () => ({
  environmentApi: async () => ({ orchestration: { dispatchCommand: mocks.dispatch } }),
}));

import { appAtomRegistry } from "~/state/atomRegistry";
import { readModelStateAtom } from "~/state/readModel";
import { useCompanionSurfaceStore } from "~/stores/companionSurfaceStore";
import { useRightPanelStore } from "~/stores/rightPanelStore";
import { registerSideChatSettings, sideChatScope, startSideChat } from "./useSideChat";

const environmentId = EnvironmentId.make("env-1");
const parentThreadId = ThreadId.make("parent-thread");
const parent = {
  id: parentThreadId,
  environmentId,
  runtimeMode: "approval-required",
  modelSelection: { instanceId: "codex", model: "gpt-5" },
};

type Command = { readonly type: string; readonly [key: string]: unknown };

/** Makes the fork reach this client's read model, like the server's shell stream would. */
function reachClient(command: Command) {
  if (command.type !== "thread.fork") return;
  appAtomRegistry.update(readModelStateAtom, (state) => ({
    ...state,
    threads: [
      ...state.threads,
      {
        ...parent,
        id: command.targetThreadId as ThreadId,
        isSideChat: true,
        parentThreadId,
        runtimeMode: "full-access",
        messages: [],
        latestTurn: null,
      } as never,
    ],
  }));
}

beforeEach(() => {
  mocks.dispatch.mockReset();
  mocks.dispatch.mockImplementation(async (command: Command) => reachClient(command));
  useCompanionSurfaceStore.setState({ workspaces: {} });
  useRightPanelStore.setState({ isOpen: false });
  appAtomRegistry.update(readModelStateAtom, (state) => ({ ...state, threads: [parent as never] }));
});

const sent = () => mocks.dispatch.mock.calls.map(([command]) => command as Command);

describe("startSideChat", () => {
  it("forks the parent as a side chat, copies the composer's settings, and opens its tab", async () => {
    const onError = vi.fn();
    const modelSelection = { instanceId: "claudeAgent", model: "claude-opus" } as never;
    const started = await startSideChat({
      environmentId,
      parentThreadId,
      settings: { runtimeMode: "approval-required", modelSelection },
      prompt: "  why did that fail?  ",
      onError,
    });

    expect(started).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    const commands = sent();
    expect(commands.map((command) => command.type)).toEqual([
      "thread.fork",
      "thread.runtime-mode.set",
      "thread.model-selection.set",
      "message.dispatch",
    ]);
    expect(commands[0]).toMatchObject({
      sourceThreadId: parentThreadId,
      sourcePoint: { type: "latest_stable" },
      sideChat: true,
    });
    expect(commands[1]).toMatchObject({ runtimeMode: "approval-required" });
    expect(commands[2]).toMatchObject({ modelSelection });
    expect(commands[3]).toMatchObject({ text: "why did that fail?", modelSelection });
    const sideChatId = commands[0]!.targetThreadId;
    const tabs =
      useCompanionSurfaceStore.getState().workspaces[sideChatScope(environmentId, parentThreadId)]
        ?.tabs;
    expect(tabs).toMatchObject([{ kind: "sidechat", sideChatThreadId: sideChatId }]);
    expect(useRightPanelStore.getState()).toMatchObject({ isOpen: true, activeTab: "sidechat" });
  });

  it("opens an empty side chat from the surface chooser without sending a message", async () => {
    expect(
      await startSideChat({
        environmentId,
        parentThreadId,
        settings: undefined,
        onError: vi.fn(),
      }),
    ).toBe(true);
    // The parent's own mode and model are used; the fork already carries them.
    expect(sent().map((command) => command.type)).toEqual([
      "thread.fork",
      "thread.runtime-mode.set",
      "thread.model-selection.set",
    ]);
    expect(sent()[1]).toMatchObject({ runtimeMode: "approval-required" });
  });

  it("deletes the side chat and reports when starting it fails", async () => {
    mocks.dispatch.mockImplementation(async (command: Command) => {
      reachClient(command);
      if (command.type === "message.dispatch") throw new Error("provider is unavailable");
    });
    const onError = vi.fn();
    expect(
      await startSideChat({
        environmentId,
        parentThreadId,
        settings: undefined,
        prompt: "hello",
        onError,
      }),
    ).toBe(false);
    expect(onError).toHaveBeenCalledWith("provider is unavailable");
    const commands = sent();
    expect(commands.at(-1)).toMatchObject({
      type: "thread.delete",
      threadId: commands[0]!.targetThreadId,
    });
    expect(useCompanionSurfaceStore.getState().workspaces).toEqual({});
  });

  it("refuses a second side chat while one is still starting", async () => {
    let release: () => void = () => undefined;
    mocks.dispatch.mockImplementation(
      (command: Command) =>
        new Promise<void>((resolve) => {
          release = () => {
            reachClient(command);
            resolve();
          };
        }),
    );
    const first = startSideChat({
      environmentId,
      parentThreadId,
      settings: undefined,
      onError: vi.fn(),
    });
    await Promise.resolve();
    expect(
      await startSideChat({
        environmentId,
        parentThreadId,
        settings: undefined,
        onError: vi.fn(),
      }),
    ).toBe(false);
    mocks.dispatch.mockImplementation(async (command: Command) => reachClient(command));
    release();
    expect(await first).toBe(true);
  });

  it("explains that a draft thread has nothing to fork yet", async () => {
    appAtomRegistry.update(readModelStateAtom, (state) => ({ ...state, threads: [] }));
    const onError = vi.fn();
    expect(
      await startSideChat({
        environmentId,
        parentThreadId,
        settings: undefined,
        onError,
      }),
    ).toBe(false);
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("Send a message in this thread first"),
    );
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("does nothing without a thread to ask about", async () => {
    expect(
      await startSideChat({
        environmentId,
        parentThreadId: null,
        settings: undefined,
        onError: vi.fn(),
      }),
    ).toBe(false);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});

describe("registerSideChatSettings", () => {
  it("is read back for the thread and gone after unregistering", async () => {
    const { readSideChatSettings } = await import("./useSideChat");
    const read = () => ({ runtimeMode: "full-access" as const, modelSelection: undefined });
    const unregister = registerSideChatSettings("scope-a", read);
    expect(readSideChatSettings("scope-a")?.runtimeMode).toBe("full-access");
    unregister();
    expect(readSideChatSettings("scope-a")).toBeUndefined();
  });
});
