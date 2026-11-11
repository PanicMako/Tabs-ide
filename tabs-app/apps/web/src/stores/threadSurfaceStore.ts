import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createMemoryStorage } from "~/lib/storage";

/**
 * How a thread's conversation area is shown: the Chat UI (Tabs' timeline and
 * composer) or the agent's own CLI in a terminal. Chosen per thread, like an
 * Orca session's surface, so split panes can mix them.
 */
export type ThreadSurface = "chat" | "cli";

interface ThreadSurfaceState {
  readonly surfaceByThread: Record<string, ThreadSurface>;
  /** Last surface the user picked; new threads open in it. */
  readonly preferredSurface: ThreadSurface;
  setSurface: (threadKey: string, surface: ThreadSurface) => void;
}

export function threadSurfaceKey(environmentId: string | null | undefined, threadId: string) {
  return `${environmentId ?? "local"}:${threadId}`;
}

/**
 * A thread keeps the surface it was last shown in. One never switched opens in
 * the user's preferred surface while it is new, and in Chat once it has a
 * conversation to show.
 */
export function resolveThreadSurface(
  state: Pick<ThreadSurfaceState, "surfaceByThread" | "preferredSurface">,
  threadKey: string,
  hasConversation: boolean,
): ThreadSurface {
  return state.surfaceByThread[threadKey] ?? (hasConversation ? "chat" : state.preferredSurface);
}

export const useThreadSurfaceStore = create<ThreadSurfaceState>()(
  persist(
    (set) => ({
      surfaceByThread: {},
      preferredSurface: "chat",
      setSurface: (threadKey, surface) =>
        set((state) => ({
          preferredSurface: surface,
          surfaceByThread: { ...state.surfaceByThread, [threadKey]: surface },
        })),
    }),
    {
      name: "tabs:thread-surface:v1",
      storage: createJSONStorage(() =>
        typeof localStorage !== "undefined" ? localStorage : createMemoryStorage(),
      ),
    },
  ),
);
