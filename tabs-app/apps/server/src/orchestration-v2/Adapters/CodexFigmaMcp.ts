import { ProviderDriverKind } from "@tabs/contracts";
import type * as CodexClient from "effect-codex-app-server/client";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { FigmaMcpConnection } from "../../mcp/toolkits/figmaCanvas/connection.ts";
import { ProviderAdapterProtocolError } from "../ProviderAdapter.ts";

const serverName = "figma";
const serverUrl = "https://mcp.figma.com/mcp";
const decodeConfig = Schema.decodeUnknownEffect(
  Schema.Struct({
    config: Schema.Struct({
      mcp_servers: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  }),
);

export type CodexConfigClient = {
  readonly raw: Pick<CodexClient.CodexAppServerClient["Service"]["raw"], "request">;
};

export function readCodexMcpRegistrations(client: CodexConfigClient, cwd: string | undefined) {
  return client.raw
    .request("config/read", { ...(cwd === undefined ? {} : { cwd }), includeLayers: false })
    .pipe(
      Effect.flatMap(decodeConfig),
      Effect.map(({ config }) => config.mcp_servers ?? {}),
    );
}
const isFigmaRegistration = Schema.is(
  Schema.Struct({ url: Schema.Literal(serverUrl), enabled: Schema.optionalKey(Schema.Boolean) }),
);

export const openCodexFigmaMcp = Effect.fn("openCodexFigmaMcp")(function* (
  client: Pick<CodexClient.CodexAppServerClient["Service"], "request" | "raw">,
  threadId: string,
) {
  const { thread } = yield* client.request("thread/read", { threadId, includeTurns: false });
  const registrations = yield* readCodexMcpRegistrations(client, thread.cwd);
  const registration = registrations[serverName];
  if (!isFigmaRegistration(registration) || registration.enabled === false) return undefined;

  // A separate native thread can use the saved OAuth registration without
  // exposing its tools to the model. Never start a turn on this thread.
  // Disable only saved registrations. The original thread's Tabs MCP entry
  // is thread-local, and Codex rejects a disabled entry with no transport.
  const mcpServers = Object.fromEntries(
    Object.keys(registrations).map((name) => [name, { enabled: false }] as const),
  );
  const { thread: connector } = yield* Effect.acquireRelease(
    client.request("thread/start", {
      cwd: thread.cwd,
      ephemeral: true,
      config: {
        mcp_servers: {
          ...mcpServers,
          [serverName]: { url: serverUrl },
        },
      },
    }),
    ({ thread }) =>
      thread.id === threadId
        ? Effect.void
        : client.request("thread/unsubscribe", { threadId: thread.id }).pipe(Effect.ignore),
  );
  if (!connector.ephemeral || connector.id === threadId) return undefined;

  const unavailable = () =>
    new ProviderAdapterProtocolError({
      driver: ProviderDriverKind.make("codex"),
      detail: "The configured Figma connection did not complete the request",
    });
  return {
    list: () =>
      client.raw
        .request("mcpServerStatus/list", {
          threadId: connector.id,
          serverName,
          detail: "toolsAndAuthOnly",
        })
        .pipe(Effect.mapError(unavailable)),
    call: (tool, args) =>
      client.raw
        .request("mcpServer/tool/call", {
          threadId: connector.id,
          server: serverName,
          environmentId: null,
          tool,
          arguments: args,
        })
        .pipe(Effect.mapError(unavailable)),
  } satisfies FigmaMcpConnection;
});
