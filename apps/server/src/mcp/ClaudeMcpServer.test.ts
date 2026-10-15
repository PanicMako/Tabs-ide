import { describe, expect, it } from "vitest";

import { tabsClaudeMcpServer } from "./ClaudeMcpServer.ts";
import type { McpProviderSessionConfig } from "./McpProviderSession.ts";

describe("tabsClaudeMcpServer", () => {
  it("passes only the current thread's authenticated MCP endpoint to Claude", () => {
    const session = {
      threadId: "thread-a",
      endpoint: "http://127.0.0.1:40701/mcp",
      authorizationHeader: "Bearer thread-secret",
    } as McpProviderSessionConfig;
    expect(tabsClaudeMcpServer(session)).toEqual({
      type: "http",
      url: "http://127.0.0.1:40701/mcp",
      headers: { Authorization: "Bearer thread-secret" },
    });
  });
});
