import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { FigmaCanvasWrite, FigmaNodeId } from "@tabs/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { FigmaMcpConnection, FigmaMcpToolName } from "./connection.ts";
import type { FigmaFrameScriptInput } from "./frameScript.ts";

const figmaOrigin = "https://mcp.figma.com";
const validEmail = Schema.is(FigmaCanvasWrite.fields.email);
const validNode = Schema.is(FigmaNodeId);

export class FigmaConnectorError extends Error {}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resultValue(value: unknown): Record<string, unknown> {
  const reply = record(value);
  if (!reply || reply.isError === true)
    throw new FigmaConnectorError("Figma did not confirm the request.");
  const structured = record(reply.structuredContent);
  if (structured) return record(structured.result) ?? structured;
  const content = Array.isArray(reply.content) ? reply.content : [];
  const blocks = content.map(record).filter((block) => block?.type === "text");
  if (blocks.length !== 1 || typeof blocks[0]?.text !== "string" || blocks[0].text.length > 64_000)
    throw new FigmaConnectorError("Figma returned an unsupported result.");
  try {
    const json = record(JSON.parse(blocks[0].text));
    if (json) return record(json.result) ?? json;
  } catch {
    // Connector output can contain account or design information. Keep it out of errors.
  }
  throw new FigmaConnectorError("Figma returned an unsupported result.");
}

async function listTools(connection: FigmaMcpConnection, signal: AbortSignal) {
  const inventory = record(await Effect.runPromise(connection.list(), { signal }));
  const servers = inventory?.data;
  const server = Array.isArray(servers) && servers.length === 1 ? record(servers[0]) : null;
  if (
    !server ||
    server.name !== "figma" ||
    server.httpOrigin !== figmaOrigin ||
    server.authStatus !== "oAuth" ||
    server.environmentId != null ||
    (server.runtimeStatus != null && server.runtimeStatus !== "connected") ||
    inventory?.nextCursor != null
  )
    throw new FigmaConnectorError(
      "Connect the official remote Figma server named figma in this Codex profile.",
    );
  const tools = record(server.tools);
  if (!tools?.whoami || !tools.use_figma)
    throw new FigmaConnectorError("The connected Figma account does not expose canvas tools.");
  return tools;
}

function inputSchema(tools: Record<string, unknown>, name: FigmaMcpToolName) {
  const schema = record(record(tools[name])?.inputSchema);
  if (!schema) throw new FigmaConnectorError("The Figma connection changed its tool schema.");
  return schema;
}

export function makeFigmaMcp(connection: FigmaMcpConnection, signal: AbortSignal) {
  const validator = new AjvJsonSchemaValidator();
  async function invoke(
    tools: Record<string, unknown>,
    name: FigmaMcpToolName,
    args: Readonly<Record<string, string>>,
    beforeDispatch?: () => Promise<void>,
  ) {
    const schema = inputSchema(tools, name);
    let valid = false;
    try {
      valid = validator.getValidator(schema)(args).valid;
    } catch {
      // Reject schemas that the installed client cannot validate.
    }
    if (!valid) throw new FigmaConnectorError("The Figma connection changed its tool arguments.");
    await beforeDispatch?.();
    return resultValue(await Effect.runPromise(connection.call(name, args), { signal }));
  }

  async function identity(tools: Record<string, unknown>) {
    const value = await invoke(tools, "whoami", {});
    if (!validEmail(value.email))
      throw new FigmaConnectorError("Figma did not confirm its signed-in account.");
    return value.email;
  }

  return {
    async whoami() {
      return identity(await listTools(connection, signal));
    },
    async open(fileKey: string, expectedEmail: string) {
      const tools = await listTools(connection, signal);
      if ((await identity(tools)) !== expectedEmail)
        throw new FigmaConnectorError(
          "The signed-in Figma account changed. Review the original connection.",
        );
      const properties = record(inputSchema(tools, "use_figma").properties);
      const codeFields = ["code", "javascript", "script"].filter(
        (key) => record(properties?.[key])?.type === "string",
      );
      if (codeFields.length !== 1 || !properties?.fileKey || !properties.skillNames)
        throw new FigmaConnectorError(
          "The Figma connection does not expose a supported canvas schema.",
        );
      const codeField = codeFields[0]!;
      const base: Record<string, string> = { fileKey };
      if (properties.editorType) base.editorType = "figma";
      if (properties.sessionId && tools.create_session) {
        const session = await invoke(tools, "create_session", {
          fileKey,
          description: "Create and verify one approved editable frame",
        });
        if (
          typeof session.sessionId !== "string" ||
          !session.sessionId ||
          session.sessionId.length > 256
        )
          throw new FigmaConnectorError("Figma did not confirm a session for the approved design.");
        base.sessionId = session.sessionId;
      }
      return async (
        script: string,
        writes: boolean,
        parentNodeId: FigmaFrameScriptInput["parentNodeId"],
        beforeDispatch?: () => Promise<void>,
      ) => {
        const current = await listTools(connection, signal);
        if ((await identity(current)) !== expectedEmail)
          throw new FigmaConnectorError(
            "The signed-in Figma account changed. Review the original connection.",
          );
        const result = await invoke(
          current,
          "use_figma",
          {
            ...base,
            [codeField]: script,
            skillNames: writes ? "figma-use,figma-generate-design" : "figma-use",
          },
          beforeDispatch,
        );
        if (result.parentNodeId !== parentNodeId)
          throw new FigmaConnectorError("Figma did not confirm the approved parent node.");
        if (!writes && result.status === "absent") return null;
        if (
          (result.status !== "existing" && !(writes && result.status === "created")) ||
          !validNode(result.frameNodeId) ||
          !validNode(result.textNodeId) ||
          result.frameNodeId === result.textNodeId ||
          result.frameNodeId === parentNodeId ||
          result.textNodeId === parentNodeId
        )
          throw new FigmaConnectorError("Figma did not verify the editable frame and text.");
        return { frameNodeId: result.frameNodeId, textNodeId: result.textNodeId };
      };
    },
  };
}
