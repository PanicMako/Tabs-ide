import { useLayoutEffect, useRef, type RefObject } from "react";
import { playLookEnter } from "~/lib/motion";
import { useSurfaceMotionSettings } from "~/panelAnimations";

/** More new rows than this in one render is a load (history, thread switch), not a live arrival. */
export const TIMELINE_LIVE_ARRIVAL_LIMIT = 3;

/** Ids that just arrived live, or none when the change is a bulk load or the first paint. */
export function selectArrivedRowIds(
  known: ReadonlySet<string>,
  current: ReadonlyArray<string>,
  firstPaint: boolean,
): string[] {
  if (firstPaint) return [];
  const arrived = current.filter((id) => !known.has(id));
  return arrived.length > TIMELINE_LIVE_ARRIVAL_LIMIT ? [] : arrived;
}

/**
 * Rows that arrive while the conversation is open — a sent prompt, the assistant's reply, a tool
 * group, the working indicator — rise into place instead of popping in. Rows already on screen
 * when the timeline mounts, or loaded in bulk, appear as they are.
 *
 * Only transform and opacity move, so scroll anchoring and layout are untouched.
 */
export function useTimelineRowEntrance(
  rootRef: RefObject<HTMLElement | null>,
  rowIds: ReadonlyArray<string>,
) {
  const { active, seconds, profile } = useSurfaceMotionSettings();
  const known = useRef<Set<string> | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const arrived = selectArrivedRowIds(known.current ?? new Set(), rowIds, known.current === null);
    known.current = new Set(rowIds);
    if (!root || !active || arrived.length === 0) return;

    const targets = arrived
      .map((id) => root.querySelector<HTMLElement>(`[data-timeline-row-id="${CSS.escape(id)}"]`))
      .filter((node): node is HTMLElement => node !== null);
    if (targets.length === 0) return;

    playLookEnter(targets, "row", { seconds, profile }, { stagger: 0.04 });
  }, [active, profile, rootRef, rowIds, seconds]);
}
