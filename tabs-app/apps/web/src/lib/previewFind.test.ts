import { describe, expect, it, vi } from "vitest";
import { PREVIEW_FIND_EVENT, requestPreviewFind } from "./previewFind";

describe("requestPreviewFind", () => {
  it("fires the event the browser tab listens for", () => {
    const dispatchEvent = vi.fn(() => true);
    requestPreviewFind({ dispatchEvent });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const [event] = dispatchEvent.mock.calls[0] as unknown as [Event];
    expect(event.type).toBe(PREVIEW_FIND_EVENT);
  });
});
