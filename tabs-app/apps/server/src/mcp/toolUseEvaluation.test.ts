import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  PreviewTabId,
  ProviderInstanceId,
  ScheduledTaskId,
  ThreadId,
} from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { McpSchema, McpServer } from "effect/unstable/ai";
import { FetchHttpClient } from "effect/unstable/http";

import * as ServerConfig from "../config.ts";
import { DeviceService } from "../device/DeviceService.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import * as McpHttpServer from "./McpHttpServer.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as PreviewAutomationBroker from "./PreviewAutomationBroker.ts";
import { OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { ProjectionStoreV2 } from "../orchestration-v2/ProjectionStore.ts";
import { ProviderAdapterRegistryV2 } from "../orchestration-v2/ProviderAdapterRegistry.ts";
import { ThreadLaunchService } from "../orchestration-v2/ThreadLaunchService.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { ThreadSearch } from "../orchestration-v2/ThreadSearch.ts";
import { PreviewManager } from "../preview/Manager.ts";
import { ManagedProjectFolders } from "../project/ManagedProjectFolders.ts";
import { ProjectService } from "../project/ProjectService.ts";
import { ProjectSetupScriptRunner } from "../project/ProjectSetupScriptRunner.ts";
import { ScheduledTaskService } from "../scheduledTasks/ScheduledTaskService.ts";
import { SecretRequests } from "../secrets/SecretRequests.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import { VcsStatusBroadcaster } from "../vcs/VcsStatusBroadcaster.ts";
import { ProviderRegistry } from "../provider/ProviderRegistry.ts";
import { McpSessionRegistry } from "./McpSessionRegistry.ts";
import { advertisedJsonSchema } from "./advertisedJsonSchema.ts";

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "evaluation-runner", version: "1.0.0" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "evaluation-runner", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

const threadId = ThreadId.make("thread-eval-test");
const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("env-eval"),
  requestNamespace: "eval-ns",
  thread: {
    threadId,
    providerSessionId: "session-eval",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["orchestration", "preview"]),
  issuedAt: 1,
};

const declaredFailure = (result: McpSchema.CallToolResult) => {
  const text = result.content[0];
  return result.isError === true && text?.type === "text" ? JSON.parse(text.text) : undefined;
};

const services = (onUpsert?: (input: any) => void) =>
  Layer.mergeAll(
    Layer.mock(ThreadManagementService)({
      getThreadShell: () =>
        Effect.succeed({ id: threadId, projectId: "p-1", deletedAt: null } as any),
      getProjectThreadRecords: () =>
        Effect.succeed({
          thread: {
            id: threadId,
            projectId: "p-1",
            runtimeMode: "auto",
            interactionMode: "default",
            deletedAt: null,
          },
        } as any),
      getThreadRecords: () =>
        Effect.succeed({
          thread: {
            id: threadId,
            projectId: "p-1",
            runtimeMode: "auto",
            interactionMode: "default",
            deletedAt: null,
            modelSelection: null,
          },
          activities: [],
          turns: [],
        } as any),
    }),
    Layer.mock(ProviderRegistry)({}),
    Layer.mock(ProviderAdapterRegistryV2)({}),
    Layer.mock(ScheduledTaskService)({
      list: () =>
        Effect.succeed({
          tasks: [
            {
              id: "task-auto",
              title: "task",
              prompt: "run nightly",
              enabled: true,
              schedule: { type: "interval", everyMs: 3600000 },
              workspaceStrategy: { type: "worktree", baseRef: "main", startFromOrigin: true },
              modelSelection: { instanceId: "codex", model: "gpt-5" },
              runtimeMode: "auto",
              interactionMode: "default",
              projectId: "p-1",
              threadId: null,
              createdBy: "agent",
              creationSource: "mcp",
              nextRunAt: null,
              lastRunStatus: "never",
            },
          ],
        } as any),
      upsert: (i) => {
        onUpsert?.(i);
        return Effect.succeed({
          task: {
            id: i.id ?? "task-auto",
            title: i.title ?? "task",
            prompt: i.prompt ?? "run nightly",
            enabled: i.enabled ?? true,
            schedule: i.schedule ?? { type: "interval", everyMs: 3600000 },
            workspaceStrategy: { type: "worktree", baseRef: "main", startFromOrigin: true },
            modelSelection: { instanceId: "codex", model: "gpt-5" },
            runtimeMode: "auto",
            interactionMode: "default",
            projectId: "p-1",
            threadId: null,
            createdBy: "agent",
            creationSource: "mcp",
            nextRunAt: null,
            lastRunStatus: "never",
          },
        } as any);
      },
    }),
    Layer.mock(ProjectService)({
      getById: () =>
        Effect.succeed(
          Option.some({
            id: "p-1",
            defaultModel: null,
            defaultModelSelection: { instanceId: "codex", model: "gpt-5" },
          } as any),
        ),
    }),
    Layer.mock(SecretRequests)({}),
    Layer.mock(OrchestratorV2)({}),
    Layer.mock(ProjectionStoreV2)({}),
    Layer.mock(DeviceService)({}),
    Layer.mock(ServerSettingsService)({}),
    Layer.mock(ServerEnvironment)({}),
    Layer.mock(ServerSecretStore)({}),
    Layer.mock(GitWorkflowService)({}),
    Layer.mock(GitVcsDriver)({}),
    Layer.mock(VcsStatusBroadcaster)({}),
    Layer.mock(ThreadLaunchService)({}),
    Layer.mock(ThreadSearch)({}),
    Layer.mock(ManagedProjectFolders)({ namedProjectsRoot: "" }),
    Layer.mock(McpSessionRegistry)({}),
    Layer.mock(ProjectSetupScriptRunner)({}),
    Layer.mock(PreviewManager)({}),
    PreviewAutomationBroker.layer,
    FetchHttpClient.layer,
    ServerConfig.layerTest(process.cwd(), { prefix: "test-eval-" }),
  ).pipe(Layer.provideMerge(NodeServices.layer.pipe(Layer.provideMerge(NodeCrypto.layer))));

it.effect(
  "legacy tool aliases resolve and execute against consolidated tools",
  () =>
    Effect.gen(function* () {
      let capturedUpsert: any = null;
      const server = yield* McpServer.McpServer;
      const call = (name: string, args: Record<string, unknown>) =>
        server
          .callTool({ name, arguments: args })
          .pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
            Effect.provideService(McpSchema.McpServerClient, client),
          );

      // Legacy update_scheduled_task -> schedule_task
      const updateResult = yield* call("update_scheduled_task", {
        scheduledTaskId: "task-auto",
        enabled: false,
      });
      expect(updateResult.isError).toBe(false);

      // Verify alias translation executed the consolidated update
      const legacyAliases = McpHttpServer.LEGACY_TOOL_ALIASES;
      expect(legacyAliases.preview_click!({ elementId: 42 })).toEqual({
        name: "preview_act",
        arguments: { action: "click", elementId: 42 },
      });
      expect(legacyAliases.preview_type!({ elementId: 10, text: "hello" })).toEqual({
        name: "preview_act",
        arguments: { action: "type", elementId: 10, text: "hello" },
      });
      expect(legacyAliases.t3_queue_list!({ threadId: "t-1" })).toEqual({
        name: "t3_queue",
        arguments: { action: "list", threadId: "t-1" },
      });
      expect(legacyAliases.t3_pending_request_list!({ threadId: "t-1" })).toEqual({
        name: "t3_pending_request",
        arguments: { action: "list", threadId: "t-1" },
      });
      expect(legacyAliases.t3_thread_fork!({ sourceThreadId: "t-1" })).toEqual({
        name: "t3_thread_transfer",
        arguments: { action: "fork", sourceThreadId: "t-1" },
      });
      expect(legacyAliases.t3_thread_configuration!({ threadId: "t-1" })).toEqual({
        name: "t3_thread_configure",
        arguments: { threadId: "t-1" },
      });
    }).pipe(
      Effect.provide(
        McpHttpServer.layerTools.pipe(
          Layer.provideMerge(McpHttpServer.layerMcpServer),
          Layer.provide(services()),
        ),
      ),
    ) as any,
);

it.effect(
  "invalid tool arguments are rejected with structured recoverable failures",
  () =>
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const call = (name: string, args: Record<string, unknown>) =>
        server
          .callTool({ name, arguments: args })
          .pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
            Effect.provideService(McpSchema.McpServerClient, client),
          );

      // schedule_task without prompt & schedule returns declared invalid_request failure
      const invalidSchedule = yield* call("schedule_task", { prompt: "run task" });
      expect(invalidSchedule.isError).toBe(true);
      expect(declaredFailure(invalidSchedule)).toMatchObject({ code: "invalid_request" });

      // schedule_task with valid schedule succeeds (recovery)
      const validSchedule = yield* call("schedule_task", {
        prompt: "run task",
        schedule: { type: "interval", everyMs: 3600000 },
      });
      expect(validSchedule.isError).toBe(false);
    }).pipe(
      Effect.provide(
        McpHttpServer.layerTools.pipe(
          Layer.provideMerge(McpHttpServer.layerMcpServer),
          Layer.provide(services()),
        ),
      ),
    ) as any,
);

it.effect(
  "all advertised tools use compact root object schemas without reference leaks",
  () =>
    Effect.gen(function* () {
      const mcp = yield* McpServer.McpServer;
      for (const { tool } of mcp.tools) {
        const schema = tool.inputSchema as any;
        expect(schema.type).toBe("object");
        // Compact schemas do not advertise internal $defs
        expect(schema.$defs).toBeUndefined();
        expect(schema.$ref).toBeUndefined();
        // Description is populated
        expect(tool.description).toBeTruthy();
      }

      // Context token estimate accounting vs byte count
      const totalBytes = mcp.tools.reduce(
        (sum, { tool }) => sum + Buffer.byteLength(JSON.stringify(tool.inputSchema), "utf8"),
        0,
      );
      // Rough token heuristic (3-4 bytes per token for JSON schema keys and structures)
      const estimatedTokens = Math.round(totalBytes / 3.5);
      expect(totalBytes).toBeGreaterThan(10000);
      expect(estimatedTokens).toBeGreaterThan(2500);
    }).pipe(
      Effect.provide(
        McpHttpServer.layerTools.pipe(
          Layer.provideMerge(McpHttpServer.layerMcpServer),
          Layer.provide(services()),
        ),
      ),
    ) as any,
);
