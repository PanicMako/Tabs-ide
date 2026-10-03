import { EnvironmentId, ProjectId, ThreadId } from "@tabs/contracts";
import { useEffect, useSyncExternalStore } from "react";

export const AGENT_THREAD_DRAG_MIME = "application/x-tabs-agent-thread";
export const PINNED_THREAD_DRAG_MIME = "application/x-tabs-pinned-thread";

export interface AgentThreadDragPayload {
  readonly type: "tabs:agent-thread";
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
}

let activeDragPayload: AgentThreadDragPayload | null = null;
const dragListeners = new Set<(payload: AgentThreadDragPayload | null) => void>();

export function getActiveAgentDrag(): AgentThreadDragPayload | null {
  return activeDragPayload;
}

export function setActiveAgentDrag(payload: AgentThreadDragPayload | null): void {
  activeDragPayload = payload;
  for (const listener of dragListeners) {
    listener(payload);
  }
}

export function clearActiveAgentDrag(): void {
  setActiveAgentDrag(null);
}

export function subscribeActiveAgentDrag(
  listener: (payload: AgentThreadDragPayload | null) => void,
): () => void {
  dragListeners.add(listener);
  return () => {
    dragListeners.delete(listener);
  };
}

export function useActiveAgentDrag(): AgentThreadDragPayload | null {
  return useSyncExternalStore(subscribeActiveAgentDrag, getActiveAgentDrag, () => null);
}

export function useAgentDragSafetyCleanup(): void {
  useEffect(() => {
    const clearDrag = () => clearActiveAgentDrag();
    const clearDragOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearDrag();
    };
    window.addEventListener("dragend", clearDrag);
    window.addEventListener("drop", clearDrag);
    window.addEventListener("keydown", clearDragOnEscape);
    return () => {
      window.removeEventListener("dragend", clearDrag);
      window.removeEventListener("drop", clearDrag);
      window.removeEventListener("keydown", clearDragOnEscape);
      clearDrag();
    };
  }, []);
}

export function serializeAgentThreadDrag(payload: AgentThreadDragPayload): string {
  return JSON.stringify(payload);
}

export function parseAgentThreadDrag(raw: unknown): AgentThreadDragPayload | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const data = JSON.parse(raw);
    if (
      data &&
      typeof data === "object" &&
      data.type === "tabs:agent-thread" &&
      typeof data.environmentId === "string" &&
      typeof data.projectId === "string" &&
      typeof data.threadId === "string"
    ) {
      return {
        type: "tabs:agent-thread",
        environmentId: EnvironmentId.makeUnsafe(data.environmentId),
        projectId: ProjectId.makeUnsafe(data.projectId),
        threadId: ThreadId.makeUnsafe(data.threadId),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function isAgentThreadDragEvent(event: { dataTransfer?: DataTransfer | null }): boolean {
  if (!event.dataTransfer) return false;
  // Make sure to ignore file or image drops
  if (event.dataTransfer.types.includes("Files")) {
    return false;
  }
  return event.dataTransfer.types.includes(AGENT_THREAD_DRAG_MIME);
}

export function validateAgentDragPayload(
  payload: AgentThreadDragPayload | null,
  environmentId: string | null | undefined,
  projectId: string | null | undefined,
): AgentThreadDragPayload | null {
  if (!payload || !environmentId || !projectId) return null;
  if (payload.environmentId !== environmentId || payload.projectId !== projectId) return null;
  return payload;
}
