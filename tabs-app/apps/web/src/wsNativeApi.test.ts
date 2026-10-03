import {
  CommandId,
  type ContextMenuItem,
  EventId,
  ORCHESTRATION_WS_CHANNELS,
  ORCHESTRATION_WS_METHODS,
  ProviderInstanceId,
  type OrchestrationEvent,
  ProjectId,
  ThreadId,
  type WsPushChannel,
  type WsPushData,
  type WsPushMessage,
  WS_CHANNELS,
  WS_METHODS,
  type WsPush,
  type ServerProvider,
} from "@tabs/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeAppModelSelection } from "./modelSelection";
import { makeTestServerProvider } from "./test/serverProviderFixture";

const requestMock = vi.fn<(...args: Array<unknown>) => Promise<unknown>>();
const showContextMenuFallbackMock =
  vi.fn<
    <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>
  >();
const channelListeners = new Map<string, Set<(message: WsPush) => void>>();
const latestPushByChannel = new Map<string, WsPush>();
const subscribeMock = vi.fn<
  (
    channel: string,
    listener: (message: WsPush) => void,
    options?: { replayLatest?: boolean },
  ) => () => void
>((channel, listener, options) => {
  const listeners = channelListeners.get(channel) ?? new Set<(message: WsPush) => void>();
  listeners.add(listener);
  channelListeners.set(channel, listeners);
  const latest = latestPushByChannel.get(channel);
  if (latest && options?.replayLatest) {
    listener(latest);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      channelListeners.delete(channel);
    }
  };
});

vi.mock("./wsTransport", () => {
  return {
    WsTransport: class MockWsTransport {
      request = requestMock;
      subscribe = subscribeMock;
      onOpen(listener: () => void) {
        listener();
        return () => undefined;
      }
      getLatestPush(channel: string) {
        return latestPushByChannel.get(channel) ?? null;
      }
    },
  };
});

vi.mock("./contextMenuFallback", () => ({
  showContextMenuFallback: showContextMenuFallbackMock,
}));

let nextPushSequence = 1;

function emitPush<C extends WsPushChannel>(channel: C, data: WsPushData<C>): void {
  const listeners = channelListeners.get(channel);
  const message = {
    type: "push" as const,
    sequence: nextPushSequence++,
    channel,
    data,
  } as WsPushMessage<C>;
  latestPushByChannel.set(channel, message);
  if (!listeners) return;
  for (const listener of listeners) {
    listener(message);
  }
}

function getWindowForTest(): Window & typeof globalThis & { desktopBridge?: unknown } {
  const testGlobal = globalThis as typeof globalThis & {
    window?: Window & typeof globalThis & { desktopBridge?: unknown };
  };
  if (!testGlobal.window) {
    testGlobal.window = {} as Window & typeof globalThis & { desktopBridge?: unknown };
  }
  return testGlobal.window;
}

const defaultProviders: ReadonlyArray<ServerProvider> = [
  makeTestServerProvider({ checkedAt: "2026-01-01T00:00:00.000Z" }),
];

beforeEach(() => {
  vi.resetModules();
  requestMock.mockReset();
  showContextMenuFallbackMock.mockReset();
  subscribeMock.mockClear();
  channelListeners.clear();
  latestPushByChannel.clear();
  nextPushSequence = 1;
  Reflect.deleteProperty(getWindowForTest(), "desktopBridge");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("wsNativeApi", () => {
  it("forwards workspace provider refresh inputs", async () => {
    const { createWsNativeApi } = await import("./wsNativeApi");
    requestMock.mockResolvedValue({ providers: [] });
    const api = createWsNativeApi();
    const input = {
      instanceId: ProviderInstanceId.makeUnsafe("codex"),
      cwd: "/workspace/project",
    } as const;

    await api.server.refreshProviders(input);

    expect(requestMock).toHaveBeenCalledWith(WS_METHODS.serverRefreshProviders, input);
  });

  it("isolates progress listeners between non-singleton environment transports", async () => {
    const { createWsNativeApi } = await import("./wsNativeApi");
    const firstListeners = new Map<string, (message: WsPush) => void>();
    const secondListeners = new Map<string, (message: WsPush) => void>();
    const makeTransport = (listeners: Map<string, (message: WsPush) => void>) =>
      ({
        request: requestMock,
        subscribe: (channel: string, listener: (message: WsPush) => void) => {
          listeners.set(channel, listener);
          return () => listeners.delete(channel);
        },
        onOpen: () => () => undefined,
      }) as never;

    const firstApi = createWsNativeApi({
      transport: makeTransport(firstListeners),
      singleton: false,
    });
    const secondApi = createWsNativeApi({
      transport: makeTransport(secondListeners),
      singleton: false,
    });
    const firstProgress = vi.fn();
    const secondProgress = vi.fn();
    firstApi.git.onActionProgress(firstProgress);
    secondApi.git.onActionProgress(secondProgress);

    firstListeners.get(WS_CHANNELS.gitActionProgress)?.({
      type: "push",
      sequence: 1,
      channel: WS_CHANNELS.gitActionProgress,
      data: {
        actionId: "first-action",
        cwd: "/first",
        action: "commit",
        kind: "phase_started",
        phase: "commit",
        label: "Committing...",
      },
    });

    expect(firstProgress).toHaveBeenCalledTimes(1);
    expect(secondProgress).not.toHaveBeenCalled();
  });

  it("delivers and caches valid server.welcome payloads", async () => {
    const { createWsNativeApi, onServerWelcome } = await import("./wsNativeApi");

    createWsNativeApi();
    const listener = vi.fn();
    onServerWelcome(listener);

    const payload = { cwd: "/tmp/workspace", projectName: "tabs-code" };
    emitPush(WS_CHANNELS.serverWelcome, payload);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining(payload));

    const lateListener = vi.fn();
    onServerWelcome(lateListener);

    expect(lateListener).toHaveBeenCalledTimes(1);
    expect(lateListener).toHaveBeenCalledWith(expect.objectContaining(payload));
  });

  it("preserves bootstrap ids from server.welcome payloads", async () => {
    const { createWsNativeApi, onServerWelcome } = await import("./wsNativeApi");

    createWsNativeApi();
    const listener = vi.fn();
    onServerWelcome(listener);

    emitPush(WS_CHANNELS.serverWelcome, {
      cwd: "/tmp/workspace",
      projectName: "tabs-code",
      bootstrapProjectId: ProjectId.makeUnsafe("project-1"),
      bootstrapThreadId: ThreadId.makeUnsafe("thread-1"),
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/tmp/workspace",
        projectName: "tabs-code",
        bootstrapProjectId: "project-1",
        bootstrapThreadId: "thread-1",
      }),
    );
  });

  it("delivers successive server.welcome payloads to active listeners", async () => {
    const { createWsNativeApi, onServerWelcome } = await import("./wsNativeApi");

    createWsNativeApi();
    const listener = vi.fn();
    onServerWelcome(listener);

    emitPush(WS_CHANNELS.serverWelcome, { cwd: "/tmp/one", projectName: "one" });
    emitPush(WS_CHANNELS.serverWelcome, { cwd: "/tmp/workspace", projectName: "tabs-code" });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cwd: "/tmp/workspace",
        projectName: "tabs-code",
      }),
    );
  });

  it("delivers and caches valid server.configUpdated payloads", async () => {
    const { createWsNativeApi, onServerConfigUpdated } = await import("./wsNativeApi");

    createWsNativeApi();
    const listener = vi.fn();
    onServerConfigUpdated(listener);

    const payload = {
      issues: [
        {
          kind: "keybindings.invalid-entry",
          index: 1,
          message: "Entry at index 1 is invalid.",
        },
      ],
      providers: [],
    } as const;
    emitPush(WS_CHANNELS.serverConfigUpdated, payload);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(payload);

    const lateListener = vi.fn();
    onServerConfigUpdated(lateListener);
    expect(lateListener).toHaveBeenCalledTimes(1);
    expect(lateListener).toHaveBeenCalledWith(payload);
  });

  it("delivers successive server.configUpdated payloads to active listeners", async () => {
    const { createWsNativeApi, onServerConfigUpdated } = await import("./wsNativeApi");

    createWsNativeApi();
    const listener = vi.fn();
    onServerConfigUpdated(listener);

    emitPush(WS_CHANNELS.serverConfigUpdated, {
      issues: [{ kind: "keybindings.malformed-config", message: "bad json" }],
      providers: [],
    });
    emitPush(WS_CHANNELS.serverConfigUpdated, {
      issues: [],
      providers: [],
    });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({
      issues: [],
      providers: [],
    });
  });

  it("delivers and caches valid server.providersUpdated payloads", async () => {
    const { createWsNativeApi, onServerProvidersUpdated } = await import("./wsNativeApi");

    createWsNativeApi();
    const listener = vi.fn();
    onServerProvidersUpdated(listener);

    const payload = {
      providers: defaultProviders,
    } as const;
    emitPush(WS_CHANNELS.serverProvidersUpdated, payload);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(payload);

    const lateListener = vi.fn();
    onServerProvidersUpdated(lateListener);
    expect(lateListener).toHaveBeenCalledTimes(1);
    expect(lateListener).toHaveBeenCalledWith(payload);
  });

  it("forwards valid terminal and orchestration events", async () => {
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    const onTerminalEvent = vi.fn();
    const onDomainEvent = vi.fn();
    const onActionProgress = vi.fn();

    api.terminal.onEvent(onTerminalEvent);
    api.orchestration.onDomainEvent(onDomainEvent);
    api.git.onActionProgress(onActionProgress);

    const terminalEvent = {
      threadId: "thread-1",
      terminalId: "terminal-1",
      createdAt: "2026-02-24T00:00:00.000Z",
      type: "output",
      data: "hello",
    } as const;
    emitPush(WS_CHANNELS.terminalEvent, terminalEvent);

    const orchestrationEvent = {
      sequence: 1,
      eventId: EventId.makeUnsafe("event-1"),
      aggregateKind: "project",
      aggregateId: ProjectId.makeUnsafe("project-1"),
      occurredAt: "2026-02-24T00:00:00.000Z",
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.created",
      payload: {
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/workspace",
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-02-24T00:00:00.000Z",
        updatedAt: "2026-02-24T00:00:00.000Z",
      },
    } satisfies Extract<OrchestrationEvent, { type: "project.created" }>;
    emitPush(ORCHESTRATION_WS_CHANNELS.domainEvent, orchestrationEvent);
    emitPush(WS_CHANNELS.gitActionProgress, {
      actionId: "action-1",
      cwd: "/repo",
      action: "commit",
      kind: "phase_started",
      phase: "commit",
      label: "Committing...",
    });

    expect(onTerminalEvent).toHaveBeenCalledTimes(1);
    expect(onTerminalEvent).toHaveBeenCalledWith(terminalEvent);
    expect(onDomainEvent).toHaveBeenCalledTimes(1);
    expect(onDomainEvent).toHaveBeenCalledWith(orchestrationEvent);
    expect(onActionProgress).toHaveBeenCalledTimes(1);
    expect(onActionProgress).toHaveBeenCalledWith({
      actionId: "action-1",
      cwd: "/repo",
      action: "commit",
      kind: "phase_started",
      phase: "commit",
      label: "Committing...",
    });
  });

  it("connects preview automation hosts and forwards broker events", async () => {
    requestMock.mockResolvedValue(undefined);
    const { createWsNativeApi } = await import("./wsNativeApi");
    const api = createWsNativeApi();
    const listener = vi.fn();
    const host = {
      clientId: "desktop-client",
      environmentId: "environment-1",
      supportedOperations: ["status", "snapshot"],
    } as never;

    const unsubscribe = api.preview.automation.connect(host, listener);
    emitPush(WS_CHANNELS.previewAutomationEvent, {
      type: "connected",
      connectionId: "connection-1",
    });

    expect(requestMock).toHaveBeenCalledWith(WS_METHODS.previewAutomationConnect, host, {
      timeoutMs: null,
    });
    expect(listener).toHaveBeenCalledWith({
      type: "connected",
      connectionId: "connection-1",
    });

    await api.preview.automation.respond({
      clientId: "desktop-client",
      connectionId: "connection-1",
      requestId: "request-1",
      ok: true,
      result: { available: true },
    });
    expect(requestMock).toHaveBeenLastCalledWith(
      WS_METHODS.previewAutomationRespond,
      expect.objectContaining({ requestId: "request-1", ok: true }),
    );
    unsubscribe();
  });

  it("wraps orchestration dispatch commands in the command envelope", async () => {
    requestMock.mockResolvedValue(undefined);
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    const command = {
      type: "project.create",
      commandId: CommandId.makeUnsafe("cmd-1"),
      projectId: ProjectId.makeUnsafe("project-1"),
      title: "Project",
      workspaceRoot: "/tmp/project",
      defaultModelSelection: makeAppModelSelection("codex", "gpt-5-codex"),
      createdAt: "2026-02-24T00:00:00.000Z",
    } as const;
    await api.orchestration.dispatchCommand(command);

    expect(requestMock).toHaveBeenCalledWith(ORCHESTRATION_WS_METHODS.dispatchCommand, {
      command,
    });
  });

  it("forwards workspace file writes to the websocket project method", async () => {
    requestMock.mockResolvedValue({ relativePath: "plan.md" });
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    await api.projects.writeFile({
      cwd: "/tmp/project",
      relativePath: "plan.md",
      contents: "# Plan\n",
    });

    expect(requestMock).toHaveBeenCalledWith(WS_METHODS.projectsWriteFile, {
      cwd: "/tmp/project",
      relativePath: "plan.md",
      contents: "# Plan\n",
    });
  });

  it("forwards workspace file reads to the websocket project method", async () => {
    requestMock.mockResolvedValue({ relativePath: "plan.md", contents: "# Plan\n" });
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    await api.projects.readFile({
      cwd: "/tmp/project",
      relativePath: "plan.md",
    });

    expect(requestMock).toHaveBeenCalledWith(WS_METHODS.projectsReadFile, {
      cwd: "/tmp/project",
      relativePath: "plan.md",
    });
  });

  it("forwards Testing artifact reads without a caller-supplied path", async () => {
    requestMock.mockResolvedValue({ contents: "export const preview = true;\n" });
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    await api.testing.readArtifact({
      projectId: "project-a",
      generationJobId: "job-1",
      caseId: "case-1",
      artifactKind: "data",
    });

    expect(requestMock).toHaveBeenCalledWith(WS_METHODS.testingReadArtifact, {
      projectId: "project-a",
      generationJobId: "job-1",
      caseId: "case-1",
      artifactKind: "data",
    });
  });

  it("uses no client timeout for git.runStackedAction", async () => {
    requestMock.mockResolvedValue({
      action: "commit",
      branch: { status: "skipped_not_requested" },
      commit: { status: "created", commitSha: "abc1234", subject: "Test" },
      push: { status: "skipped_not_requested" },
      pr: { status: "skipped_not_requested" },
    });
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    await api.git.runStackedAction({
      actionId: "action-1",
      cwd: "/repo",
      action: "commit",
    });

    expect(requestMock).toHaveBeenCalledWith(
      WS_METHODS.gitRunStackedAction,
      {
        actionId: "action-1",
        cwd: "/repo",
        action: "commit",
      },
      { timeoutMs: null },
    );
  });

  it("forwards full-thread diff requests to the orchestration websocket method", async () => {
    requestMock.mockResolvedValue({ diff: "patch" });
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    await api.orchestration.getFullThreadDiff({
      threadId: ThreadId.makeUnsafe("thread-1"),
      toTurnCount: 1,
    });

    expect(requestMock).toHaveBeenCalledWith(ORCHESTRATION_WS_METHODS.getFullThreadDiff, {
      threadId: "thread-1",
      toTurnCount: 1,
    });
  });

  it("forwards context menu metadata to desktop bridge", async () => {
    const showContextMenu = vi.fn().mockResolvedValue("delete");
    Object.defineProperty(getWindowForTest(), "desktopBridge", {
      configurable: true,
      writable: true,
      value: {
        showContextMenu,
      },
    });

    const { createWsNativeApi } = await import("./wsNativeApi");
    const api = createWsNativeApi();
    await api.contextMenu.show(
      [
        { id: "rename", label: "Rename thread" },
        { id: "delete", label: "Delete", destructive: true },
      ],
      { x: 200, y: 300 },
    );

    expect(showContextMenu).toHaveBeenCalledWith(
      [
        { id: "rename", label: "Rename thread" },
        { id: "delete", label: "Delete", destructive: true },
      ],
      { x: 200, y: 300 },
    );
  });

  it("uses fallback context menu when desktop bridge is unavailable", async () => {
    showContextMenuFallbackMock.mockResolvedValue("delete");
    Reflect.deleteProperty(getWindowForTest(), "desktopBridge");

    const { createWsNativeApi } = await import("./wsNativeApi");
    const api = createWsNativeApi();
    await api.contextMenu.show([{ id: "delete", label: "Delete", destructive: true }], {
      x: 20,
      y: 30,
    });

    expect(showContextMenuFallbackMock).toHaveBeenCalledWith(
      [{ id: "delete", label: "Delete", destructive: true }],
      { x: 20, y: 30 },
    );
  });
});
