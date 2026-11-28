import { BROWSER_SELECTION_MAX_LENGTH } from "@tabs/shared/preview";
import type { SurfaceLocation } from "./threadSurfaceAttachment";

export const BROWSER_SELECTION_DROP_EVENT = "tabs:browser-selection-drop";
export const BROWSER_SELECTION_REVIEW_EVENT = "tabs:browser-selection-review";

export interface BrowserSelectionDrag {
  dragToken: string;
  droppedText: string;
}

export interface BrowserSelectionDrop extends BrowserSelectionDrag {
  location: SurfaceLocation;
}

export interface BrowserSelectionReviewTarget {
  location: SurfaceLocation;
  sessionId: string;
}

export function isBrowserSelectionDrag({ dragToken, droppedText }: BrowserSelectionDrag): boolean {
  return (
    typeof dragToken === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(dragToken) &&
    typeof droppedText === "string" &&
    droppedText.replaceAll("\r\n", "\n").length <= BROWSER_SELECTION_MAX_LENGTH &&
    Boolean(droppedText.trim())
  );
}
