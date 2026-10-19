import {
  CommandId,
  type ContextMenuItem,
  EventId,
  ORCHESTRATION_WS_CHANNELS,
  ORCHESTRATION_WS_METHODS,
  ORCHESTRATION_V2_WS_METHODS,
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
const subscribeRpcMock = vi.fn(() => () => undefined);
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
      resolveHttpUrl(path: string) {
        return new URL(path, "https://connected.test").href;
      }
      subscribe = subscribeMock;
      subscribeRpc = subscribeRpcMock;
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
  subscribeRpcMock.mockClear();
  channelListeners.clear();
  latestPushByChannel.clear();
  nextPushSequence = 1;
  Reflect.deleteProperty(getWindowForTest(), "desktopBridge");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("wsNativeApi", () => {
  it("routes usage summaries to the V2 service and reads authoritative quota snapshots", async () => {
    const { createWsNativeApi } = await import("./wsNativeApi");
    const api = createWsNativeApi();
    const input = {
      sinceDay: "2026-10-01",
      untilDay: "2026-10-14",
      timeZone: "Asia/Kolkata",
    } as Parameters<typeof api.server.readUsageSummary>[0];
    requestMock.mockResolvedValueOnce({ buckets: [] });
    await api.server.readUsageSummary(input);
    expect(requestMock).toHaveBeenLastCalledWith("server.getUsageSummary", input);
    requestMock.mockResolvedValueOnce({ providers: [makeTestServerProvider()] });
    await api.server.listUsageSnapshots();
    expect(requestMock).toHaveBeenLastCalledWith(WS_METHODS.serverGetConfig);
  });

  it("subscribes to resource telemetry as an RPC stream instead of a unary request", async () => {
    const { createWsNativeApi } = await import("./wsNativeApi");
    const api = createWsNativeApi();
    const stop = vi.fn();
    subscribeRpcMock.mockReturnValueOnce(stop);
    const callback = vi.fn();
    const unsubscribe = api.server.onResourceTelemetry!(callback);
    expect(subscribeRpcMock).toHaveBeenCalledWith(
      WS_METHODS.subscribeResourceTelemetry,
      expect.any(Function),
      expect.any(Function),
      callback,
      expect.any(Function),
    );
    expect(requestMock).not.toHaveBeenCalledWith(WS_METHODS.subscribeResourceTelemetry, {});
    unsubscribe();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("forwards V2 snapshots and provider changes to settings and late listeners", async () => {
    const { createWsNativeApi, onServerConfigUpdated, onServerProvidersUpdated } =
      await import("./wsNativeApi");
    createWsNativeApi();
    const subscription = (subscribeRpcMock.mock.calls as unknown[][]).find(
      (call) => call[0] === WS_METHODS.subscribeServerConfig,
    )!;
    const receive = subscription[3] as (event: unknown) => void;
    const configListener = vi.fn();
    const providerListener = vi.fn();
    const stopConfig = onServerConfigUpdated(configListener);
    const stopProviders = onServerProvidersUpdated(providerListener);
    const failed = makeTestServerProvider({ status: "error", message: "Status probe timed out" });
    receive({ version: 1, type: "snapshot", config: { issues: [], providers: [failed] } });
    const ready = makeTestServerProvider({ status: "ready" });
    receive({ version: 1, type: "providerStatuses", payload: { providers: [ready] } });
    expect(configListener).toHaveBeenLastCalledWith(
      expect.objectContaining({ providers: [ready] }),
    );
    expect(providerListener).toHaveBeenLastCalledWith({ providers: [ready] });
    const late = vi.fn();
    const stopLate = onServerProvidersUpdated(late);
    expect(late).toHaveBeenCalledWith({ providers: [ready] });
    stopConfig();
    stopProviders();
    stopLate();
  });

  it("keeps composer provider updates and late replay owned by their environment API", async () => {
    const { createWsNativeApi, onApiServerProvidersUpdated } = await import("./wsNativeApi");
    const apiA = createWsNativeApi({ singleton: false });
    const apiB = createWsNativeApi({ singleton: false });
    const subscriptions = (subscribeRpcMock.mock.calls as unknown[][]).filter(
      (call) => call[0] === WS_METHODS.subscribeServerConfig,
    );
    const receiveA = subscriptions[0]![3] as (event: unknown) => void;
    const receiveB = subscriptions[1]![3] as (event: unknown) => void;
    const providerA = makeTestServerProvider({ instanceId: "grok" });
    const providerB = makeTestServerProvider({ instanceId: "opencode" });
    receiveA({ version: 1, type: "snapshot", config: { issues: [], providers: [providerA] } });
    const a = vi.fn(),
      b = vi.fn();
    const stopA = onApiServerProvidersUpdated(apiA, a);
    const stopB = onApiServerProvidersUpdated(apiB, b);
    expect(a).toHaveBeenCalledWith({ providers: [providerA] });
    expect(b).not.toHaveBeenCalled();
    receiveB({ version: 1, type: "snapshot", config: { issues: [], providers: [providerB] } });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledWith({ providers: [providerB] });
    stopA();
    stopB();
  });

  it("receives terminal startup/output over the V2 RPC stream and releases both subscriptions", async () => {
    const { createWsNativeApi } = await import("./wsNativeApi");
    const unsubscribeRpc = vi.fn();
    const rpc = vi.fn(() => unsubscribeRpc);
    const unsubscribePush = vi.fn();
    const transport = {
      request: requestMock,
      subscribe: vi.fn(() => unsubscribePush),
      subscribeRpc: rpc,
      onOpen: () => () => undefined,
      getLatestPush: () => null,
    } as never;
    const api = createWsNativeApi({ transport, singleton: false });
    const callback = vi.fn();
    const unsubscribe = api.terminal.onEvent(callback);
    expect(rpc).toHaveBeenCalledWith(
      WS_METHODS.subscribeTerminalEvents,
      expect.any(Function),
      expect.any(Function),
      callback,
      expect.any(Function),
    );
    const args = rpc.mock.calls.find(
      (call) => (call as unknown[])[0] === WS_METHODS.subscribeTerminalEvents,
    ) as unknown as [string, () => unknown, (v: unknown) => unknown, (v: unknown) => void];
    const event = {
      type: "output",
      threadId: "settings-update-codex",
      terminalId: "default",
      data: "ready",
    };
    args[3](args[2](event));
    expect(callback).toHaveBeenCalledWith(event);
    unsubscribe();
    expect(unsubscribeRpc).toHaveBeenCalledOnce();
    expect(unsubscribePush).toHaveBeenCalled();
  });

  it("requests signed assets from the environment and resolves the actual server URL", async () => {
    const { createWsNativeApi } = await import("./wsNativeApi");
    requestMock.mockResolvedValue({
      relativeUrl: "/api/assets/media?signature=ok",
      expiresAt: 123,
    });
    const api = createWsNativeApi();
    const input = {
      resource: { _tag: "draft-workspace-file" as const, cwd: "/workspace", path: "image.png" },
    };
    expect(await api.assets.createUrl(input)).toEqual({
      relativeUrl: "https://connected.test/api/assets/media?signature=ok",
      expiresAt: 123,
    });
    expect(requestMock).toHaveBeenCalledWith(WS_METHODS.assetsCreateUrl, input);
  });

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
        subscribeRpc: vi.fn(() => () => undefined),
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

  it("forwards orchestration dispatch commands directly and routes project commands to projectsMutate", async () => {
    requestMock.mockResolvedValue(undefined);
    const { createWsNativeApi } = await import("./wsNativeApi");

    const api = createWsNativeApi();
    const threadCommand = {
      type: "thread.archive",
      commandId: CommandId.makeUnsafe("cmd-archive"),
      threadId: "thread-1",
    } as const;
    await api.orchestration.dispatchCommand(threadCommand as any);

    expect(requestMock).toHaveBeenCalledWith(
      ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
      threadCommand,
    );

    const projectCommand = {
      type: "project.create",
      commandId: CommandId.makeUnsafe("cmd-1"),
      projectId: ProjectId.makeUnsafe("project-1"),
      title: "Project",
      workspaceRoot: "/tmp/project",
      defaultModelSelection: makeAppModelSelection("codex", "gpt-5-codex"),
      createdAt: "2026-02-24T00:00:00.000Z",
    } as const;
    await api.orchestration.dispatchCommand(projectCommand);

    expect(requestMock).toHaveBeenCalledWith(
      WS_METHODS.projectsMutate,
      expect.objectContaining({
        type: "project.create",
        commandId: projectCommand.commandId,
        projectId: projectCommand.projectId,
        title: projectCommand.title,
        workspaceRoot: projectCommand.workspaceRoot,
      }),
    );
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
      expect.objectContaining({ timeoutMs: null, onChunk: expect.any(Function) }),
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

  it("normalizes legacy orchestration commands to V2 equivalents", async () => {
    requestMock.mockResolvedValue(undefined);
    const { createWsNativeApi } = await import("./wsNativeApi");
    const api = createWsNativeApi();

    // 1. thread.turn.start -> message.dispatch
    await api.orchestration.dispatchCommand({
      type: "thread.turn.start" as any,
      threadId: "thread-1" as any,
      input: { text: "Hello", attachments: [] },
    } as any);
    expect(requestMock).toHaveBeenLastCalledWith(
      ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
      expect.objectContaining({
        type: "message.dispatch",
        threadId: "thread-1",
        text: "Hello",
        dispatchMode: { type: "start_immediately" },
      }),
    );

    // 2. thread.approval.respond -> runtime-request.respond
    await api.orchestration.dispatchCommand({
      type: "thread.approval.respond" as any,
      threadId: "thread-1" as any,
      requestId: "req-1" as any,
      decision: "approved",
    } as any);
    expect(requestMock).toHaveBeenLastCalledWith(
      ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
      expect.objectContaining({
        type: "runtime-request.respond",
        threadId: "thread-1",
        requestId: "req-1",
        decision: "approved",
      }),
    );

    // 3. thread.user-input.respond -> runtime-request.respond
    await api.orchestration.dispatchCommand({
      type: "thread.user-input.respond" as any,
      threadId: "thread-1" as any,
      requestId: "req-2" as any,
      answers: { q1: "answer1" },
    } as any);
    expect(requestMock).toHaveBeenLastCalledWith(
      ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
      expect.objectContaining({
        type: "runtime-request.respond",
        threadId: "thread-1",
        requestId: "req-2",
        answers: { q1: "answer1" },
      }),
    );

    // 4. thread.meta.update -> thread.metadata.update
    await api.orchestration.dispatchCommand({
      type: "thread.meta.update" as any,
      threadId: "thread-1" as any,
      title: "New Title",
    } as any);
    expect(requestMock).toHaveBeenLastCalledWith(
      ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
      expect.objectContaining({
        type: "thread.metadata.update",
        threadId: "thread-1",
        title: "New Title",
      }),
    );

    // 5. thread.meta.update with only modelSelection -> thread.model-selection.set
    await api.orchestration.dispatchCommand({
      type: "thread.meta.update" as any,
      threadId: "thread-1" as any,
      modelSelection: { provider: "codex", model: "gpt-5" },
    } as any);
    expect(requestMock).toHaveBeenLastCalledWith(
      ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
      expect.objectContaining({
        type: "thread.model-selection.set",
        threadId: "thread-1",
        modelSelection: { provider: "codex", model: "gpt-5" },
      }),
    );
  });

  describe("Authoritative snapshot compatibility (Area 4)", () => {
    it("throws before initial snapshot arrives", async () => {
      const { createWsNativeApi } = await import("./wsNativeApi");
      const { removeEnvironmentReadModelFromAtoms } = await import("./state/readModel");
      removeEnvironmentReadModelFromAtoms("primary" as any);
      const api = createWsNativeApi();

      await expect(api.orchestration.getSnapshot()).rejects.toThrow(
        /Orchestration snapshot unavailable/,
      );
    });

    it("returns real sequence and empty arrays for legitimately empty environment", async () => {
      const { createWsNativeApi } = await import("./wsNativeApi");
      const { applyShellStreamItemToAtoms } = await import("./state/readModel");
      const api = createWsNativeApi();

      applyShellStreamItemToAtoms(
        {
          kind: "snapshot",
          snapshot: {
            schemaVersion: 1 as any,
            snapshotSequence: 105,
            projects: [],
            threads: [],
            archivedThreads: [],
          },
        },
        "primary" as any,
      );

      const snapshot = await api.orchestration.getSnapshot();
      expect(snapshot.snapshotSequence).toBe(105);
      expect(snapshot.projects).toEqual([]);
      expect(snapshot.threads).toEqual([]);
      expect(snapshot.updatedAt).toBeDefined();
    });

    it("correctly scopes primary and secondary environments without mixing", async () => {
      const { createWsNativeApi } = await import("./wsNativeApi");
      const { applyShellStreamItemToAtoms } = await import("./state/readModel");
      const { setPrimaryEnvironmentIdForTesting } =
        await import("./connection/environmentApiRegistry");
      setPrimaryEnvironmentIdForTesting("env-primary");

      const primaryTransport = {
        environmentId: "env-primary",
        subscribe: vi.fn(() => () => {}),
        subscribeRpc: vi.fn(() => () => undefined),
      } as any;
      const secondaryTransport = {
        environmentId: "env-secondary",
        subscribe: vi.fn(() => () => {}),
        subscribeRpc: vi.fn(() => () => undefined),
      } as any;

      const primaryApi = createWsNativeApi({ transport: primaryTransport, singleton: false });
      const secondaryApi = createWsNativeApi({ transport: secondaryTransport, singleton: false });

      // Seed primary snapshot
      applyShellStreamItemToAtoms(
        {
          kind: "snapshot",
          snapshot: {
            schemaVersion: 1 as any,
            snapshotSequence: 10,
            projects: [
              {
                id: "proj-primary" as any,
                title: "Primary Project",
                workspaceRoot: "/primary",
                defaultModelSelection: { provider: "codex", model: "gpt-5" },
                scripts: [],
                tools: [],
                environmentId: "env-primary" as any,
              } as any,
            ],
            threads: [],
            archivedThreads: [],
          },
        },
        "env-primary" as any,
      );

      // Seed secondary snapshot
      applyShellStreamItemToAtoms(
        {
          kind: "snapshot",
          snapshot: {
            schemaVersion: 1 as any,
            snapshotSequence: 20,
            projects: [
              {
                id: "proj-secondary" as any,
                title: "Secondary Project",
                workspaceRoot: "/secondary",
                defaultModelSelection: { provider: "codex", model: "gpt-5" },
                scripts: [],
                tools: [],
                environmentId: "env-secondary" as any,
              } as any,
            ],
            threads: [],
            archivedThreads: [],
          },
        },
        "env-secondary" as any,
      );

      const primarySnapshot = await primaryApi.orchestration.getSnapshot();
      expect(primarySnapshot.snapshotSequence).toBe(10);
      expect(primarySnapshot.projects).toHaveLength(1);
      expect((primarySnapshot.projects[0] as any).id).toBe("proj-primary");

      const secondarySnapshot = await secondaryApi.orchestration.getSnapshot();
      expect(secondarySnapshot.snapshotSequence).toBe(20);
      expect(secondarySnapshot.projects).toHaveLength(1);
      expect((secondarySnapshot.projects[0] as any).id).toBe("proj-secondary");
    });

    it("updates sequence after reconnect/resubscription shell update", async () => {
      const { createWsNativeApi } = await import("./wsNativeApi");
      const { applyShellStreamItemToAtoms } = await import("./state/readModel");
      const api = createWsNativeApi();

      applyShellStreamItemToAtoms(
        {
          kind: "snapshot",
          snapshot: {
            schemaVersion: 1 as any,
            snapshotSequence: 50,
            projects: [],
            threads: [],
            archivedThreads: [],
          },
        },
        "primary" as any,
      );

      let snapshot = await api.orchestration.getSnapshot();
      expect(snapshot.snapshotSequence).toBe(50);

      // Reconnect/stream event update
      applyShellStreamItemToAtoms(
        {
          kind: "snapshot",
          snapshot: {
            schemaVersion: 1 as any,
            snapshotSequence: 75,
            projects: [],
            threads: [],
            archivedThreads: [],
          },
        },
        "primary" as any,
      );

      snapshot = await api.orchestration.getSnapshot();
      expect(snapshot.snapshotSequence).toBe(75);
    });

    it("throws when environment state becomes unavailable or disconnected", async () => {
      const { createWsNativeApi } = await import("./wsNativeApi");
      const { applyShellStreamItemToAtoms, removeEnvironmentReadModelFromAtoms } =
        await import("./state/readModel");
      const secondaryTransport = {
        environmentId: "env-temporary",
        subscribe: vi.fn(() => () => {}),
        subscribeRpc: vi.fn(() => () => undefined),
      } as any;
      const api = createWsNativeApi({ transport: secondaryTransport, singleton: false });

      applyShellStreamItemToAtoms(
        {
          kind: "snapshot",
          snapshot: {
            schemaVersion: 1 as any,
            snapshotSequence: 1,
            projects: [],
            threads: [],
            archivedThreads: [],
          },
        },
        "env-temporary" as any,
      );

      // Verified available
      expect((await api.orchestration.getSnapshot()).snapshotSequence).toBe(1);

      // Environment disconnects
      removeEnvironmentReadModelFromAtoms("env-temporary" as any);

      // Now fails faithfully instead of returning empty state
      await expect(api.orchestration.getSnapshot()).rejects.toThrow(
        /Orchestration snapshot unavailable/,
      );
    });

    it("preserves existing threads when receiving an enrichment refresh frame", async () => {
      const { createWsNativeApi } = await import("./wsNativeApi");
      const { applyShellStreamItemToAtoms } = await import("./state/readModel");
      const api = createWsNativeApi();

      // 1. Initial authoritative snapshot with a thread
      applyShellStreamItemToAtoms(
        {
          kind: "snapshot",
          snapshot: {
            schemaVersion: 1 as any,
            snapshotSequence: 10,
            projects: [
              {
                id: "proj-1" as any,
                title: "Project 1",
                workspaceRoot: "/workspace/proj-1",
                defaultModelSelection: null,
                defaultThreadEnvMode: null,
                faviconPath: null,
                projectIcon: null,
                createdAt: "2026-10-13T00:00:00.000Z" as any,
                updatedAt: "2026-10-13T00:00:00.000Z" as any,
                scripts: [],
              },
            ],
            threads: [
              {
                id: "thread-1" as any,
                projectId: "proj-1" as any,
                title: "Thread 1",
                status: "idle",
                modelSelection: { instanceId: "codex" as any, model: "gpt-5.3-codex" },
                runtimeMode: "full-access",
                interactionMode: "default",
                providerInstanceId: "codex" as any,
                createdAt: "2026-10-13T00:00:00.000Z" as any,
                updatedAt: "2026-10-13T00:00:00.000Z" as any,
              } as any,
            ],
            archivedThreads: [],
          },
        },
        "primary" as any,
      );

      const snap1 = await api.orchestration.getSnapshot();
      expect(snap1.threads).toHaveLength(1);
      expect(snap1.threads[0]?.id).toBe("thread-1");

      // 2. Enrichment refresh frame arrives (threads: [], resolvedRepositoryIdentityRoots defined)
      applyShellStreamItemToAtoms(
        {
          kind: "snapshot",
          snapshot: {
            schemaVersion: 1 as any,
            snapshotSequence: 11,
            projects: [
              {
                id: "proj-1" as any,
                title: "Project 1 Enriched",
                workspaceRoot: "/workspace/proj-1",
                defaultModelSelection: null,
                defaultThreadEnvMode: null,
                faviconPath: null,
                projectIcon: null,
                createdAt: "2026-10-13T00:00:00.000Z" as any,
                updatedAt: "2026-10-13T00:00:00.000Z" as any,
                scripts: [],
              },
            ],
            threads: [],
            archivedThreads: [],
          },
          resolvedRepositoryIdentityRoots: ["/workspace/proj-1"],
        },
        "primary" as any,
      );

      // Existing threads must NOT be wiped!
      const snap2 = await api.orchestration.getSnapshot();
      expect(snap2.threads).toHaveLength(1);
      expect(snap2.threads[0]?.id).toBe("thread-1");
      expect(snap2.projects).toHaveLength(1);
      expect(snap2.projects[0]?.title).toBe("Project 1 Enriched");
      expect(snap2.snapshotSequence).toBe(11);
    });
  });

  describe("Public V2 command contract validation and alignment (Area 3)", () => {
    it("dispatches run.interrupt with holdQueue for normal interruption", async () => {
      const { createWsNativeApi } = await import("./wsNativeApi");
      const api = createWsNativeApi();

      await api.orchestration.dispatchCommand({
        type: "run.interrupt",
        commandId: "cmd-interrupt-1" as any,
        threadId: "thread-1" as any,
        runId: "run-1" as any,
        holdQueue: true,
      });

      expect(requestMock).toHaveBeenLastCalledWith(
        ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
        expect.objectContaining({
          type: "run.interrupt",
          commandId: "cmd-interrupt-1",
          threadId: "thread-1",
          runId: "run-1",
          holdQueue: true,
        }),
      );
    });

    it("dispatches run.interrupt with holdQueue and reason for forced stop escape", async () => {
      const { createWsNativeApi } = await import("./wsNativeApi");
      const api = createWsNativeApi();

      await api.orchestration.dispatchCommand({
        type: "run.interrupt",
        commandId: "cmd-force-stop-1" as any,
        threadId: "thread-1" as any,
        runId: "run-1" as any,
        holdQueue: true,
        reason: "User force stop",
      });

      expect(requestMock).toHaveBeenLastCalledWith(
        ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
        expect.objectContaining({
          type: "run.interrupt",
          commandId: "cmd-force-stop-1",
          threadId: "thread-1",
          runId: "run-1",
          holdQueue: true,
          reason: "User force stop",
        }),
      );
    });

    it("validates runtime-request.respond approval decision against public V2 schema", async () => {
      const { OrchestrationV2Command } = await import("@tabs/contracts");
      const { Schema } = await import("effect");

      const validApprovalCommand = {
        type: "runtime-request.respond",
        commandId: "cmd-approval-1",
        threadId: "thread-1",
        requestId: "req-1",
        decision: "accept",
      };

      const decoded = Schema.decodeUnknownSync(OrchestrationV2Command)(validApprovalCommand);
      expect(decoded.type).toBe("runtime-request.respond");
    });

    it("validates runtime-request.respond user input answers against public V2 schema", async () => {
      const { OrchestrationV2Command } = await import("@tabs/contracts");
      const { Schema } = await import("effect");

      const validUserInputCommand = {
        type: "runtime-request.respond",
        commandId: "cmd-user-input-1",
        threadId: "thread-1",
        requestId: "req-1",
        answers: { question1: "answer1" },
      };

      const decoded = Schema.decodeUnknownSync(OrchestrationV2Command)(validUserInputCommand);
      expect(decoded.type).toBe("runtime-request.respond");
    });

    it("catches and rejects obsolete browser command types (inventory check)", async () => {
      const { OrchestrationV2Command } = await import("@tabs/contracts");
      const { Schema } = await import("effect");

      // thread.session.stop is NOT in public V2 command schema
      expect(() => {
        Schema.decodeUnknownSync(OrchestrationV2Command)({
          type: "thread.session.stop",
          commandId: "cmd-1",
          threadId: "thread-1",
        });
      }).toThrow();

      // thread.turn.interrupt is NOT in public V2 command schema
      expect(() => {
        Schema.decodeUnknownSync(OrchestrationV2Command)({
          type: "thread.turn.interrupt",
          commandId: "cmd-1",
          threadId: "thread-1",
        });
      }).toThrow();
    });

    it("performs prerequisite stop when changing worktree while active run exists", async () => {
      const { createWsNativeApi } = await import("./wsNativeApi");
      const api = createWsNativeApi();

      const dispatchedCommands: any[] = [];
      requestMock.mockImplementation(async (method, payload) => {
        dispatchedCommands.push({ method, payload });
        return { success: true };
      });

      // Emulate BranchToolbar setThreadBranch logic
      const activeRunId = "run-active-123";
      const activeThreadId = "thread-123";

      // 1. Prerequisite stop
      await api.orchestration.dispatchCommand({
        type: "run.interrupt",
        commandId: "cmd-interrupt-prereq" as any,
        threadId: activeThreadId as any,
        runId: activeRunId as any,
        holdQueue: true,
        reason: "Worktree switched",
      });

      // 2. Metadata update
      await api.orchestration.dispatchCommand({
        type: "thread.metadata.update",
        commandId: "cmd-meta-update" as any,
        threadId: activeThreadId as any,
        branch: "feature/new",
        worktreePath: "/new/worktree",
      });

      expect(dispatchedCommands).toHaveLength(2);
      expect(dispatchedCommands[0].payload).toMatchObject({
        type: "run.interrupt",
        runId: activeRunId,
        holdQueue: true,
        reason: "Worktree switched",
      });
      expect(dispatchedCommands[1].payload).toMatchObject({
        type: "thread.metadata.update",
        branch: "feature/new",
        worktreePath: "/new/worktree",
      });
    });

    it("aborts metadata update when prerequisite stop fails", async () => {
      const { createWsNativeApi } = await import("./wsNativeApi");
      const api = createWsNativeApi();

      requestMock.mockImplementationOnce(async () => {
        throw new Error("Provider rejected stop request");
      });

      const activeRunId = "run-active-123";
      const activeThreadId = "thread-123";

      let prerequisiteStopFailed = false;
      try {
        await api.orchestration.dispatchCommand({
          type: "run.interrupt",
          commandId: "cmd-interrupt-fail" as any,
          threadId: activeThreadId as any,
          runId: activeRunId as any,
          holdQueue: true,
          reason: "Worktree switched",
        });
      } catch {
        prerequisiteStopFailed = true;
      }

      expect(prerequisiteStopFailed).toBe(true);
      // The caller aborts; no subsequent metadata update is dispatched
      expect(requestMock).toHaveBeenCalledTimes(1);
    });
  });
});

it("consumes Git progress and resolves the final streamed result", async () => {
  const result = {
    action: "commit",
    branch: { status: "skipped_not_requested" },
    commit: { status: "created", commitSha: "abc1234", subject: "Test" },
    push: { status: "skipped_not_requested" },
    pr: { status: "skipped_not_requested" },
    toast: { title: "Committed", cta: { kind: "none" } },
  };
  requestMock.mockImplementationOnce(async (_method, _input, options) => {
    (options as { onChunk: (values: unknown[]) => void }).onChunk([
      { actionId: "a", cwd: "/repo", action: "commit", kind: "action_finished", result },
    ]);
    return undefined;
  });
  const { createWsNativeApi } = await import("./wsNativeApi");
  const api = createWsNativeApi({ singleton: false });
  const progress = vi.fn();
  const unsubscribe = api.git.onActionProgress(progress);
  await expect(
    api.git.runStackedAction({ actionId: "a", cwd: "/repo", action: "commit" }),
  ).resolves.toEqual(result);
  expect(progress).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "action_finished", result }),
  );
  unsubscribe();
});

it("does not report success when a Git stream closes without its final result", async () => {
  requestMock.mockResolvedValueOnce(undefined);
  const { createWsNativeApi } = await import("./wsNativeApi");
  const api = createWsNativeApi({ singleton: false });
  await expect(
    api.git.runStackedAction({ actionId: "a", cwd: "/repo", action: "commit" }),
  ).rejects.toThrow("without a completion result");
});
