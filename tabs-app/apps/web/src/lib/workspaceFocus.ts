export type FocusAreaId = "sidebar" | "conversation" | "composer" | "panel";

interface FocusArea {
  readonly id: FocusAreaId;
  /** Finds the area's root element. */
  readonly selector: string;
}

/** In the order Tab-less navigation visits them: left to right, then down to the message box. */
export const FOCUS_AREAS: ReadonlyArray<FocusArea> = [
  { id: "sidebar", selector: '[data-sidebar="sidebar"]' },
  { id: "conversation", selector: '[data-chat-messages="true"]' },
  { id: "composer", selector: '[data-chat-composer-form="true"]' },
  { id: "panel", selector: "[data-companion-design]" },
];

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/** The area after (or before) the current one, wrapping around. Starts at an end when none is focused. */
export function nextFocusArea(
  visible: ReadonlyArray<FocusAreaId>,
  current: FocusAreaId | null,
  direction: 1 | -1,
): FocusAreaId | null {
  if (visible.length === 0) return null;
  const index = current === null ? -1 : visible.indexOf(current);
  if (index === -1) return direction === 1 ? visible[0]! : visible[visible.length - 1]!;
  return visible[(index + direction + visible.length) % visible.length]!;
}

function isShown(element: Element): boolean {
  return element instanceof HTMLElement && element.getClientRects().length > 0;
}

const lastFocused = new Map<FocusAreaId, HTMLElement>();

function areaOf(element: Element | null): FocusAreaId | null {
  if (!element) return null;
  for (const area of FOCUS_AREAS) if (element.closest(area.selector)) return area.id;
  return null;
}

/** Remembers the last control focused in each area, so coming back lands where you left. */
export function installWorkspaceFocusTracking(root: Document = document): () => void {
  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const area = areaOf(target);
    if (area) lastFocused.set(area, target);
  };
  root.addEventListener("focusin", onFocusIn);
  return () => root.removeEventListener("focusin", onFocusIn);
}

export function resetWorkspaceFocusTrackingForTest(): void {
  lastFocused.clear();
}

/** Moves focus to the next or previous visible area. Returns false when there is nowhere to go. */
export function focusWorkspaceArea(direction: 1 | -1, root: Document = document): boolean {
  const shown = FOCUS_AREAS.flatMap((area) => {
    const element = [...root.querySelectorAll(area.selector)].find(isShown);
    return element instanceof HTMLElement ? [{ id: area.id, element }] : [];
  });
  const target = nextFocusArea(
    shown.map((area) => area.id),
    areaOf(root.activeElement),
    direction,
  );
  const area = shown.find((candidate) => candidate.id === target);
  if (!area) return false;
  const remembered = lastFocused.get(area.id);
  const destination =
    remembered && remembered.isConnected && area.element.contains(remembered) && isShown(remembered)
      ? remembered
      : ([...area.element.querySelectorAll<HTMLElement>(TABBABLE)].find(isShown) ?? area.element);
  if (destination === area.element && !area.element.hasAttribute("tabindex")) {
    area.element.setAttribute("tabindex", "-1");
  }
  destination.focus();
  return true;
}
