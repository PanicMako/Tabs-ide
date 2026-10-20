import {
  ORCHESTRATION_V2_WS_METHODS,
  WS_METHODS,
  ServerConfig,
  EnvironmentId,
  type OrchestrationReadModel,
} from "@tabs/contracts";
import { Schema } from "effect";
import { createModelCapabilities } from "@tabs/shared/model";
import { makeTestServerProvider } from "./serverProviderFixture";

export const BROWSER_ENVIRONMENT_ID = EnvironmentId.makeUnsafe("browser-test-environment");

export function browserTestProviders(checkedAt: string) {
  return ["codex", "claudeAgent"].map((instanceId) => {
    const codex = instanceId === "codex";
    return makeTestServerProvider({
      instanceId,
      checkedAt,
      models: (codex
        ? ["gpt-5", "gpt-5-codex", "gpt-5.3-codex", "gpt-5.4"]
        : ["claude-opus-4-6", "claude-sonnet-4-6"]
      ).map((slug) => ({
        slug,
        name: slug,
        isCustom: false,
        capabilities: createModelCapabilities({
          optionDescriptors: [
            {
              id: codex ? "reasoningEffort" : "effort",
              label: "Effort",
              type: "select",
              options: (codex
                ? ["low", "medium", "high", "xhigh"]
                : ["low", "medium", "high", "max"]
              ).map((id) => ({ id, label: id, isDefault: id === "high" })),
            },
            { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue: false },
          ],
        }),
      })),
    });
  });
}

export function withBrowserEnvironment(config: ServerConfig) {
  return Schema.encodeSync(ServerConfig)({
    ...config,
    environment: {
      environmentId: BROWSER_ENVIRONMENT_ID,
      label: "Browser test",
      platform: { os: "linux", arch: "x64" },
      serverVersion: "2.0.0",
      orchestrationProtocolVersion: 2,
      capabilities: { repositoryIdentity: false },
    },
    auth: {
      policy: "loopback-browser",
      bootstrapMethods: [],
      sessionMethods: [],
      sessionCookieName: "test-session",
    },
    observability: {
      logsDirectoryPath: "/tmp/browser-test-logs",
      localTracingEnabled: false,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
  });
}

function threadShell(thread: OrchestrationReadModel["threads"][number]) {
  return {
    ...thread,
    createdBy: "user",
    creationSource: "web",
    providerInstanceId: thread.modelSelection.instanceId,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: thread.id },
    forkedFrom: null,
    activeProviderThreadId: null,
    latestRunId: null,
    activeRunId: null,
    status: thread.session?.status === "running" ? "running" : "idle",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    visibleItemCount: thread.messages.length,
    pendingBackgroundTasks: [],
    providerInstanceHistory: [],
  };
}

function shellSnapshot(snapshot: OrchestrationReadModel) {
  return {
    schemaVersion: 2,
    snapshotSequence: snapshot.snapshotSequence,
    projects: snapshot.projects,
    threads: snapshot.threads.map(threadShell),
    archivedThreads: [],
  };
}

function projection(snapshot: OrchestrationReadModel, threadId: unknown) {
  const thread = snapshot.threads.find((thread) => thread.id === threadId);
  if (!thread) throw new Error(`Unknown fixture thread: ${String(threadId)}`);
  return {
    thread: threadShell(thread),
    runs: [],
    attempts: [],
    nodes: [],
    subagents: [],
    providerSessions: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    plans: thread.proposedPlans.map((plan) => ({
      ...plan,
      kind: "proposed_plan",
      markdown: plan.planMarkdown,
    })),
    turnItems: [],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: [],
    messages: thread.messages.map((message) => ({
      ...message,
      threadId: thread.id,
      runId: null,
      nodeId: null,
      createdBy: message.role === "user" ? "user" : "agent",
      creationSource: "web",
      attachments: message.attachments ?? [],
    })),
    updatedAt: thread.updatedAt,
  };
}

export interface BrowserRpcClient {
  send: (data: string) => void;
  addEventListener: (type: "message", listener: (event: { data: unknown }) => void) => void;
}

/** Real RPC envelopes around existing content fixtures, including stream subscriptions. */
export function attachBrowserRpcFixture(
  client: BrowserRpcClient,
  fixture: () => { snapshot: OrchestrationReadModel; serverConfig: ServerConfig },
  resolve: (body: { _tag: string; [key: string]: unknown }) => unknown,
  onRequest?: (body: { _tag: string; [key: string]: unknown }) => void,
) {
  let configSubscription: string | undefined;
  const threadSubscriptions = new Map<string, string>();
  const chunk = (id: string, value: unknown) =>
    client.send(JSON.stringify({ _tag: "Chunk", requestId: id, values: [value] }));
  client.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const request = JSON.parse(event.data);
    if (request._tag !== "Request") return;
    const body = { ...request.payload, _tag: request.tag };
    onRequest?.(body);
    const current = fixture();
    if (request.tag === WS_METHODS.subscribeServerConfig) {
      configSubscription = request.id;
      chunk(request.id, {
        version: 1,
        type: "snapshot",
        config: withBrowserEnvironment(current.serverConfig),
      });
      return;
    }
    if (request.tag === ORCHESTRATION_V2_WS_METHODS.subscribeShell) {
      chunk(request.id, { kind: "snapshot", snapshot: shellSnapshot(current.snapshot) });
      return;
    }
    if (request.tag === ORCHESTRATION_V2_WS_METHODS.subscribeThread) {
      threadSubscriptions.set(String(body.threadId), request.id);
      if (!current.snapshot.threads.some((thread) => thread.id === body.threadId)) return;
      chunk(request.id, {
        kind: "snapshot",
        snapshotSequence: current.snapshot.snapshotSequence,
        projection: projection(current.snapshot, body.threadId),
      });
      return;
    }
    if (request.tag.startsWith("subscribe") || request.tag.includes(".subscribe")) return;
    const value =
      request.tag === WS_METHODS.serverGetConfig
        ? withBrowserEnvironment(current.serverConfig)
        : request.tag === ORCHESTRATION_V2_WS_METHODS.getThreadProjection
          ? projection(current.snapshot, body.threadId)
          : resolve(body);
    client.send(
      JSON.stringify({ _tag: "Exit", requestId: request.id, exit: { _tag: "Success", value } }),
    );
  });
  return {
    updateThread(threadId: string) {
      const id = threadSubscriptions.get(threadId);
      if (!id) throw new Error(`Thread stream is not subscribed: ${threadId}`);
      const current = fixture().snapshot;
      chunk(id, {
        kind: "snapshot",
        snapshotSequence: current.snapshotSequence,
        projection: projection(current, threadId),
      });
    },
    keybindingsUpdated(issues: ReadonlyArray<unknown>) {
      if (!configSubscription) throw new Error("Config stream is not subscribed.");
      chunk(configSubscription, {
        version: 1,
        type: "keybindingsUpdated",
        payload: { keybindings: fixture().serverConfig.keybindings, issues },
      });
    },
  };
}
