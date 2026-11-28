import type { NativeComputerState } from "@tabs/contracts";
import { create } from "zustand";
import type { SurfaceLocation } from "./threadSurfaceAttachment";

type NativeComputerRequest = (command: {
  op: "status";
  threadId: SurfaceLocation["threadId"];
}) => Promise<NativeComputerState>;

export interface PhysicalInputEntry {
  location: SurfaceLocation;
  activity: "checking_foreground" | "needs_foreground" | "foreground";
}

interface PhysicalInputState {
  entries: Record<string, PhysicalInputEntry>;
}

export const usePhysicalInputStore = create<PhysicalInputState>(() => ({ entries: {} }));

const POLL_MS = 1_500;
const pollers = new Map<string, { timer: number | undefined; stopped: boolean }>();

const keyOf = (location: SurfaceLocation) =>
  `${location.environmentId ?? ""}:${location.projectId}:${location.threadId}`;

function setEntry(key: string, entry: PhysicalInputEntry | undefined) {
  usePhysicalInputStore.setState((state) => {
    const entries = { ...state.entries };
    if (entry) entries[key] = entry;
    else delete entries[key];
    return { entries };
  });
}

/** Activity of an agent that is using physical input or holds a foreground window. */
export function physicalInputActivity(
  state: Pick<NativeComputerState, "grant" | "activity">,
): PhysicalInputEntry["activity"] | undefined {
  if (state.grant?.mode !== "agent") return undefined;
  return state.activity === "checking_foreground" ||
    state.activity === "needs_foreground" ||
    state.activity === "foreground"
    ? state.activity
    : undefined;
}

/**
 * Publish one thread's native-window state. While the agent keeps using
 * physical input the store keeps polling that thread, even after its pane is
 * unmounted, so the app-level indicator cannot go stale or disappear when the
 * user switches conversations.
 */
export function publishPhysicalInput(
  location: SurfaceLocation,
  state: Pick<NativeComputerState, "grant" | "activity">,
  request: NativeComputerRequest,
) {
  const key = keyOf(location);
  const activity = physicalInputActivity(state);
  if (!activity) {
    const poller = pollers.get(key);
    if (poller) {
      poller.stopped = true;
      window.clearTimeout(poller.timer);
      pollers.delete(key);
    }
    setEntry(key, undefined);
    return;
  }
  setEntry(key, { location, activity });
  if (pollers.has(key)) return;
  const poller = { timer: undefined as number | undefined, stopped: false };
  pollers.set(key, poller);
  const tick = async () => {
    try {
      const next = await request({ op: "status", threadId: location.threadId });
      if (poller.stopped) return;
      const live = physicalInputActivity(next);
      if (!live) {
        pollers.delete(key);
        setEntry(key, undefined);
        return;
      }
      setEntry(key, { location, activity: live });
    } catch {
      // Keep the last confirmed state and retry.
    }
    if (!poller.stopped) poller.timer = window.setTimeout(tick, POLL_MS);
  };
  poller.timer = window.setTimeout(tick, POLL_MS);
}
