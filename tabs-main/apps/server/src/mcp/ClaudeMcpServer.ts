import type { McpHttpServerConfig } from "@anthropic-ai/claude-agent-sdk";

import type { McpProviderSessionConfig } from "./McpProviderSession.ts";

/** Use the same thread-scoped bearer credential as Codex, never a global key. */
export function tabsClaudeMcpServer(session: McpProviderSessionConfig): McpHttpServerConfig {
  return {
    type: "http",
    url: session.endpoint,
    headers: { Authorization: session.authorizationHeader },
  };
}
