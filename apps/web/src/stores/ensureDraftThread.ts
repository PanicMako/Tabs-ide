import type {
  ModelSelection,
  ProjectId,
  RuntimeMode,
  ProviderInteractionMode,
  ThreadId,
} from "@tabs/contracts";

export interface DraftThreadCreation {
  title?: string;
  projectId: ProjectId;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  branch: string | null;
  worktreePath: string | null;
}
interface ThreadApi {
  dispatchCommand(command: any): Promise<unknown>;
  getThreadProjection?: (input: { threadId: ThreadId }) => Promise<unknown>;
}
const creations = new WeakMap<ThreadApi, Map<string, Promise<void>>>();

/** Persist a draft before intake; concurrent queue/direct callers share its creation. */
export function ensureDraftThreadExists(
  api: ThreadApi,
  threadId: ThreadId,
  creation: DraftThreadCreation,
): Promise<void> {
  let pending = creations.get(api);
  if (!pending) {
    pending = new Map();
    creations.set(api, pending);
  }
  const existing = pending.get(threadId);
  if (existing) return existing;
  const task = (async () => {
    // This is a known local draft. Do not probe its nonexistent projection:
    // RPC read failures wrap missing-thread errors just like storage failures.
    // The stable creation command is idempotent across reconnects and retries.
    try {
      await api.dispatchCommand({
        type: "thread.create",
        commandId: `ensure-draft-${threadId}`,
        threadId,
        title: "New thread",
        createdBy: "user",
        creationSource: "web",
        ...creation,
      });
    } catch (error) {
      // A prior attempt or another caller may already have persisted the draft.
      // Only an authoritative successful read can recover an uncertain creation.
      if (!api.getThreadProjection) throw error;
      try {
        await api.getThreadProjection({ threadId });
      } catch {
        throw error;
      }
    }
  })().finally(() => pending!.delete(threadId));
  pending.set(threadId, task);
  return task;
}
