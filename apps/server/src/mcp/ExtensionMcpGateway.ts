import type { ExtensionAiBrokerClient } from "./ExtensionAiBrokerClient.ts";

export interface ExtensionMcpGateway {
  readonly broker: ExtensionAiBrokerClient;
  readonly resolveProjectId: () => Promise<string | undefined>;
}

export async function extensionMcpTools(gateway: ExtensionMcpGateway) {
  const projectId = await gateway.resolveProjectId();
  if (!projectId) return [];
  const tools = await gateway.broker.list(projectId);
  if ((await gateway.resolveProjectId()) !== projectId) return [];
  return tools.map((tool) => ({
    name: tool.name,
    description: `${tool.description} (isolated, JSON-only Tabs extension command)`,
    inputSchema: {
      type: "object",
      properties: { input: { type: "object", additionalProperties: true } },
      required: ["input"],
      additionalProperties: false,
    },
  }));
}

export async function invokeExtensionMcpTool(
  gateway: ExtensionMcpGateway,
  name: string,
  args: unknown,
) {
  const projectId = await gateway.resolveProjectId();
  if (!projectId) throw new Error("MCP project is no longer available.");
  const tools = await gateway.broker.list(projectId);
  if (!tools.some((tool) => tool.name === name))
    throw new Error("Extension AI tool is unavailable for this project.");
  const input =
    typeof args === "object" && args !== null ? (args as { input?: unknown }).input : undefined;
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Extension AI tool input must be a JSON object.");
  if ((await gateway.resolveProjectId()) !== projectId)
    throw new Error("MCP project changed before extension command.");
  const result = await gateway.broker.invoke(projectId, name, input);
  if ((await gateway.resolveProjectId()) !== projectId)
    throw new Error("MCP project changed during extension command.");
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

export function appendExtensionTools(
  body: string,
  contentType: string,
  tools: ReadonlyArray<unknown>,
): string {
  const append = (text: string) => {
    const payload = JSON.parse(text);
    if (payload.result && Array.isArray(payload.result.tools)) payload.result.tools.push(...tools);
    return JSON.stringify(payload);
  };
  return contentType.includes("text/event-stream")
    ? body
        .split("\n")
        .map((line) => (line.startsWith("data:") ? `data: ${append(line.slice(5).trim())}` : line))
        .join("\n")
    : append(body);
}
