import type { ThreadId } from "@tabs/contracts";
import type { McpServer } from "effect-acp/schema";

import { readMcpProviderSession } from "./McpProviderSession.ts";

/** ACP receives the same thread-scoped MCP endpoint used by Codex and Claude. */
export function tabsAcpMcpServersForThread(threadId: ThreadId): ReadonlyArray<McpServer> {
  const session = readMcpProviderSession(threadId);
  if (!session) return [];
  return [
    {
      type: "http",
      name: "Tabs",
      url: session.endpoint,
      headers: [{ name: "Authorization", value: session.authorizationHeader }],
    },
  ];
}
