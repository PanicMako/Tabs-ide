/**
 * One vocabulary for handing a target (browser tab, device, desktop window,
 * terminal) between the user and an agent. Every handoff surface uses these
 * labels so the same action reads the same way everywhere.
 */
export const AGENT_HANDOFF_LABELS = {
  /** The user takes control; agent input stops and queued input is dropped. */
  takeOver: "My turn",
  /** The user hands control back to the agent in the same conversation. */
  returnToAgent: "Return to agent",
  /** Ends agent access to the target and revokes its grants. */
  stopAgent: "Stop agent",
  /** Lets an agent use a target it does not currently control. */
  allowAgent: "Allow agent control",
  /** Re-sends a continuation the conversation may not have received. */
  retryContinuation: "Tell the agent again",
} as const;

export const AGENT_HANDOFF_DESCRIPTIONS = {
  takeOver: "Stop agent input now, including anything queued, and let you act.",
  returnToAgent: "Give control back so the agent continues the same task.",
  stopAgent: "End agent access to this target. The agent needs fresh approval to use it again.",
  retryContinuation:
    "Your action was saved, but Tabs could not confirm the agent heard about it. Send it again.",
} as const;

export type AgentHandoffAction = keyof typeof AGENT_HANDOFF_LABELS;
