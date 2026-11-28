import type * as CodexClient from "effect-codex-app-server/client";
import * as Effect from "effect/Effect";
import { describe, expect, it, vi } from "vitest";

import { openCodexFigmaMcp } from "./CodexFigmaMcp.ts";

const original = "model-thread";
const connector = "ephemeral-figma-thread";
const cwd = "/workspace/design";
const url = "https://mcp.figma.com/mcp";

function fixture(registration: unknown, ephemeral = true) {
  const request = vi.fn((method: string, _params: object) => {
    switch (method) {
      case "thread/read":
        return Effect.succeed({ thread: { id: original, cwd } });
      case "thread/start":
        return Effect.succeed({ thread: { id: connector, ephemeral } });
      case "thread/unsubscribe":
        return Effect.void;
      default:
        return Effect.die(new Error(`Unexpected request: ${method}`));
    }
  });
  const raw = vi.fn((method: string, _params: object) => {
    switch (method) {
      case "config/read":
        return Effect.succeed({
          config: {
            mcp_servers: { figma: registration, other: { url: "https://other.example.test/mcp" } },
          },
        });
      case "mcpServerStatus/list":
        return Effect.succeed({ data: ["inventory"] });
      case "mcpServer/tool/call":
        return Effect.succeed({ structuredContent: { email: "designer@example.test" } });
      default:
        return Effect.die(new Error(`Unexpected raw request: ${method}`));
    }
  });
  const client = { request, raw: { request: raw } } as unknown as Pick<
    CodexClient.CodexAppServerClient["Service"],
    "request" | "raw"
  >;
  return { request, raw, open: openCodexFigmaMcp(client, original) };
}

describe("Codex Figma connection", () => {
  it("uses and releases a Figma-only native thread without adding a thread-local Tabs override", async () => {
    const { request, raw, open } = fixture({ url, enabled: true });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* open;
          if (!connection) throw new Error("Expected a Figma connection");
          expect(yield* connection.list()).toEqual({ data: ["inventory"] });
          expect(yield* connection.call("whoami", {})).toEqual({
            structuredContent: { email: "designer@example.test" },
          });
          expect(request).toHaveBeenCalledTimes(2);
        }),
      ),
    );
    expect(request.mock.calls).toEqual([
      ["thread/read", { threadId: original, includeTurns: false }],
      [
        "thread/start",
        {
          cwd,
          ephemeral: true,
          config: {
            mcp_servers: {
              figma: { url },
              other: { enabled: false },
            },
          },
        },
      ],
      ["thread/unsubscribe", { threadId: connector }],
    ]);
    expect(raw.mock.calls).toEqual([
      ["config/read", { cwd, includeLayers: false }],
      [
        "mcpServerStatus/list",
        { threadId: connector, serverName: "figma", detail: "toolsAndAuthOnly" },
      ],
      [
        "mcpServer/tool/call",
        {
          threadId: connector,
          environmentId: null,
          server: "figma",
          tool: "whoami",
          arguments: {},
        },
      ],
    ]);
  });

  it.each([
    undefined,
    { url, enabled: false },
    { url: "https://mcp.figma.com/different-endpoint" },
  ])("preserves an absent, disabled or different registration (%j)", async (registration) => {
    const { request, raw, open } = fixture(registration);
    await expect(Effect.runPromise(Effect.scoped(open))).resolves.toBeUndefined();
    expect(request.mock.calls.map(([method]) => method)).toEqual(["thread/read"]);
    expect(raw.mock.calls.map(([method]) => method)).toEqual(["config/read"]);
  });

  it("releases a native thread if the provider reports that it was persisted", async () => {
    const { request, open } = fixture({ url }, false);
    await expect(Effect.runPromise(Effect.scoped(open))).resolves.toBeUndefined();
    expect(request).toHaveBeenLastCalledWith("thread/unsubscribe", { threadId: connector });
  });
});
