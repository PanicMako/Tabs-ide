import { BrowserWorkflowStage, type BrowserWorkflowResultRef } from "@tabs/contracts";

export function browserWorkflowResultSupersedes(
  next: BrowserWorkflowResultRef,
  previous: BrowserWorkflowResultRef,
): boolean {
  const stages = BrowserWorkflowStage.literals;
  return (
    next.workflowId === previous.workflowId &&
    (stages.indexOf(next.stage) > stages.indexOf(previous.stage) ||
      (next.stage === "uploaded" &&
        next.pendingAction === "submit" &&
        previous.stage === "uploaded" &&
        previous.submitRequiresUser === true))
  );
}

export interface TimelineDurationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  completedAt?: string | undefined;
}

export function computeMessageDurationStart(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Map<string, string> {
  const result = new Map<string, string>();
  let lastBoundary: string | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      lastBoundary = message.createdAt;
    }
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === "assistant" && message.completedAt) {
      lastBoundary = message.completedAt;
    }
  }

  return result;
}

export function normalizeCompactToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}
