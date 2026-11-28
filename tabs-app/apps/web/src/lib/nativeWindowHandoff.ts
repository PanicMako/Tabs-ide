import type { NativeApi, NativeComputerState } from "@tabs/contracts";
import type { SurfaceLocation } from "./threadSurfaceAttachment";

export const NATIVE_WINDOW_UPDATED_EVENT = "tabs:native-window-updated";
export const NATIVE_WINDOW_DRAG_MIME = "application/vnd.tabs.native-window-choice";

type ApproveWindowDrop = (canAttach: () => boolean) => Promise<void>;

let windowDrag:
  | {
      token: string;
      location: SurfaceLocation;
      approve: ApproveWindowDrop;
    }
  | undefined;

export function writeNativeWindowDrag(
  transfer: DataTransfer,
  location: SurfaceLocation,
  approve: ApproveWindowDrop,
) {
  const token = crypto.randomUUID();
  transfer.setData(NATIVE_WINDOW_DRAG_MIME, token);
  transfer.effectAllowed = "copy";
  windowDrag = { token, location, approve };
  return () => {
    if (windowDrag?.token === token) windowDrag = undefined;
  };
}

export function takeNativeWindowDrop(transfer: DataTransfer, location: SurfaceLocation) {
  const drag = windowDrag;
  if (
    !drag ||
    drag.token !== transfer.getData(NATIVE_WINDOW_DRAG_MIME) ||
    drag.location.environmentId !== location.environmentId ||
    drag.location.projectId !== location.projectId ||
    drag.location.threadId !== location.threadId
  )
    return;
  windowDrag = undefined;
  return drag.approve;
}

export interface NativeWindowUpdate {
  location: SurfaceLocation;
  state: NativeComputerState;
}

export async function runNativeWindowHandoff(
  request: NativeApi["server"]["nativeComputer"],
  threadId: SurfaceLocation["threadId"],
  op: "take" | "revoke",
  focusedSelector: string | undefined,
  stillCurrent: () => boolean,
) {
  if (!stillCurrent()) throw new Error("Switch back to the conversation with this window.");
  const { grant } = await request({ op: "status", threadId });
  if (!stillCurrent()) throw new Error("Switch back to the conversation with this window.");
  if (!grant) throw new Error("Attach a desktop window to this conversation first.");
  if (focusedSelector && focusedSelector !== grant.selector)
    throw new Error("The focused desktop window is no longer attached to this conversation.");
  return request({ op, threadId, selector: grant.selector });
}

/** Asks the thread's NativeWindowAccess to open its "attach a window" dialog. */
export const NATIVE_WINDOW_ATTACH_REQUEST_EVENT = "tabs:native-window-attach-request";

/** The window a sent attachment points at is gone (for example after a restart). */
export class NativeWindowUnavailableError extends Error {
  constructor() {
    super("That window is no longer available. Attach it again.");
    this.name = "NativeWindowUnavailableError";
  }
}

export function requestNativeWindowAttach(location: SurfaceLocation) {
  window.dispatchEvent(
    new CustomEvent<SurfaceLocation>(NATIVE_WINDOW_ATTACH_REQUEST_EVENT, { detail: location }),
  );
}
