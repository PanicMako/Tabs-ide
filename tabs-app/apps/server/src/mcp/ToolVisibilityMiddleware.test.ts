import { expect, it } from "vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ServerSettingsService } from "../serverSettings.ts";
import { TeammateService } from "../teammates/TeammateService.ts";
import { makeMcpAuthMiddleware } from "./McpHttpServer.ts";
import { McpSessionRegistry } from "./McpSessionRegistry.ts";
import { hideTools } from "./toolVisibility.ts";

const NAMES = ["native", "computer_click", "teammate", "teammate_look"];

const listAs = async (input: {
  readonly threadId: string;
  readonly settings: { computerUseEnabled: boolean; teammatesEnabled: boolean };
  readonly teammateThreads: ReadonlyArray<string>;
}) => {
  const services = Context.empty().pipe(
    Context.add(McpSessionRegistry, {
      resolve: () => Effect.succeed({ thread: { threadId: input.threadId } }),
    } as any),
    Context.add(ServerSettingsService, { getSettings: Effect.succeed(input.settings) } as any),
    Context.add(TeammateService, {
      isTeammateThread: (threadId: string) =>
        Effect.succeed(input.teammateThreads.includes(threadId)),
    } as any),
  );
  const middleware = await Effect.runPromise(
    makeMcpAuthMiddleware.pipe(Effect.provideContext(services)),
  );
  const request = HttpServerRequest.fromWeb(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
  );
  const response = await Effect.runPromise(
    middleware(
      Effect.succeed(
        HttpServerResponse.jsonUnsafe({
          jsonrpc: "2.0",
          id: 1,
          result: { tools: NAMES.map((name) => ({ name })) },
        }),
      ),
    ).pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, request)),
  );
  const body = (await HttpServerResponse.toWeb(response).json()) as {
    result: { tools: Array<{ name: string }> };
  };
  return body.result.tools.map((tool) => tool.name);
};

it("advertises teammate tools only in teammate chats, and computer tools only when enabled", async () => {
  const on = { computerUseEnabled: true, teammatesEnabled: true };
  expect(await listAs({ threadId: "plain", settings: on, teammateThreads: ["home"] })).toEqual([
    "native",
    "computer_click",
  ]);
  expect(await listAs({ threadId: "home", settings: on, teammateThreads: ["home"] })).toEqual(
    NAMES,
  );
  expect(
    await listAs({
      threadId: "home",
      settings: { computerUseEnabled: false, teammatesEnabled: true },
      teammateThreads: ["home"],
    }),
  ).toEqual(["native", "teammate", "teammate_look"]);
  // The Labs switch off hides the tools even in a teammate's own chat.
  expect(
    await listAs({
      threadId: "home",
      settings: { computerUseEnabled: true, teammatesEnabled: false },
      teammateThreads: ["home"],
    }),
  ).toEqual(["native", "computer_click"]);
});

it("hideTools handles event streams and unparseable bodies", () => {
  const sse = `event: message\ndata: ${JSON.stringify({ result: { tools: [{ name: "a" }, { name: "b" }] } })}\n\n`;
  expect(hideTools(sse, "text/event-stream", (name) => name === "a")).not.toContain('"a"');
  expect(hideTools("nope", "application/json", () => true)).toBe("nope");
});
