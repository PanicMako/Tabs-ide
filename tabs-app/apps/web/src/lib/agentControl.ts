/**
 * Conversation-wide agent control: one event bus so a keyboard shortcut, the
 * Electron global shortcut and Quick Actions all reach the same handlers.
 */
export const AGENT_CONTROL_EVENT = "tabs:agent-control";

/** Detail: { environmentId, threadId }. Handled by the workspace shell. */
export const OPEN_THREAD_EVENT = "tabs:open-thread";

export type AgentControlRequest = "takeOver" | "stopAll";

export type AgentControlCommand = "agent.takeOver" | "agent.stopAll";

export function agentControlRequestForCommand(
  command: string | null | undefined,
): AgentControlRequest | null {
  if (command === "agent.takeOver") return "takeOver";
  if (command === "agent.stopAll") return "stopAll";
  return null;
}

export function dispatchAgentControl(request: AgentControlRequest) {
  window.dispatchEvent(
    new CustomEvent<AgentControlRequest>(AGENT_CONTROL_EVENT, { detail: request }),
  );
}
