import type { ThreadId } from "@tabs/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  clearAllMcpProviderSessions,
  setMcpProviderSession,
  type McpProviderSessionConfig,
} from "./McpProviderSession.ts";
import { tabsAcpMcpServersForThread } from "./AcpMcpServer.ts";

afterEach(clearAllMcpProviderSessions);

describe("tabsAcpMcpServersForThread", () => {
  it("uses only the requested thread's authenticated HTTP MCP endpoint", () => {
    const first = {
      threadId: "first" as ThreadId,
      endpoint: "http://127.0.0.1:40701/mcp",
      authorizationHeader: "Bearer first-secret",
    } as McpProviderSessionConfig;
    setMcpProviderSession(first);
    setMcpProviderSession({
      ...first,
      threadId: "second" as ThreadId,
      authorizationHeader: "Bearer second-secret",
    });
    expect(tabsAcpMcpServersForThread(first.threadId)).toEqual([
      {
        type: "http",
        name: "Tabs",
        url: first.endpoint,
        headers: [{ name: "Authorization", value: first.authorizationHeader }],
      },
    ]);
    expect(tabsAcpMcpServersForThread("missing" as ThreadId)).toEqual([]);
  });
});
