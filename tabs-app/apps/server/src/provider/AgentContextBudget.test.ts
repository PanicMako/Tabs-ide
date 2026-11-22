import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpServer } from "effect/unstable/ai";
import { FetchHttpClient } from "effect/unstable/http";

import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import { ServerConfig } from "../config.ts";
import { DeviceService } from "../device/DeviceService.ts";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import * as PreviewAutomationBroker from "../mcp/PreviewAutomationBroker.ts";
import {
  CLAUDE_PROVIDER,
  makeClaudeQueryOptions,
} from "../orchestration-v2/Adapters/ClaudeAdapterV2.ts";
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
import { TeammateService } from "../teammates/TeammateService.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { GitVcsDriver } from "../vcs/GitVcsDriver.ts";
import { VcsStatusBroadcaster } from "../vcs/VcsStatusBroadcaster.ts";
import { buildCodexAdditionalContext } from "./CodexDeveloperInstructions.ts";
import { ProviderRegistry } from "./ProviderRegistry.ts";
import { McpSessionRegistry } from "../mcp/McpSessionRegistry.ts";
import { isComputerTool } from "../mcp/toolkits/computer/visibility.ts";
import { TEAMMATE_TOOL_NAMES } from "../mcp/toolkits/teammate/tools.ts";
import budget from "./agentContextBudget.json" with { type: "json" };

const toolHandlerServices = Layer.mergeAll(
  Layer.mock(DeviceService)({}),
  Layer.mock(GitVcsDriver)({}),
  Layer.mock(GitWorkflowService)({}),
  Layer.mock(ManagedProjectFolders)({ namedProjectsRoot: "" }),
  Layer.mock(McpSessionRegistry)({}),
  Layer.mock(OrchestratorV2)({}),
  Layer.mock(PreviewAutomationBroker.PreviewAutomationBroker)({}),
  Layer.mock(PreviewManager)({}),
  Layer.mock(ProjectService)({}),
  Layer.mock(ProjectSetupScriptRunner)({}),
  Layer.mock(ProjectionStoreV2)({}),
  Layer.mock(ProviderAdapterRegistryV2)({}),
  Layer.mock(ProviderRegistry)({}),
  Layer.mock(ScheduledTaskService)({}),
  Layer.mock(SecretRequests)({}),
  Layer.mock(TeammateService)({}),
  ServerConfig.layerTest(process.cwd(), { prefix: "tabs-agent-context-budget-" }),
  Layer.mock(ServerEnvironment)({}),
  Layer.mock(ServerSecretStore)({}),
  Layer.mock(ServerSettingsService)({}),
  Layer.mock(ThreadLaunchService)({}),
  Layer.mock(ThreadManagementService)({}),
  Layer.mock(ThreadSearch)({}),
  Layer.mock(VcsStatusBroadcaster)({}),
  PreviewAutomationBroker.layer,
  FetchHttpClient.layer,
).pipe(Layer.provideMerge(NodeServices.layer.pipe(Layer.provideMerge(NodeCrypto.layer))));

const utf8Bytes = (text: string) => Buffer.byteLength(text, "utf8");

const claudeSystemAppend = () => {
  const { systemPrompt } = makeClaudeQueryOptions({
    modelSelection: {
      instanceId: ProviderInstanceId.make(CLAUDE_PROVIDER),
      model: "claude-opus-5-5",
    },
    nativeThreadId: "context-budget",
    resume: false,
    cwd: null,
    mcpServers: { "t3-code": { type: "http", url: "http://127.0.0.1/mcp" } },
  });
  return typeof systemPrompt === "object" && "append" in systemPrompt ? systemPrompt.append : "";
};

const codexAdditionalContext = () =>
  Object.values(
    buildCodexAdditionalContext(
      { model: "gpt-6.1-sol", modelName: "GPT-6.1 Sol", reasoningEffort: "high" },
      { browser: true, device: true },
    ),
  )
    .map((entry) => entry.value)
    .join("");

it.effect(
  "agent context matches the committed budget",
  () =>
    Effect.gen(function* () {
      const mcp = yield* McpServer.McpServer;
      // What a default agent is shown: computer-use is off and it is not in a teammate chat, so
      // those tools are hidden from tools/list (see toolVisibility.ts).
      const advertised = mcp.tools.filter(
        ({ tool }) => !isComputerTool(tool.name) && !TEAMMATE_TOOL_NAMES.has(tool.name),
      );
      const measured = {
        claudeSystemAppendBytes: utf8Bytes(claudeSystemAppend()),
        codexAdditionalContextBytes: utf8Bytes(codexAdditionalContext()),
        // Provider input descriptors are retained as a separate measurement so
        // compatibility metadata cannot hide growth in the actual registry.
        mcpFullRegistryJsonBytes: utf8Bytes(JSON.stringify(advertised.map(({ tool }) => tool))),
        mcpToolListJsonBytes: utf8Bytes(
          JSON.stringify(
            advertised.map(({ tool }) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          ),
        ),
      };

      expect(measured).toEqual(budget);
    }).pipe(
      Effect.provide(
        McpHttpServer.layerTools.pipe(
          Layer.provideMerge(McpServer.McpServer.layer),
          Layer.provide(toolHandlerServices),
        ),
      ),
    ) as any,
);
