import type { IncomingMessage, ServerResponse } from "node:http";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { PreviewAutomationOperation, PreviewTabId } from "@tabs/contracts";
import * as Effect from "effect/Effect";

import type { McpInvocationScope } from "./McpInvocationContext.ts";
import type { ExtensionAiBrokerClient } from "./ExtensionAiBrokerClient.ts";

type Broker = {
  readonly invoke: <A = unknown>(request: {
    readonly scope: McpInvocationScope;
    readonly operation: PreviewAutomationOperation;
    readonly input: unknown;
    readonly tabId?: PreviewTabId;
    readonly timeoutMs?: number;
  }) => Effect.Effect<A, unknown>;
};

const commonProperties = {
  tabId: { type: "string", description: "Collaborative browser tab to target." },
  timeoutMs: { type: "integer", minimum: 1, maximum: 60_000 },
};

const toolDefinitions: ReadonlyArray<{
  readonly name: string;
  readonly operation: PreviewAutomationOperation;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}> = [
  {
    name: "preview_status",
    operation: "status",
    description: "Read collaborative browser status.",
    inputSchema: {},
  },
  {
    name: "preview_open",
    operation: "open",
    description: "Open the collaborative browser.",
    inputSchema: {
      url: { type: "string" },
      show: { type: "boolean" },
      reuseExistingTab: { type: "boolean" },
    },
  },
  {
    name: "preview_navigate",
    operation: "navigate",
    description: "Navigate the collaborative browser and wait for readiness.",
    inputSchema: {
      url: { type: "string" },
      target: { type: "object" },
      readiness: { enum: ["load", "domContentLoaded", "none"] },
    },
  },
  {
    name: "preview_snapshot",
    operation: "snapshot",
    description:
      "Capture visible text, accessibility data, elements, diagnostics, and a screenshot.",
    inputSchema: {},
  },
  {
    name: "preview_click",
    operation: "click",
    description: "Click an element by locator, CSS selector, or coordinates.",
    inputSchema: {
      locator: { type: "string" },
      selector: { type: "string" },
      x: { type: "number" },
      y: { type: "number" },
    },
  },
  {
    name: "preview_type",
    operation: "type",
    description: "Type text into an element or the focused control.",
    inputSchema: {
      text: { type: "string" },
      locator: { type: "string" },
      selector: { type: "string" },
      clear: { type: "boolean" },
    },
  },
  {
    name: "preview_press",
    operation: "press",
    description: "Press a keyboard key in the active browser tab.",
    inputSchema: {
      key: { type: "string" },
      modifiers: { type: "array", items: { enum: ["Alt", "Control", "Meta", "Shift"] } },
    },
  },
  {
    name: "preview_scroll",
    operation: "scroll",
    description: "Scroll the page or a selected container.",
    inputSchema: {
      deltaX: { type: "number" },
      deltaY: { type: "number" },
      locator: { type: "string" },
      selector: { type: "string" },
    },
  },
  {
    name: "preview_evaluate",
    operation: "evaluate",
    description: "Evaluate JavaScript in the page main frame.",
    inputSchema: {
      expression: { type: "string" },
      awaitPromise: { type: "boolean" },
      returnByValue: { type: "boolean" },
    },
  },
  {
    name: "preview_wait_for",
    operation: "waitFor",
    description: "Wait for page text, URL, or an element.",
    inputSchema: {
      locator: { type: "string" },
      selector: { type: "string" },
      text: { type: "string" },
      urlIncludes: { type: "string" },
    },
  },
];

const toToolResult = (result: unknown) => {
  const screenshot =
    result && typeof result === "object" && "screenshot" in result
      ? (result as { screenshot?: { data?: unknown; mimeType?: unknown } }).screenshot
      : undefined;
  const content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  > = [{ type: "text", text: JSON.stringify(result ?? null, null, 2) }];
  if (typeof screenshot?.data === "string" && typeof screenshot.mimeType === "string") {
    content.push({ type: "image", data: screenshot.data, mimeType: screenshot.mimeType });
  }
  return {
    content,
    structuredContent:
      result && typeof result === "object" ? (result as Record<string, unknown>) : { result },
  };
};

export async function handleMcpHttpRequest(options: {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly scope: McpInvocationScope;
  readonly broker: Broker;
  readonly extensionAiBroker?: ExtensionAiBrokerClient;
  readonly resolveProjectId?: () => Promise<string | undefined>;
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
}): Promise<void> {
  const server = new Server({ name: "Tabs", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    let aiTools: Awaited<ReturnType<ExtensionAiBrokerClient["list"]>> = [];
    if (options.extensionAiBroker && options.resolveProjectId) {
      try {
        const projectId = await options.resolveProjectId();
        if (projectId) aiTools = await options.extensionAiBroker.list(projectId);
      } catch {
        // The desktop broker is optional; do not break existing preview tools.
      }
    }
    return {
      tools: [
        ...toolDefinitions.map((definition) => ({
          name: definition.name,
          description: definition.description,
          inputSchema: {
            type: "object" as const,
            properties: { ...commonProperties, ...definition.inputSchema },
            additionalProperties: false,
          },
        })),
        ...aiTools.map((tool) => ({
          name: tool.name,
          description: `${tool.description} (isolated, JSON-only Tabs extension command)`,
          inputSchema: {
            type: "object" as const,
            properties: { input: { type: "object" as const, additionalProperties: true } },
            required: ["input"],
            additionalProperties: false,
          },
        })),
      ],
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const definition = toolDefinitions.find((candidate) => candidate.name === request.params.name);
    if (!definition) {
      try {
        if (!options.extensionAiBroker || !options.resolveProjectId) {
          throw new Error("Extension AI tool is unavailable.");
        }
        const projectId = await options.resolveProjectId();
        if (!projectId) throw new Error("MCP project is no longer available.");
        const authorized = await options.extensionAiBroker.list(projectId);
        if (!authorized.some((tool) => tool.name === request.params.name)) {
          throw new Error("Extension AI tool is unavailable for this project.");
        }
        const input = request.params.arguments?.input;
        if (!input || typeof input !== "object" || Array.isArray(input)) {
          throw new Error("Extension AI tool input must be a JSON object.");
        }
        const result = await options.extensionAiBroker.invoke(
          projectId,
          request.params.name,
          input,
        );
        if ((await options.resolveProjectId()) !== projectId) {
          throw new Error("MCP project changed during extension command.");
        }
        return toToolResult(result);
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : "Extension AI tool failed.",
            },
          ],
        };
      }
    }
    const { tabId, timeoutMs, ...input } = request.params.arguments ?? {};
    try {
      const result = await options.runPromise(
        options.broker.invoke({
          scope: options.scope,
          operation: definition.operation,
          input,
          ...(typeof tabId === "string" ? { tabId: tabId as PreviewTabId } : {}),
          ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
        }),
      );
      return toToolResult(result);
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : "Preview automation failed.",
          },
        ],
      };
    }
  });
  const transport = new StreamableHTTPServerTransport({});
  options.response.once("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport as Parameters<typeof server.connect>[0]);
  await transport.handleRequest(options.request, options.response);
}
