/** Fired by the preview.find shortcut; the browser tab that is on screen answers it. */
export const PREVIEW_FIND_EVENT = "tabs:preview-find";

export function requestPreviewFind(target: Pick<Window, "dispatchEvent"> = window): void {
  target.dispatchEvent(new Event(PREVIEW_FIND_EVENT));
}
