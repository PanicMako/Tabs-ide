import { describe, expect, it, vi } from "vitest";
import { captureDesktopToComposer } from "./desktopCapture";
import type { DesktopCaptureResult } from "@tabs/contracts";

describe("captureDesktopToComposer", () => {
  const mockCaptureResult: DesktopCaptureResult = {
    id: "capture-test-123",
    name: "Screenshot 2026-09-12.png",
    mimeType: "image/png",
    dataUrl:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    sizeBytes: 120,
    width: 1920,
    height: 1080,
  };

  it("throws an error when desktop capture bridge is not available", async () => {
    await expect(
      captureDesktopToComposer("thread-1", { captureScreen: undefined }),
    ).rejects.toThrow(/Desktop capture is only available when running in the native desktop app/);
  });

  it("captures screenshot, adds image attachment to composer, and shows success toast", async () => {
    const captureScreen = vi.fn(async () => mockCaptureResult);
    const addImage = vi.fn();
    const showToast = vi.fn();
    const focusComposer = vi.fn();

    const result = await captureDesktopToComposer(
      "thread-1",
      { captureScreen, addImage, showToast, focusComposer },
      { target: "screen" },
    );

    expect(result).toEqual(mockCaptureResult);
    expect(captureScreen).toHaveBeenCalledWith({ target: "screen" });
    expect(addImage).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({
        id: "capture-test-123",
        name: "Screenshot 2026-09-12.png",
        type: "image",
        previewUrl: mockCaptureResult.dataUrl,
      }),
    );
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "success",
        title: "Screenshot attached",
      }),
    );
    expect(focusComposer).toHaveBeenCalled();
  });

  it("shows error toast and re-throws when capture fails", async () => {
    const captureScreen = vi.fn(async () => {
      throw new Error("Screen recording permission denied");
    });
    const addImage = vi.fn();
    const showToast = vi.fn();

    await expect(
      captureDesktopToComposer("thread-1", { captureScreen, addImage, showToast }),
    ).rejects.toThrow(/Screen recording permission denied/);

    expect(addImage).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        title: "Capture failed",
        description: "Screen recording permission denied",
      }),
    );
  });
});
